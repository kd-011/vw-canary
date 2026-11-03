import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { decString, encString, makeAccount, masterKey, masterPasswordHash, stretch } from '../src/crypto.mjs';

const pbkdf2 = (p, s, i) => crypto.pbkdf2Sync(p, s, i, 32, 'sha256');

test('master key is PBKDF2-SHA256 of the password, salted with the lowercased email', () => {
  assert.deepEqual(masterKey('pw', 'Someone@Example.Test', 1000), pbkdf2('pw', 'someone@example.test', 1000));
});

test('password hash is one more PBKDF2 round of the master key, salted with the password', () => {
  const mk = pbkdf2('pw', 'a@b.test', 1000);
  assert.equal(masterPasswordHash(mk, 'pw'), pbkdf2(mk, 'pw', 1).toString('base64'));
});

test('stretch is HKDF-Expand with the info strings enc and mac, no extract step', () => {
  const mk = Buffer.alloc(32, 7);
  const expand = (info) => crypto.createHmac('sha256', mk).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();
  const { enc, mac } = stretch(mk);
  assert.deepEqual(enc, expand('enc'));
  assert.deepEqual(mac, expand('mac'));
});

test('an EncString is type 2 with iv, ciphertext and MAC, and round-trips', () => {
  const keys = { enc: crypto.randomBytes(32), mac: crypto.randomBytes(32) };
  const s = encString(Buffer.from('hello'), keys);
  assert.match(s, /^2\.[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+\|[A-Za-z0-9+/=]+$/);
  const [iv, ct, mac] = s.slice(2).split('|').map((p) => Buffer.from(p, 'base64'));
  assert.equal(iv.length, 16);
  assert.equal(ct.length, 16);
  assert.deepEqual(mac, crypto.createHmac('sha256', keys.mac).update(Buffer.concat([iv, ct])).digest());
  assert.equal(decString(s, keys).toString(), 'hello');
});

test('decString refuses a tampered ciphertext instead of returning junk', () => {
  const keys = { enc: crypto.randomBytes(32), mac: crypto.randomBytes(32) };
  const [iv, ct, mac] = encString(Buffer.from('hello'), keys).split('|');
  const flipped = Buffer.from(ct, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decString(`${iv}|${flipped.toString('base64')}|${mac}`, keys), /MAC/);
});

test('makeAccount wraps a 64-byte user key and an RSA private key that matches the public key', () => {
  const a = makeAccount({ email: 'canary@vw-canary.invalid', password: 'pw', iterations: 1000 });
  const mk = masterKey('pw', a.email, 1000);
  assert.equal(a.masterPasswordHash, masterPasswordHash(mk, 'pw'));
  assert.equal(a.kdf, 0);
  assert.equal(a.kdfIterations, 1000);
  const user = decString(a.key, stretch(mk));
  assert.equal(user.length, 64);
  const der = decString(a.keys.encryptedPrivateKey, { enc: user.subarray(0, 32), mac: user.subarray(32) });
  const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  assert.equal(priv.asymmetricKeyDetails.modulusLength, 2048);
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  assert.equal(a.keys.publicKey, spki.toString('base64'));
});

test('two accounts never share a user key', () => {
  const opts = { email: 'canary@vw-canary.invalid', password: 'pw', iterations: 1000 };
  assert.notEqual(makeAccount(opts).key, makeAccount(opts).key);
});
