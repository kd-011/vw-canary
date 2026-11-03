// The promises in SECURITY.md: only ever the container it started, on 127.0.0.1, and
// never the user's own Bitwarden config. Each guard here was weakened once to see it go red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { makeClient } from '../src/client.mjs';
import { startContainer } from '../src/server.mjs';
import { fakeTools, runCli, sandbox, wrapBw } from '../test-support/helpers.mjs';

function restoreEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('the client sees a private HOME and none of the caller\'s Bitwarden settings', async (t) => {
  const sb = sandbox(t);
  restoreEnv(t, { BW_SESSION: 'real-session', BW_PASSWORD: 'real-password', BW_CLIENTID: 'real-id', BITWARDENCLI_APPDATA_DIR: '/real/appdata', NODE_OPTIONS: '--require=/real/hook.js', HOME: '/real/home', XDG_CONFIG_HOME: '/real/config', NODE_TLS_REJECT_UNAUTHORIZED: '0' });
  const dump = sb.path('env.json');
  const bw = wrapBw(sb, `*) "${process.execPath}" -e 'require("fs").writeFileSync("${dump}", JSON.stringify(process.env))'; exit 0;;`);
  const client = makeClient({ command: [bw], ca: 'CA PEM', workdir: sb.path('client') });
  await client.run(['status']);
  const seen = JSON.parse(fs.readFileSync(dump, 'utf8'));
  const inside = (p) => p?.startsWith(sb.path('client'));
  assert.ok(inside(seen.HOME), seen.HOME);
  assert.ok(inside(seen.XDG_CONFIG_HOME), seen.XDG_CONFIG_HOME);
  assert.ok(inside(seen.BITWARDENCLI_APPDATA_DIR), seen.BITWARDENCLI_APPDATA_DIR);
  assert.ok(inside(seen.NODE_EXTRA_CA_CERTS));
  assert.equal(fs.readFileSync(seen.NODE_EXTRA_CA_CERTS, 'utf8'), 'CA PEM');
  assert.equal(seen.BW_NOINTERACTION, 'true');
  for (const k of ['BW_SESSION', 'BW_PASSWORD', 'BW_CLIENTID', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(seen[k], undefined, k);
});

test('the container publishes only on loopback and keeps its data in tmpfs', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stderr } = await runCli(['check', '--server', '1.37.1', '--client', '2026.7.0'], { env: tools.env });
  assert.equal(code, 0, stderr);
  const create = tools.calls('docker').find((c) => c.args[0] === 'create').args;
  const publish = create[create.indexOf('-p') + 1];
  assert.equal(publish, '127.0.0.1::443');
  assert.equal(create.filter((a) => a === '-p' || a === '--publish').length, 1);
  assert.ok(!create.includes('--network'));
  assert.ok(!create.some((a) => a === '-v' || a === '--volume' || a === '--mount' || a === '--privileged'));
  assert.equal(create[create.indexOf('--tmpfs') + 1], '/data');
  assert.ok(create.includes('--rm'));
  assert.ok(create.includes('vaultwarden/server:1.37.1'));
  assert.ok(create.includes('SIGNUPS_ALLOWED=true'));
});

test('a container published anywhere but loopback is refused and removed', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { env: { FAKE_DOCKER_PORT_OUTPUT: '0.0.0.0:32768' } });
  restoreEnv(t, tools.env);
  await assert.rejects(startContainer('1.37.1', { root: sb.tmp, readyTimeoutMs: 2000 }), /127\.0\.0\.1/);
  const rm = tools.calls('docker').filter((c) => c.args[0] === 'rm');
  assert.equal(rm.length, 1);
});

test('nothing on the command line can name a real server', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const bad = [
    ['check', '--server', 'https://vault.example.test', '--client', '2026.7.0'],
    ['check', '--server', 'vault.example.test:443', '--client', '2026.7.0'],
    ['check', '--server', '1.37.1', '--client', '2026.7.0', '--url', 'https://vault.example.test'],
    ['check', '--server', '1.37.1', '--client', '2026.7.0', '--host', 'vault.example.test'],
    ['check', '--matrix', '--servers', '1.37.1,https://vault.example.test', '--clients', '2026.7.0'],
  ];
  for (const args of bad) {
    const { code, stderr } = await runCli(args, { env: tools.env });
    assert.equal(code, 2, `${args.join(' ')}: ${stderr}`);
  }
  assert.deepEqual(tools.calls(), []);
});

test('versions cannot smuggle extra arguments or another image or package', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  for (const [server, client] of [['1.37.1 --privileged', '2026.7.0'], ['--privileged', '2026.7.0'], ['1.37.1', 'evil-package'], ['1.37.1', '2026.7.0 --ignore-scripts=false'], ['1.37.1@sha256:abc', '2026.7.0'], ['1.37.1', 'file:../x']]) {
    const { code } = await runCli(['check', `--server=${server}`, `--client=${client}`], { env: tools.env });
    assert.equal(code, 2, `${server} ${client}`);
  }
  assert.deepEqual(tools.calls(), []);
});

test('install scripts from the npm package never run', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  await runCli(['check', '--server', '1.37.1', '--client', '2026.7.0'], { env: tools.env });
  const install = tools.calls('npm')[0].args;
  assert.ok(install.includes('--ignore-scripts'));
  assert.ok(install.includes('@bitwarden/cli@2026.7.0'));
});
