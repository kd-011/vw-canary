// The whole `check` command through real child processes, with fake docker and npm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { startContainer } from '../src/server.mjs';
import { fakeTools, runCli, sandbox, startCli } from '../test-support/helpers.mjs';

const CHECK = ['check', '--server', '1.37.1', '--client', '2026.7.0'];

test('a passing check prints a PASS table, exits 0 and leaves nothing behind', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout, stderr } = await runCli(CHECK, { env: tools.env });
  assert.equal(code, 0, stderr);
  for (const name of ['config server', 'login', 'sync', 'create item', 'sync again', 'list and decrypt', 'edit item', 'delete item']) {
    assert.match(stdout, new RegExp(`PASS\\s+${name}`));
  }
  assert.match(stdout, /server 1\.37\.1/);
  assert.match(stdout, /client 2026\.7\.0/);
  const rm = tools.calls('docker').filter((c) => c.args[0] === 'rm');
  assert.equal(rm.length, 1);
  assert.deepEqual(sb.leftovers(), []);
  assert.deepEqual(fs.readdirSync(sb.home), []);
});

test('a client failure exits 1 and prints the first real error', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { npmWrap: `"create item") echo "Error: Invalid cipher data." >&2; exit 1;;` });
  const { code, stdout } = await runCli(CHECK, { env: tools.env });
  assert.equal(code, 1);
  assert.match(stdout, /FAIL\s+create item/);
  assert.match(stdout, /SKIP\s+sync again/);
  assert.match(stdout, /Invalid cipher data/);
  assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'rm').length, 1);
  assert.deepEqual(sb.leftovers(), []);
});

test('a failure keeps the end of the server log, since the container is gone afterwards', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { npmWrap: `"create item") echo "Error: Invalid cipher data." >&2; exit 1;;` });
  const text = await runCli(CHECK, { env: tools.env });
  assert.match(text.stdout, /Last lines of the server log:\n\s+fake container log line/);
  const { stdout } = await runCli([...CHECK, '--json'], { env: tools.env });
  assert.match(JSON.parse(stdout).results[0].server_log, /fake container log line/);
});

test('a pass does not read the server log', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { stdout } = await runCli([...CHECK, '--json'], { env: tools.env });
  assert.equal(JSON.parse(stdout).results[0].server_log, null);
  assert.deepEqual(tools.calls('docker').filter((c) => c.args[0] === 'logs'), []);
});

test('the resolved server version comes from the image label when there is one', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { env: { FAKE_DOCKER_IMAGE_VERSION: '1.37.5' } });
  const { stdout } = await runCli(['check', '--server', 'latest', '--client', '2026.7.0', '--json'], { env: tools.env });
  const r = JSON.parse(stdout).results[0];
  assert.deepEqual(r.server, { requested: 'latest', resolved: '1.37.5', image: 'vaultwarden/server:latest' });
  const create = tools.calls('docker').find((c) => c.args[0] === 'create').args;
  assert.ok(create.includes('--pull=always'), 'a moving tag must be pulled fresh');
});

test('a pinned version does not force a pull', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  await runCli(CHECK, { env: tools.env });
  const create = tools.calls('docker').find((c) => c.args[0] === 'create').args;
  assert.ok(!create.includes('--pull=always'));
});

test('docker missing is an error, exit 2, and points at the demo', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  fs.rmSync(`${tools.bin}/docker`);
  const nodeDir = process.execPath.replace(/\/[^/]+$/, '');
  const { code, stdout, stderr } = await runCli(CHECK, { env: { ...tools.env, PATH: `${tools.bin}:${nodeDir}` } });
  assert.equal(code, 2);
  assert.match(stdout + stderr, /docker/i);
  assert.match(stdout + stderr, /vw-canary demo/);
  assert.deepEqual(tools.calls('npm'), []);
});

test('docker daemon down is an error with docker\'s own text', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { env: { FAKE_DOCKER_DOWN: '1' } });
  const { code, stdout, stderr } = await runCli(CHECK, { env: tools.env });
  assert.equal(code, 2);
  assert.match(stdout + stderr, /Cannot connect to the Docker daemon/);
});

