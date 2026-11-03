// Creates the throwaway account over the Vaultwarden API, and holds the one guard every
// request here goes through: https on 127.0.0.1, or nothing is sent.
import https from 'node:https';

export function assertLoopback(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== '127.0.0.1') {
    throw new Error(`refusing to talk to ${url}: vw-canary only talks to the container it started on https://127.0.0.1`);
  }
}

export async function apiRequest(url, { method = 'GET', headers = {}, body, ca } = {}) {
  assertLoopback(url);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca, agent: false, timeout: 30000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('timeout', () => req.destroy(new Error(`no answer from ${url} within 30s`)));
    req.on('error', reject);
    req.end(body);
  });
}

function serverMessage(res) {
  try {
    const j = JSON.parse(res.text);
    return j.message ?? j.ErrorModel?.Message ?? j.error_description ?? res.text;
  } catch {
    return res.text || '(empty response)';
  }
}

// Current servers want a token from send-verification-email first. Older ones that lack
// that route take the same fields on /identity/accounts/register.
export async function registerAccount(url, account, { ca }) {
  assertLoopback(url);
  const post = (route, body, headers = {}) => apiRequest(`${url}${route}`, {
    method: 'POST',
    ca,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const { email, name, masterPasswordHash, key, kdf, kdfIterations, keys } = account;
  const form = { email, name, masterPasswordHash, masterPasswordHint: null, key, kdf, kdfIterations, keys };

  const verify = await post('/identity/accounts/register/send-verification-email', { email, name }, { accept: 'application/json' });
  let res;
  if (verify.status === 404) {
    res = await post('/identity/accounts/register', form);
  } else if (verify.status >= 300) {
    throw new Error(`send-verification-email answered ${verify.status}: ${serverMessage(verify)}`);
  } else {
    res = await post('/identity/accounts/register/finish', { ...form, emailVerificationToken: JSON.parse(verify.text) });
  }
  if (res.status >= 300) throw new Error(`registration answered ${res.status}: ${serverMessage(res)}`);
}
