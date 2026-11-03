// One server and client pair from start to finish, and the grid of them. The provider
// decides what a server and a client are: Docker and npm for real, the stub for the demo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeAccount } from './crypto.mjs';
import { clientPackage, installClient, makeClient } from './client.mjs';
import { runFlow } from './flow.mjs';
import { registerAccount } from './register.mjs';
import { checkDocker, startContainer } from './server.mjs';

export const dockerProvider = {
  preflight: checkDocker,
  installClient,
  startServer: startContainer,
  describeServer: (version) => `vaultwarden/server:${version}`,
  describeClient: clientPackage,
};

class Stage extends Error {
  constructor(stage, cause) {
    super(cause.message);
    this.stage = stage;
  }
}

async function stage(name, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Stage(name, err);
  }
}

// bw prints its version and nothing else. Anything else means this install does not run.
async function clientVersion(client) {
  const res = await client.run(['--version'], { timeoutMs: 120000 });
  const version = res.stdout.trim();
  if (res.code !== 0 || !version) throw new Error(`bw --version failed: ${res.stderr.trim() || res.stdout.trim() || res.spawnError?.message || `exit ${res.code}`}`);
  return version;
}

export async function runCheck({ server, client, root, provider, installs, onProgress = () => {} }) {
  const started = Date.now();
  const workdir = fs.mkdtempSync(path.join(root, 'cell-'));
  const result = {
    server: { requested: server, resolved: null, image: provider.describeServer(server) },
    client: { requested: client, resolved: null, package: provider.describeClient(client) },
    status: 'error',
    duration_ms: 0,
    steps: [],
    first_failure: null,
    error: null,
    server_log: null,
  };
  let running = null;
  try {
    await stage('docker', () => provider.preflight());

    onProgress(`installing ${result.client.package}`);
    if (!installs.has(client)) installs.set(client, provider.installClient(client, { root }));
    const installed = await stage('install client', () => installs.get(client));

    onProgress(`starting ${result.server.image}`);
    running = await stage('start server', () => provider.startServer(server, { root }));
    result.server.resolved = running.resolved;

    const bw = makeClient({ command: installed.command, ca: running.ca, workdir: path.join(workdir, 'client') });
    result.client.resolved = await stage('install client', () => clientVersion(bw));

    onProgress('registering a throwaway account');
    const account = makeAccount({
      email: `canary-${crypto.randomBytes(4).toString('hex')}@vw-canary.invalid`,
      password: crypto.randomBytes(24).toString('base64url'),
      iterations: provider.iterations,
    });
    await stage('register account', () => registerAccount(running.url, account, { ca: running.ca }));

    onProgress(`running the client flow against ${running.url}`);
    result.steps = await stage('client flow', () => runFlow({ client: bw, url: running.url, account }));
    const failed = result.steps.find((s) => s.status === 'fail');
    result.status = failed ? 'fail' : 'pass';
    if (failed) {
      result.first_failure = { step: failed.name, message: failed.error.message };
      result.server_log = (await running.logs?.()) || null;
    }
  } catch (err) {
    if (!(err instanceof Stage)) throw err;
    result.error = { stage: err.stage, message: err.message };
  } finally {
    await running?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
    result.duration_ms = Date.now() - started;
  }
  return result;
}

/** Every server with every client, in the order given. A fresh server per cell, each client installed once. */
export async function runMatrix({ servers, clients, root, provider, onProgress = () => {} }) {
  const installs = new Map();
  const results = [];
  const total = servers.length * clients.length;
  for (const server of servers) {
    for (const client of clients) {
      const prefix = total > 1 ? `[${results.length + 1}/${total}] ` : '';
      onProgress(`${prefix}server ${server}, client ${client}`);
      results.push(await runCheck({ server, client, root, provider, installs, onProgress }));
    }
  }
  return results;
}