test('a server tag that does not exist is an error with docker\'s own text, not a FAIL', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { env: { FAKE_DOCKER_CREATE_ERROR: 'Error response from daemon: manifest for vaultwarden/server:9.9.9 not found: manifest unknown' } });
  const { code, stdout, stderr } = await runCli(['check', '--server', '9.9.9', '--client', '2026.7.0'], { env: tools.env });
  assert.equal(code, 2);
  assert.match(stdout + stderr, /manifest unknown/);
  assert.doesNotMatch(stdout, /FAIL/);
  assert.deepEqual(sb.leftovers(), []);
});

test('a client version that does not exist is an error with npm\'s own text', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout, stderr } = await runCli(['check', '--server', '1.37.1', '--client', '9999.0.0'], { env: tools.env });
  assert.equal(code, 2);
  assert.match(stdout + stderr, /No matching version found/);
  assert.deepEqual(tools.calls('docker').filter((c) => c.args[0] === 'create'), []);
});

test('a refused registration says the client was not tested, exit 2', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout } = await runCli(['check', '--server', '1.0.0', '--client', '2026.7.0', '--json'], { env: tools.env });
  assert.equal(code, 2);
  const r = JSON.parse(stdout).results[0];
  assert.equal(r.status, 'error');
  assert.equal(r.error.stage, 'register account');
  assert.match(r.error.message, /Registration not allowed/);
  assert.deepEqual(r.steps, []);
  assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'rm').length, 1);
});

test('a server that never comes up is removed and reports the container log', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb, { env: { FAKE_DOCKER_NEVER_READY: '1' } });
  const saved = { ...process.env };
  Object.assign(process.env, tools.env);
  t.after(() => { for (const k of Object.keys(tools.env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  await assert.rejects(startContainer('1.37.1', { root: sb.tmp, readyTimeoutMs: 500 }), /fake container log line/);
  assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'rm').length, 1);
});

for (const [signal, want] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  test(`${signal} removes the container and the temp dir, exit ${want}`, async (t) => {
    const sb = sandbox(t);
    const started = sb.path('in-step');
    const tools = fakeTools(sb, { npmWrap: `"sync "*) : > "${started}"; sleep 60;;` });
    const run = startCli(CHECK, { env: tools.env });
    for (let i = 0; i < 1000 && !fs.existsSync(started); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(fs.existsSync(started), `never reached the sync step: ${run.stderr()}`);
    run.child.kill(signal);
    const { code } = await run.done;
    assert.equal(code, want);
    assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'rm').length, 1);
    assert.deepEqual(sb.leftovers(), []);
  });
}

test('matrix runs the grid, installs each client once and starts a fresh server per cell', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout, stderr } = await runCli(['check', '--matrix', '--servers', '1.3.0,1.2.0', '--clients', '2026.1.0,2026.2.0'], { env: tools.env });
  // Server 1.2.0 moved a field, client 2026.1.0 only knows the old name.
  assert.equal(code, 1, stderr);
  assert.equal(tools.calls('npm').length, 2);
  assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'create').length, 4);
  assert.equal(tools.calls('docker').filter((c) => c.args[0] === 'rm').length, 4);
  const row = (name) => stdout.split('\n').find((l) => l.startsWith(name));
  assert.match(row('1.3.0'), /PASS\s+PASS/);
  assert.match(row('1.2.0'), /FAIL\s+PASS/);
  assert.match(stdout, /returned 0 items/);
  assert.match(stdout, /1 of 4 combinations failed/);
  assert.deepEqual(sb.leftovers(), []);
});

test('--matrix works without the check word', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout, stderr } = await runCli(['--matrix', '--servers', '1.3.0', '--clients', '2026.2.0', '--json'], { env: tools.env });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).mode, 'matrix');
});

test('an error in any cell makes the run exit 2 and the other cells still run', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  const { code, stdout } = await runCli(['check', '--matrix', '--servers', '1.3.0,1.2.0', '--clients', '9999.0.0,2026.1.0', '--json'], { env: tools.env });
  assert.equal(code, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.results.length, 4);
  assert.deepEqual(report.results.map((r) => r.status), ['error', 'pass', 'error', 'fail']);
  assert.equal(report.status, 'error');
  assert.equal(report.exit_code, 2);
});
