import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ROOT, fakeTools, runCli, sandbox } from '../test-support/helpers.mjs';

const pkg = JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8'));

test('--version prints the package version', async () => {
  const { code, stdout } = await runCli(['--version']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('--help lists the commands and the exit codes', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  for (const word of ['check', '--matrix', '--json', 'demo', 'Exit codes']) assert.ok(stdout.includes(word), word);
});

test('usage errors exit 2', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  for (const args of [[], ['nonsense'], ['check'], ['check', '--server', '1.37.1'], ['check', '--client', '2026.7.0'], ['check', '--nope'],
    ['check', '--matrix', '--servers', '1.37.1'], ['check', '--matrix', '--server', '1.37.1', '--client', '2026.7.0'],
    ['check', '--server', '1.37.1', '--client', '2026.7.0', '--servers', '1.36.0'], ['check', '--matrix', '--servers', '', '--clients', '2026.7.0'], ['demo', '--nope']]) {
    const { code, stderr } = await runCli(args, { env: tools.env });
    assert.equal(code, 2, `${args.join(' ')}: ${stderr}`);
    assert.notEqual(stderr, '', args.join(' '));
  }
  assert.deepEqual(tools.calls(), []);
});

test('moving tags and alpine variants are accepted as versions', async (t) => {
  const sb = sandbox(t);
  const tools = fakeTools(sb);
  for (const [server, client] of [['latest', 'latest'], ['1.37.1-alpine', '2026.7.0'], ['testing', '2026.10.1']]) {
    const { code, stderr } = await runCli(['check', '--server', server, '--client', client], { env: tools.env });
    assert.equal(code, 0, stderr);
  }
});

test('demo works with an empty HOME and no docker or npm, shows both outcomes, exits 1', async (t) => {
  const sb = sandbox(t);
  const { code, stdout, stderr } = await runCli(['demo'], { env: { HOME: sb.home, TMPDIR: sb.tmp, PATH: sb.path('nothing') } });
  assert.equal(code, 1, stderr);
  assert.match(stdout, /fake/i);
  assert.match(stdout, /PASS/);
  assert.match(stdout, /FAIL\s+list and decrypt/);
  assert.match(stdout, /returned 0 items/);
  assert.match(stdout, /1 of 4 combinations failed/);
  assert.deepEqual(sb.leftovers(), []);
  assert.deepEqual(fs.readdirSync(sb.home), []);
});

test('demo --json is valid and keeps stdout clean', async (t) => {
  const sb = sandbox(t);
  const { code, stdout } = await runCli(['demo', '--json'], { env: { HOME: sb.home, TMPDIR: sb.tmp } });
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.mode, 'demo');
  assert.equal(report.results.length, 4);
});

test('the JSON schema matches docs/json-schema.md, field for field', async (t) => {
  const sb = sandbox(t);
  const { stdout } = await runCli(['demo', '--json'], { env: { HOME: sb.home, TMPDIR: sb.tmp } });
  const report = JSON.parse(stdout);
  assert.equal(report.schema_version, 1);
  assert.deepEqual(Object.keys(report).sort(), ['exit_code', 'mode', 'results', 'schema_version', 'status', 'summary', 'tool'].sort());
  assert.deepEqual(report.tool, { name: 'vw-canary', version: pkg.version });
  assert.equal(report.status, 'fail');
  assert.equal(report.exit_code, 1);
  assert.deepEqual(report.summary, { total: 4, passed: 3, failed: 1, errors: 0 });
  const failed = report.results.find((r) => r.status === 'fail');
  assert.deepEqual(Object.keys(failed).sort(), ['client', 'duration_ms', 'error', 'first_failure', 'server', 'server_log', 'status', 'steps']);
  assert.deepEqual(Object.keys(failed.server).sort(), ['image', 'requested', 'resolved']);
  assert.deepEqual(Object.keys(failed.client).sort(), ['package', 'requested', 'resolved']);
  assert.equal(failed.steps.length, 8);
  assert.deepEqual(Object.keys(failed.steps[0]).sort(), ['duration_ms', 'error', 'name', 'status']);
  const bad = failed.steps.find((s) => s.status === 'fail');
  assert.deepEqual(Object.keys(bad.error).sort(), ['command', 'exit_code', 'message', 'stderr', 'stdout']);
  assert.deepEqual(failed.first_failure, { step: bad.name, message: bad.error.message });
  assert.equal(failed.error, null);

  const doc = fs.readFileSync(`${ROOT}/docs/json-schema.md`, 'utf8');
  const seen = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { seen.add(k); walk(x); }
  };
  walk(report);
  for (const key of [...seen, 'stage']) assert.ok(doc.includes(`\`${key}\``), `docs/json-schema.md does not mention ${key}`);
});
