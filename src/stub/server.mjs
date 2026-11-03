// Just enough of the Vaultwarden API for the demo and the tests. It stores what clients
// send without being able to read it, the same as the real server.
import crypto from 'node:crypto';
import https from 'node:https';
import { makeCert } from '../cert.mjs';

const CIPHER_PATH = /^\/api\/ciphers\/([^/]+)(\/delete)?$/;

export async function startStub({ tls, cipherField = 'ciphers', signups = true } = {}) {
  const pair = tls ?? makeCert();
  const accounts = new Map();
  const tokens = new Map();
  const ciphers = new Map();
  const requests = [];

  const handle = (req, raw) => {
    const url = new URL(req.url, 'https://127.0.0.1').pathname;
    const route = `${req.method} ${url}`;
    let body = raw;
    if (req.headers['content-type']?.includes('json') && raw) body = JSON.parse(raw);
    requests.push({ method: req.method, url, body });

    if (route === 'GET /alive') return [200, new Date().toISOString()];
    if (route === 'GET /api/config') return [200, { version: 'stub', server: { name: 'bundled stub' } }];
    if (route === 'POST /identity/accounts/prelogin') {
      const a = accounts.get(body.email);
      return [200, { kdf: 0, kdfIterations: a?.kdfIterations ?? 600000, kdfMemory: null, kdfParallelism: null }];
    }
    if (route === 'POST /identity/accounts/register/send-verification-email') {
      if (!signups) return [400, { message: 'Registration not allowed or user already exists' }];
      return [200, `stub-token-${body.email}`];
    }
    if (route === 'POST /identity/accounts/register/finish') {
      if (body.emailVerificationToken !== `stub-token-${body.email}`) return [400, { message: 'Invalid claim' }];
      accounts.set(body.email, body);
      return [200, { object: 'registerFinish' }];
    }
    if (route === 'POST /identity/connect/token') {
      const form = new URLSearchParams(raw);
      const a = accounts.get(form.get('username'));
      if (!a || a.masterPasswordHash !== form.get('password')) {
        return [400, { error: 'invalid_grant', error_description: 'invalid_username_or_password', message: 'Username or password is incorrect. Try again' }];
      }
      const token = crypto.randomBytes(16).toString('hex');
      tokens.set(token, a);
      return [200, { access_token: token, token_type: 'Bearer', expires_in: 3600, Key: a.key, PrivateKey: a.keys.encryptedPrivateKey, Kdf: a.kdf, KdfIterations: a.kdfIterations }];
    }

    const account = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!account) return [401, { message: 'Unauthorized' }];

    if (route === 'GET /api/sync') {
      return [200, {
        object: 'sync',
        profile: { email: account.email, name: account.name, key: account.key, privateKey: account.keys.encryptedPrivateKey },
        folders: [],
        [cipherField]: [...ciphers.values()],
      }];
    }
    if (route === 'POST /api/ciphers') {
      const now = new Date().toISOString();
      const cipher = { ...body, id: crypto.randomUUID(), object: 'cipherDetails', creationDate: now, revisionDate: now, deletedDate: null };
      ciphers.set(cipher.id, cipher);
      return [200, cipher];
    }
    const m = CIPHER_PATH.exec(url);
    if (m && req.method === 'PUT') {
      const old = ciphers.get(m[1]);
      if (!old) return [404, { message: 'Cipher does not exist' }];
      const now = new Date().toISOString();
      const next = m[2] ? { ...old, deletedDate: now, revisionDate: now } : { ...old, ...body, id: old.id, revisionDate: now };
      ciphers.set(old.id, next);
      return [200, next];
    }
    return [404, { message: `The stub has no route for ${route}` }];
  };

  const server = https.createServer({ cert: pair.cert, key: pair.key }, (req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const [status, payload] = handle(req, raw);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/alive' ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `https://127.0.0.1:${port}`,
    ca: String(pair.cert),
    requests,
    stop: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}
