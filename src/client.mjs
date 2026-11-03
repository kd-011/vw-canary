// Installs and runs the Bitwarden CLI. The client gets a private HOME and a short list of
// environment variables, so it cannot see the caller's Bitwarden config or session.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './proc.mjs';

const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'TZ'];

export function makeClient({ command, ca, workdir }) {
  const home = path.join(workdir, 'home');
  const appdata = path.join(workdir, 'appdata');
  const tmp = path.join(workdir, 'tmp');
  for (const dir of [home, appdata, tmp]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caFile = path.join(workdir, 'ca.pem');
  fs.writeFileSync(caFile, ca);

  const base = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    TMPDIR: tmp,
    BITWARDENCLI_APPDATA_DIR: appdata,
    NODE_EXTRA_CA_CERTS: caFile,
    BW_NOINTERACTION: 'true',
  };
  for (const key of PASS_THROUGH) if (process.env[key]) base[key] = process.env[key];

  return {
    run: (args, { env = {}, timeoutMs } = {}) => run(command[0], [...command.slice(1), ...args], { env: { ...base, ...env }, cwd: workdir, timeoutMs }),
  };
}

export const clientPackage = (version) => `@bitwarden/cli@${version}`;

/** Installs the CLI into a temp prefix. Install scripts stay off: nothing from npm runs here but bw itself. */
export async function installClient(version, { root }) {
  const prefix = path.join(root, 'clients', version);
  fs.mkdirSync(prefix, { recursive: true });
  const res = await run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', clientPackage(version)], { env: process.env, timeoutMs: 600000 });
  if (res.spawnError) throw new Error(`could not run npm: ${res.spawnError.message}`);
  if (res.timedOut) throw new Error(`npm install ${clientPackage(version)} timed out after 10 minutes`);
  if (res.code !== 0) throw new Error(`npm install ${clientPackage(version)} failed:\n${res.stderr.trim() || res.stdout.trim()}`);
  return { command: [path.join(prefix, 'node_modules/.bin/bw')], package: clientPackage(version) };
}
