// Stands in for the docker CLI so the whole `check` path runs without Docker. `start`
// launches a real HTTPS stub using the certificate that was `docker cp`d in.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const state = process.env.FAKE_STATE;
fs.appendFileSync(path.join(state, 'calls.jsonl'), `${JSON.stringify({ tool: 'docker', args })}\n`);
const dir = (name) => path.join(state, name);
const fail = (text) => { process.stderr.write(`${text}\n`); process.exit(125); };

switch (args[0]) {
  case 'version':
    if (process.env.FAKE_DOCKER_DOWN) fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
    console.log('27.0.0');
    break;
  case 'create': {
    if (process.env.FAKE_DOCKER_CREATE_ERROR) fail(process.env.FAKE_DOCKER_CREATE_ERROR);
    const name = args[args.indexOf('--name') + 1];
    const image = args.find((a) => a.startsWith('vaultwarden/server:'));
    fs.mkdirSync(dir(name), { recursive: true });
    fs.writeFileSync(path.join(dir(name), 'image'), image);
    console.log('f'.repeat(64));
    break;
  }
  case 'cp': {
    const [name, to] = args.at(-1).split(':');
    fs.copyFileSync(args.at(-2), path.join(dir(name), path.basename(to)));
    break;
  }
  case 'start': {
    const name = args[1];
    const image = fs.readFileSync(path.join(dir(name), 'image'), 'utf8');
    if (process.env.FAKE_DOCKER_NEVER_READY) break;
    const child = spawn(process.execPath, [fileURLToPath(new URL('fake-vaultwarden.mjs', import.meta.url)), dir(name), image], { detached: true, stdio: 'ignore' });
    child.unref();
    fs.writeFileSync(path.join(dir(name), 'pid'), String(child.pid));
    for (let i = 0; i < 500 && !fs.existsSync(path.join(dir(name), 'port')); i++) await new Promise((r) => setTimeout(r, 10));
    break;
  }
  case 'port': {
    if (process.env.FAKE_DOCKER_PORT_OUTPUT) { console.log(process.env.FAKE_DOCKER_PORT_OUTPUT); break; }
    const file = path.join(dir(args[1]), 'port');
    console.log(`127.0.0.1:${fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '1'}`);
    break;
  }
  case 'image':
    console.log(process.env.FAKE_DOCKER_IMAGE_VERSION ?? '');
    break;
  case 'logs':
    console.log('fake container log line');
    break;
  case 'rm': {
    const pidFile = path.join(dir(args.at(-1)), 'pid');
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch { /* already gone */ }
    }
    break;
  }
  default:
    fail(`fake docker: unexpected command ${args.join(' ')}`);
}
