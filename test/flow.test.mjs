// The client flow, against the real stub and the fake client over real HTTPS. Each
// failure case uses a wrapper that breaks one bw command the way a real one would.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { makeClient } from '../src/client.mjs';
import { makeAccount } from '../src/crypto.mjs';
import { STEP_NAMES, runFlow } from '../src/flow.mjs';
import { registerAccount } from '../src/register.mjs';
import { startStub } from '../src/stub/server.mjs';
import { FAKE_BW, sandbox, wrapBw } from '../test-support/helpers.mjs';

async function setup(t, command, stubOpts = {}) {
  const sb = sandbox(t);
  const stub = await startStub(stubOpts);
  t.after(() => stub.stop());
  const account = makeAccount({ email: 'canary@vw-canary.invalid', password: 'pw-for-flow-test', iterations: 1000 });
  await registerAccount(stub.url, account, { ca: stub.ca });
  const client = makeClient({ command: command(sb), ca: stub.ca, workdir: sb.path('client') });
  return { sb, stub, account, client, flow: (opts = {}) => runFlow({ client, url: stub.url, account, ...opts }) };
}

const fakeOf = (profile = 'new') => () => [process.execPath, FAKE_BW, `--profile=${profile}`];
const wrapped = (arms) => (sb) => [wrapBw(sb, arms)];
const statuses = (steps) => Object.fromEntries(steps.map((s) => [s.name, s.status]));

function assertFailedAt(steps, name) {
  const i = steps.findIndex((s) => s.status === 'fail');
  assert.equal(steps[i]?.name, name, JSON.stringify(steps.map((s) => [s.name, s.status, s.error?.message])));
  assert.ok(steps.slice(0, i).every((s) => s.status === 'pass'));
  assert.ok(steps.slice(i + 1).every((s) => s.status === 'skip' && s.error === null));
  return steps[i];
}

test('every step passes when client and server agree, with real encryption on the wire', async (t) => {
  const { flow, stub } = await setup(t, fakeOf());
  const steps = await flow();
  assert.deepEqual(steps.map((s) => s.name), STEP_NAMES);
  assert.deepEqual(STEP_NAMES, ['config server', 'login', 'sync', 'create item', 'sync again', 'list and decrypt', 'edit item', 'delete item']);
  assert.ok(steps.every((s) => s.status === 'pass'), JSON.stringify(steps));
  assert.ok(steps.every((s) => Number.isInteger(s.duration_ms)));
  // What reached the server was ciphertext, and the plaintext never did.
  assert.ok(stub.requests.length > 0);
  const wire = JSON.stringify(stub.requests);
  assert.match(wire, /"name":"2\.[^"]+\|[^"]+\|[^"]+"/);
  assert.doesNotMatch(wire, /vw-canary test item/);
});

test('a client that fails prints its own error text, and later steps are skipped', async (t) => {
  const { flow } = await setup(t, wrapped(`"create item") echo "Error: Invalid cipher data." >&2; exit 1;;`));
  const step = assertFailedAt(await flow(), 'create item');
  assert.match(step.error.message, /Invalid cipher data/);
  assert.equal(step.error.exit_code, 1);
  assert.match(step.error.command, /^bw create item/);
});

test('sync that returns an empty vault with no error is caught at the list step', async (t) => {
  const { flow } = await setup(t, fakeOf('old'), { cipherField: 'items' });
  const step = assertFailedAt(await flow(), 'list and decrypt');
  assert.match(step.error.message, /returned 0 items/);
  assert.equal(step.error.exit_code, 0);
});

test('a name that comes back undecryptable fails the list step', async (t) => {
  const { flow } = await setup(t, wrapped(`"list items") real list items | sed 's/"name":"[^"]*"/"name":"[error: cannot decrypt]"/'; exit 0;;`));
  const step = assertFailedAt(await flow(), 'list and decrypt');
  assert.match(step.error.message, /\[error: cannot decrypt\]/);
});

test('a login password that comes back wrong fails the list step', async (t) => {
  const { flow } = await setup(t, wrapped(`"list items") real list items | sed 's/"password":"[^"]*"/"password":"other"/'; exit 0;;`));
  const step = assertFailedAt(await flow(), 'list and decrypt');
  assert.match(step.error.message, /password/);
});

test('login that exits 0 but prints no session fails the login step', async (t) => {
  const { flow } = await setup(t, wrapped(`"login "*) exit 0;;`));
  const step = assertFailedAt(await flow(), 'login');
  assert.match(step.error.message, /no session/);
});

test('output that is not JSON is reported, not parsed into nonsense', async (t) => {
  const { flow } = await setup(t, wrapped(`"create item") echo "You are not logged in."; exit 0;;`));
  const step = assertFailedAt(await flow(), 'create item');
  assert.match(step.error.message, /You are not logged in/);
});

