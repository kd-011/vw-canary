import { spawn } from 'node:child_process';
import { track } from './cleanup.mjs';

/**
 * Runs a command in its own process group so a timeout or a signal takes its children too.
 * Resolves to { code, stdout, stderr, timedOut }, and code is null when it could not start
 * (then spawnError is set) or was killed.
 */
export function run(command, args, { env, cwd, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };
    const untrack = track(kill);
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, timeoutMs) : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const finish = (extra) => {
      clearTimeout(timer);
      untrack();
      resolve({ stdout, stderr, timedOut, ...extra });
    };
    child.on('error', (spawnError) => finish({ code: null, spawnError }));
    child.on('close', (code) => finish({ code }));
  });
}
