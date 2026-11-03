// Starts the throwaway Vaultwarden. The -p and --tmpfs values below are the safety promise
// in SECURITY.md: loopback only, and no data on the host.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCert } from './cert.mjs';
import { track } from './cleanup.mjs';
import { run } from './proc.mjs';
import { apiRequest } from './register.mjs';

const IMAGE = 'vaultwarden/server';
const CONTAINER_PORT = '443';
const MOVING_TAG = /^(latest|testing|alpine)/;

async function docker(args, { timeoutMs = 600000 } = {}) {
  const res = await run('docker', args, { env: process.env, timeoutMs });
  if (res.spawnError) {
    throw new Error(`docker was not found on PATH (${res.spawnError.code}). vw-canary starts Vaultwarden in Docker. To see the report without it, run: vw-canary demo`);
  }
  if (res.timedOut) throw new Error(`docker ${args[0]} timed out`);
  if (res.code !== 0) throw new Error(res.stderr.trim() || res.stdout.trim() || `docker ${args[0]} exited ${res.code}`);
  return res.stdout.trim();
}

export async function checkDocker() {
  await docker(['version'], { timeoutMs: 30000 });
}

async function waitUntilAlive(url, ca, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await apiRequest(`${url}/alive`, { ca });
      if (res.status === 200) return null;
      last = `/alive answered ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

/** The container is removed on the way out, so this is the only chance to read it. */
async function containerLogs(name) {
  const res = await run('docker', ['logs', '--tail', '12', name], { env: process.env, timeoutMs: 30000 });
  return `${res.stdout}${res.stderr}`.trim();
}

/** Returns { url, ca, image, resolved, stop, logs }. stop() is safe to call twice. */
export async function startContainer(version, { root, readyTimeoutMs = 60000 }) {
  const name = `vw-canary-${crypto.randomBytes(6).toString('hex')}`;
  const image = `${IMAGE}:${version}`;
  const { cert, key } = makeCert();
  const tls = fs.mkdtempSync(path.join(root, 'tls-'));
  fs.writeFileSync(path.join(tls, 'cert.pem'), cert);
  fs.writeFileSync(path.join(tls, 'key.pem'), key, { mode: 0o600 });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    untrack();
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    fs.rmSync(tls, { recursive: true, force: true });
  };
  const untrack = track(stop);

  try {
    await docker([
      'create', '--rm', '--name', name, '--label', 'vw-canary=1',
      ...(MOVING_TAG.test(version) ? ['--pull=always'] : []),
      '-p', `127.0.0.1::${CONTAINER_PORT}`,
      '--tmpfs', '/data',
      '-e', 'SIGNUPS_ALLOWED=true',
      '-e', `ROCKET_PORT=${CONTAINER_PORT}`,
      '-e', 'ROCKET_TLS={certs="/tmp/cert.pem",key="/tmp/key.pem"}',
      image,
    ]);
    await docker(['cp', path.join(tls, 'cert.pem'), `${name}:/tmp/cert.pem`]);
    await docker(['cp', path.join(tls, 'key.pem'), `${name}:/tmp/key.pem`]);
    await docker(['start', name]);

    const published = (await docker(['port', name, `${CONTAINER_PORT}/tcp`])).split('\n').filter(Boolean);
    const m = /^127\.0\.0\.1:(\d+)$/.exec(published[0] ?? '');
    if (!m || published.length !== 1) throw new Error(`docker published the server on ${published.join(', ') || 'nothing'}, expected only 127.0.0.1`);
    const url = `https://127.0.0.1:${m[1]}`;

    const notReady = await waitUntilAlive(url, cert, readyTimeoutMs);
    if (notReady) {
      const logs = await containerLogs(name);
      throw new Error(`Vaultwarden did not answer within ${Math.round(readyTimeoutMs / 1000)}s (${notReady}). Container log:\n${logs}`);
    }

    const label = await docker(['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.version"}}', image]).catch(() => '');
    const resolved = /^\d/.test(label) ? label : version;
    return { url, ca: cert, image, resolved, stop, logs: () => containerLogs(name) };
  } catch (err) {
    stop();
    throw err;
  }
}
