// Shared fixtures. Everything is real except what is named fake: the fake docker and
// npm are executables on PATH, and the fake Vaultwarden is a real HTTPS server.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BIN = path.join(ROOT, 'bin/vw-canary.mjs');
export const FAKE_BW = path.join(ROOT, 'src/stub/fake-bw.mjs');
const SUPPORT = path.join(ROOT, 'test-support');

export function have(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
}

export function startCli(args, { env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done, stderr: () => stderr };
}

export const runCli = (args, opts) => startCli(args, opts).done;

/** A private directory with its own TMPDIR and HOME, removed when the test ends. */
export function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vwc-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tmp = path.join(root, 'tmp');
  const home = path.join(root, 'home');
  fs.mkdirSync(tmp);
  fs.mkdirSync(home);
  return {
    root,
    tmp,
    home,
    path: (...p) => path.join(root, ...p),
    leftovers: () => fs.readdirSync(tmp).filter((n) => n.startsWith('vw-canary')),
  };
}

/**
 * Puts a fake `docker` and `npm` first on PATH. The fake docker starts a real HTTPS stub
 * with the certificate it was handed, and records every call.
 *   npmWrap: shell `case` arms for the fake bw that npm "installs", see wrapBw below.
 */
export function fakeTools(sb, { npmWrap = '', env = {} } = {}) {
  const bin = sb.path('fakebin');
  const state = sb.path('fakestate');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  for (const [name, target] of [['docker', 'fake-docker.mjs'], ['npm', 'fake-npm.mjs']]) {
    const f = path.join(bin, name);
    fs.writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${path.join(SUPPORT, target)}" "$@"\n`);
    fs.chmodSync(f, 0o755);
  }
  return {
    bin,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: sb.tmp,
      HOME: sb.home,
      FAKE_STATE: state,
      FAKE_NPM_WRAP: npmWrap,
      ...env,
    },
    calls: (tool) => {
      const f = path.join(state, 'calls.jsonl');
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => !tool || c.tool === tool);
    },
  };
}

/**
 * An executable that behaves as the fake bw except for the `case` arms given. Arms match
 * on "$1 $2", for example `"list items") echo '[]'; exit 0;;`
 */
export function wrapBw(sb, arms, { profile = 'new' } = {}) {
  const f = sb.path(`bw-${fs.readdirSync(sb.root).length}`);
  fs.writeFileSync(f, `#!/bin/sh\nreal() { "${process.execPath}" "${FAKE_BW}" --profile=${profile} "$@"; }\ncase "$1 $2" in\n${arms}\nesac\nexec "${process.execPath}" "${FAKE_BW}" --profile=${profile} "$@"\n`);
  fs.chmodSync(f, 0o755);
  return f;
}
