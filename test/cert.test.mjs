import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import { test } from 'node:test';
import { makeCert } from '../src/cert.mjs';

function get(port, opts) {
  return new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port, path: '/', ...opts }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}

test('the certificate is a parseable self-signed X.509 for 127.0.0.1 only', () => {
  const { cert } = makeCert();
  const x = new crypto.X509Certificate(cert);
  assert.equal(x.subjectAltName, 'IP Address:127.0.0.1');
  assert.ok(x.verify(x.publicKey));
  assert.equal(x.ca, true);
  assert.ok(new Date(x.validTo) > new Date());
  assert.ok(new Date(x.validFrom) < new Date());
});

test('a real TLS client trusts it only when handed it as a CA', async (t) => {
  const { cert, key } = makeCert();
  const server = https.createServer({ cert, key }, (req, res) => res.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  assert.equal(await get(port, { ca: cert, agent: false }), 200);
  await assert.rejects(get(port, { agent: false }));
  await assert.rejects(get(port, { ca: makeCert().cert, agent: false }));
});
