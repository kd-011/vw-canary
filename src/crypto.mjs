// The key material a Bitwarden client creates when it signs up. The bw CLI cannot create
// accounts, so vw-canary does this part itself with node:crypto.
import crypto from 'node:crypto';

export function masterKey(password, email, iterations) {
  return crypto.pbkdf2Sync(password, email.trim().toLowerCase(), iterations, 32, 'sha256');
}

export function masterPasswordHash(key, password) {
  return crypto.pbkdf2Sync(key, password, 1, 32, 'sha256').toString('base64');
}

// HKDF-Expand only. crypto.hkdfSync always runs the extract step, which Bitwarden skips.
const expand = (key, info) => crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();

export function stretch(key) {
  return { enc: expand(key, 'enc'), mac: expand(key, 'mac') };
}

/** Type 2 EncString: AES-256-CBC with HMAC-SHA256 over iv + ciphertext. */
export function encString(plain, { enc, mac }) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', enc, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = crypto.createHmac('sha256', mac).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${tag.toString('base64')}`;
}

export function decString(value, { enc, mac }) {
  const m = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(value);
  if (!m) throw new Error('not a type 2 EncString');
  const [iv, ct, tag] = m.slice(1).map((p) => Buffer.from(p, 'base64'));
  const want = crypto.createHmac('sha256', mac).update(Buffer.concat([iv, ct])).digest();
  if (tag.length !== want.length || !crypto.timingSafeEqual(tag, want)) throw new Error('MAC mismatch');
  const decipher = crypto.createDecipheriv('aes-256-cbc', enc, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export const splitUserKey = (key) => ({ enc: key.subarray(0, 32), mac: key.subarray(32) });

/** Everything the register call needs. kdf 0 is PBKDF2-SHA256. */
export function makeAccount({ email, password, iterations = 600000 }) {
  const master = masterKey(password, email, iterations);
  const userKey = crypto.randomBytes(64);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    email,
    password,
    name: 'vw-canary',
    kdf: 0,
    kdfIterations: iterations,
    masterPasswordHash: masterPasswordHash(master, password),
    key: encString(userKey, stretch(master)),
    keys: { publicKey: publicKey.toString('base64'), encryptedPrivateKey: encString(privateKey, splitUserKey(userKey)) },
  };
}
