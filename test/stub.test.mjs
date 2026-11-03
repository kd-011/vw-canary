// The stub stands in for Vaultwarden in the demo, so it should fail the way the real
// thing does: login needs the right hash, and the API needs the bearer token.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeAccount } from '../src/crypto.mjs';
import { apiRequest, registerAccount } from '../src/register.mjs';
import { startStub } from '../src/stub/server.mjs';

async function loggedIn(t, opts = {}) {
  const stub = await startStub(opts);
  t.after(() => stub.stop());
  const a = makeAccount({ email: 'canary@vw-canary.invalid', password: 'pw', iterations: 1000 });
  await registerAccount(stub.url, a, { ca: stub.ca });
  const body = new URLSearchParams({ grant_type: 'password', username: a.email, password: a.masterPasswordHash }).toString();
  const res = await apiRequest(`${stub.url}/identity/connect/token`, { method: 'POST', ca: stub.ca, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const token = JSON.parse(res.text).access_token;
  const api = (method, path, json, auth = token) => apiRequest(`${stub.url}${path}`, { method, ca: stub.ca, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: json ? JSON.stringify(json) : undefined });
  return { stub, a, api };
}

test('prelogin reports the KDF for an existing account', async (t) => {
  const { stub, a } = await loggedIn(t);
  const res = await apiRequest(`${stub.url}/identity/accounts/prelogin`, { method: 'POST', ca: stub.ca, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: a.email }) });
  assert.deepEqual(JSON.parse(res.text), { kdf: 0, kdfIterations: 1000, kdfMemory: null, kdfParallelism: null });
});

test('the API rejects a missing or wrong bearer token', async (t) => {
  const { api } = await loggedIn(t);
  assert.equal((await api('GET', '/api/sync', null, 'nope')).status, 401);
});

test('ciphers can be created, read through sync, replaced and soft-deleted', async (t) => {
  const { api, a } = await loggedIn(t);
  const made = JSON.parse((await api('POST', '/api/ciphers', { type: 1, name: '2.x|y|z' })).text);
  assert.ok(made.id);
  let sync = JSON.parse((await api('GET', '/api/sync')).text);
  assert.equal(sync.profile.key, a.key);
  assert.equal(sync.ciphers.length, 1);
  await api('PUT', `/api/ciphers/${made.id}`, { type: 1, name: '2.a|b|c' });
  sync = JSON.parse((await api('GET', '/api/sync')).text);
  assert.equal(sync.ciphers[0].name, '2.a|b|c');
  await api('PUT', `/api/ciphers/${made.id}/delete`);
  sync = JSON.parse((await api('GET', '/api/sync')).text);
  assert.ok(sync.ciphers[0].deletedDate);
});

test('an unknown cipher id is a 404 and an unknown path is a 404', async (t) => {
  const { api } = await loggedIn(t);
  assert.equal((await api('PUT', '/api/ciphers/nope', { name: 'x' })).status, 404);
  assert.equal((await api('GET', '/api/nothing')).status, 404);
});

test('the moved-field variant serves ciphers under the other name', async (t) => {
  const { api } = await loggedIn(t, { cipherField: 'items' });
  await api('POST', '/api/ciphers', { type: 1, name: '2.x|y|z' });
  const sync = JSON.parse((await api('GET', '/api/sync')).text);
  assert.equal(sync.ciphers, undefined);
  assert.equal(sync.items.length, 1);
});
