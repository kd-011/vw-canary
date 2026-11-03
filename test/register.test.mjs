import assert from 'node:assert/strict';
import https from 'node:https';
import { test } from 'node:test';
import { makeCert } from '../src/cert.mjs';
import { makeAccount } from '../src/crypto.mjs';
import { apiRequest, assertLoopback, registerAccount } from '../src/register.mjs';
import { startStub } from '../src/stub/server.mjs';

const account = () => makeAccount({ email: 'canary@vw-canary.invalid', password: 'pw-for-test', iterations: 1000 });

async function login(stub, a, hash = a.masterPasswordHash) {
  const body = new URLSearchParams({ grant_type: 'password', username: a.email, password: hash, scope: 'api offline_access', client_id: 'cli', device_type: '8', device_identifier: 'x', device_name: 'x' }).toString();
  return apiRequest(`${stub.url}/identity/connect/token`, { method: 'POST', ca: stub.ca, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
}

test('registers against the stub, and the stub then accepts only the right password hash', async (t) => {
  const stub = await startStub({});
  t.after(() => stub.stop());
  const a = account();
  await registerAccount(stub.url, a, { ca: stub.ca });
  const ok = await login(stub, a);
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.text).Key, a.key);
  assert.equal((await login(stub, a, 'wrong')).status, 400);
});

test('a server without the verification route falls back to the old register route', async (t) => {
  const seen = [];
  const { cert, key } = makeCert();
  const server = https.createServer({ cert, key }, (req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(req.url);
      if (req.url === '/identity/accounts/register') {
        assert.equal(JSON.parse(body).emailVerificationToken, undefined);
        res.setHeader('content-type', 'application/json');
        return res.end('{}');
      }
      res.statusCode = 404;
      res.end('not here');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await registerAccount(`https://127.0.0.1:${server.address().port}`, account(), { ca: cert });
  assert.deepEqual(seen, ['/identity/accounts/register/send-verification-email', '/identity/accounts/register']);
});

test('a refused registration throws the server\'s own message', async (t) => {
  const stub = await startStub({ signups: false });
  t.after(() => stub.stop());
  await assert.rejects(registerAccount(stub.url, account(), { ca: stub.ca }), /Registration not allowed or user already exists/);
});

test('refuses any address that is not https on 127.0.0.1, before sending anything', async () => {
  for (const url of ['https://vault.example.test', 'http://127.0.0.1:8080', 'https://127.0.0.1.example.test:443', 'https://localhost:8443', 'https://10.0.0.5:443']) {
    assert.throws(() => assertLoopback(url), /127\.0\.0\.1/, url);
    await assert.rejects(registerAccount(url, account(), { ca: 'unused' }), /127\.0\.0\.1/, url);
  }
  assert.doesNotThrow(() => assertLoopback('https://127.0.0.1:32768'));
});
