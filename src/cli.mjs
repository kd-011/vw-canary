import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { dockerProvider, runMatrix } from './check.mjs';
import { exitOnSignals, runCleanup, track } from './cleanup.mjs';
import { DEMO_CLIENTS, DEMO_SERVERS, demoProvider } from './demo.mjs';
import { CAVEAT, VERSION, renderCheck, renderMatrix, summaryLine, toJson, verdict } from './report.mjs';

const HELP = `vw-canary ${VERSION}
Checks whether a Bitwarden client version still works against a Vaultwarden server version,
in a throwaway container.

Usage:
  vw-canary check --server 1.37.1 --client 2026.7.0 [--json]
  vw-canary check --matrix --servers 1.36.0,1.37.1 --clients 2026.6.0,2026.7.0 [--json]
  vw-canary demo [--json]
  vw-canary --version

check starts vaultwarden/server:<server> on 127.0.0.1 and runs @bitwarden/cli@<client>
through login, sync, create, sync, list and decrypt, edit and delete. The container and
every temp file are removed afterwards. It needs Docker and npm. demo needs neither.

Exit codes: 0 everything passed, 1 a client flow failed, 2 usage error or something could
not be tested.
Docs: https://github.com/kd-011/vw-canary#readme
`;

class UsageError extends Error {}

const SERVER_VERSION = /^(\d+\.\d+\.\d+(-alpine)?|latest(-alpine)?|testing(-alpine)?|alpine)$/;
const CLIENT_VERSION = /^(\d+\.\d+\.\d+|latest)$/;

const OPTIONS = {
  check: {
    server: { type: 'string' },
    client: { type: 'string' },
    servers: { type: 'string' },
    clients: { type: 'string' },
    matrix: { type: 'boolean' },
    json: { type: 'boolean' },
  },
  demo: { json: { type: 'boolean' } },
};

function parse(command, args) {
  try {
    return parseArgs({ args, options: OPTIONS[command], allowPositionals: false }).values;
  } catch (err) {
    throw new UsageError(err.message);
  }
}

function checked(values, pattern, what) {
  for (const v of values) {
    if (!pattern.test(v)) throw new UsageError(`${what} must be a version number like ${what === 'server' ? '1.37.1' : '2026.7.0'} or a tag like latest, got "${v}". vw-canary only runs its own throwaway server.`);
  }
  return [...new Set(values)];
}

function list(value, flag) {
  const items = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new UsageError(`${flag} needs a comma-separated list of versions`);
  return items;
}

function checkPlan(values) {
  if (values.matrix) {
    if (values.server || values.client) throw new UsageError('--matrix takes --servers and --clients, not --server and --client');
    return {
      mode: 'matrix',
      servers: checked(list(values.servers, '--servers'), SERVER_VERSION, 'server'),
      clients: checked(list(values.clients, '--clients'), CLIENT_VERSION, 'client'),
    };
  }
  if (values.servers || values.clients) throw new UsageError('--servers and --clients need --matrix');
  if (!values.server) throw new UsageError('check needs --server');
  if (!values.client) throw new UsageError('check needs --client');
  return {
    mode: 'check',
    servers: checked([values.server], SERVER_VERSION, 'server'),
    clients: checked([values.client], CLIENT_VERSION, 'client'),
  };
}

function privateRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-canary-'));
  track(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function cmdCheck(args, { stdout, stderr }) {
  const values = parse('check', args);
  const plan = checkPlan(values);
  const root = privateRoot();
  const results = await runMatrix({
    servers: plan.servers,
    clients: plan.clients,
    root,
    provider: dockerProvider,
    onProgress: (line) => stderr.write(`vw-canary: ${line}\n`),
  });
  if (values.json) {
    stdout.write(`${JSON.stringify(toJson(plan.mode, results), null, 2)}\n`);
  } else {
    const body = plan.mode === 'matrix' ? renderMatrix(results) : renderCheck(results[0]);
    const caveat = results.some((r) => r.status === 'pass') ? `${CAVEAT}\n` : '';
    stdout.write(`${body}\n\n${summaryLine(results)}\n${caveat}`);
  }
  return verdict(results).exit_code;
}

async function cmdDemo(args, { stdout }) {
  const values = parse('demo', args);
  const root = privateRoot();
  const results = await runMatrix({ servers: DEMO_SERVERS, clients: DEMO_CLIENTS, root, provider: demoProvider });
  if (values.json) {
    stdout.write(`${JSON.stringify(toJson('demo', results), null, 2)}\n`);
  } else {
    const failing = results.find((r) => r.status === 'fail');
    stdout.write(`vw-canary demo: a fake server and fake clients, nothing real was started. One pair breaks on purpose.\n\n${renderCheck(failing)}\n\n${renderMatrix(results).split('\n\n')[0]}\n\n${summaryLine(results)}\nThe same run on real versions: vw-canary check --server 1.37.1 --client 2026.7.0\n`);
  }
  return verdict(results).exit_code;
}

export async function main(argv) {
  const io = { stdout: process.stdout, stderr: process.stderr };
  if (argv[0] === '--version' || argv[0] === '-v') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    io.stdout.write(HELP);
    return 0;
  }
  exitOnSignals();
  try {
    if (argv[0] === 'check') return await cmdCheck(argv.slice(1), io);
    if (argv[0] === '--matrix') return await cmdCheck(argv, io);
    if (argv[0] === 'demo') return await cmdDemo(argv.slice(1), io);
    if (argv.length === 0) throw new UsageError(`no command given\n\n${HELP}`);
    throw new UsageError(`unknown command "${argv[0]}"\n\n${HELP}`);
  } catch (err) {
    io.stderr.write(`vw-canary: ${err instanceof UsageError ? err.message : err.stack}\n`);
    return 2;
  } finally {
    runCleanup();
  }
}