test('an edit the server never stored is caught after a forced sync', async (t) => {
  const { flow } = await setup(t, wrapped(`"edit item") real get item "$3"; exit 0;;`));
  assertFailedAt(await flow(), 'edit item');
});

test('a delete that leaves the item in the vault fails the delete step', async (t) => {
  const { flow } = await setup(t, wrapped(`"delete item") exit 0;;`));
  const step = assertFailedAt(await flow(), 'delete item');
  assert.match(step.error.message, /still/);
});

test('sync again forces a full sync, so the list shows what the server holds', async (t) => {
  const { sb, flow } = await setup(t, (sandboxed) => {
    const log = sandboxed.path('sync-args');
    return [wrapBw(sandboxed, `"sync "*) echo "$*" >> "${log}";;`)];
  });
  const steps = await flow();
  assert.ok(steps.every((s) => s.status === 'pass'), JSON.stringify(steps));
  const lines = fs.readFileSync(sb.path('sync-args'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 2);
  assert.deepEqual(lines.slice(1).filter((l) => !l.includes('--force')), []);
});

test('a hung client is killed at the timeout and reported', async (t) => {
  const { sb, flow } = await setup(t, (s) => [wrapBw(s, `"sync "*) echo $$ > "${s.path('pid')}"; sleep 60;;`)]);
  const started = Date.now();
  const step = assertFailedAt(await flow({ timeoutMs: 1500 }), 'sync');
  assert.match(step.error.message, /timed out after/);
  assert.ok(Date.now() - started < 30000);
  const pid = Number(fs.readFileSync(sb.path('pid'), 'utf8'));
  await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test('stack frames and first-run noise are dropped from the message and kept in the raw text', async (t) => {
  const arms = `"sync "*) printf 'Could not find data file, "/x/data.json"; creating it instead.\\nError: boom\\n    at foo (/x/bw.js:1:1)\\n' >&2; exit 1;;`;
  const { flow } = await setup(t, wrapped(arms));
  const step = assertFailedAt(await flow(), 'sync');
  assert.match(step.error.message, /Error: boom/);
  assert.doesNotMatch(step.error.message, /at foo|creating it instead/);
  assert.match(step.error.stderr, /at foo/);
});

test('a node crash is cut to its error line, and very long lines are shortened', async (t) => {
  const long = 'x'.repeat(5000);
  const arms = `"create item") printf '/tmp/a/bw.js:7207\\n    throw new Error(thing);\\n          ^\\nError: invalid type: ${long}, expected a string\\n\\nNode.js v22.22.3\\n' >&2; exit 1;;`;
  const { flow } = await setup(t, wrapped(arms));
  const step = assertFailedAt(await flow(), 'create item');
  assert.match(step.error.message, /^bw create item exited 1: Error: invalid type: x+/);
  assert.doesNotMatch(step.error.message, /bw\.js|throw new|\^|Node\.js v/);
  assert.ok(step.error.message.length < 700, String(step.error.message.length));
  assert.match(step.error.message, /cut/);
  assert.ok(step.error.stderr.includes(long));
});

test('the message names the command without the throwaway address', async (t) => {
  const { flow } = await setup(t, wrapped(`"login "*) echo "Error: KDF config response does not contain a valid KDF type" >&2; exit 1;;`));
  const step = assertFailedAt(await flow(), 'login');
  assert.equal(step.error.message, 'bw login exited 1: Error: KDF config response does not contain a valid KDF type');
  assert.match(step.error.command, /^bw login canary@vw-canary\.invalid --passwordenv/);
});

test('the throwaway password and session never appear in a step result', async (t) => {
  const arms = `"sync "*) echo "pw=$VW_CANARY_PASSWORD session=$BW_SESSION" >&2; echo "$BW_SESSION"; exit 1;;`;
  const { flow, account } = await setup(t, wrapped(arms));
  const step = assertFailedAt(await flow(), 'sync');
  const text = JSON.stringify(step);
  assert.ok(!text.includes(account.password));
  assert.doesNotMatch(text, /session=[^[ ]/);
  assert.match(text, /\[redacted\]/);
});

test('the flow refuses a server address that is not the local container', async (t) => {
  const { client, account, sb } = await setup(t, fakeOf());
  await assert.rejects(runFlow({ client, url: 'https://vault.example.test', account }), /127\.0\.0\.1/);
  assert.equal(fs.existsSync(sb.path('client', 'appdata', 'data.json')), false);
});

test('statuses helper stays honest about what ran', async (t) => {
  const { flow } = await setup(t, wrapped(`"login "*) echo "Username or password is incorrect. Try again." >&2; exit 1;;`));
  const s = statuses(await flow());
  assert.equal(s['config server'], 'pass');
  assert.equal(s.login, 'fail');
  assert.equal(s.sync, 'skip');
  assert.equal(s['delete item'], 'skip');
});
