#!/usr/bin/env node
// A stand-in for the bw CLI, only ever used by `vw-canary demo` and the tests. It takes the
// same arguments and does the same crypto, so the report code cannot tell the difference.
// --profile=old knows only the old name of the cipher list in the sync response.
import fs from 'node:fs';
import path from 'node:path';
import { decString, encString, masterKey, masterPasswordHash, splitUserKey, stretch } from '../crypto.mjs';

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.findIndex((a) => a.startsWith(`--${name}=`));
  return i < 0 ? null : argv.splice(i, 1)[0].split('=')[1];
};
const profile = option('profile') ?? 'new';
const reported = option('report-version') ?? `fake-${profile}`;

const file = path.join(process.env.BITWARDENCLI_APPDATA_DIR ?? '.', 'data.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

async function api(route, { method = 'GET', json, form, auth = true } = {}) {
  const headers = {};
  if (auth) headers.authorization = `Bearer ${state.token}`;
  if (json) headers['content-type'] = 'application/json';
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(`${state.server}${route}`, { method, headers, body: json ? JSON.stringify(json) : form });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) die(body?.message ?? `HTTP ${res.status}`);
  return body;
}

const keys = () => {
  if (!process.env.BW_SESSION) die('You are not logged in.');
  return splitUserKey(Buffer.from(process.env.BW_SESSION, 'base64'));
};
const seal = (text, k) => (text == null ? null : encString(Buffer.from(text), k));
const open = (text, k) => (text == null ? null : decString(text, k).toString());

const sealItem = (item, k) => ({
  ...item,
  name: seal(item.name, k),
  notes: seal(item.notes, k),
  login: { ...item.login, username: seal(item.login.username, k), password: seal(item.login.password, k), uris: item.login.uris.map((u) => ({ ...u, uri: seal(u.uri, k) })) },
});
const openItem = (c, k) => ({
  ...c,
  object: 'item',
  name: open(c.name, k),
  notes: open(c.notes, k),
  login: { ...c.login, username: open(c.login.username, k), password: open(c.login.password, k), uris: c.login.uris.map((u) => ({ ...u, uri: open(u.uri, k) })) },
});

async function sync() {
  const data = await api('/api/sync');
  state.ciphers = (profile === 'old' ? data.ciphers : data.items ?? data.ciphers) ?? [];
  save();
}

const upsert = (cipher) => {
  state.ciphers = [...(state.ciphers ?? []).filter((c) => c.id !== cipher.id), cipher];
  save();
};
const decode = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString());
const print = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);

const [cmd, sub, third, fourth] = argv;

if (cmd === '--version') {
  print(reported);
} else if (cmd === 'config' && sub === 'server') {
  state.server = third;
  save();
  process.stderr.write('Saved setting `config`.\n');
} else if (cmd === 'login') {
  const password = process.env[argv[argv.indexOf('--passwordenv') + 1]];
  const pre = await api('/identity/accounts/prelogin', { method: 'POST', json: { email: sub }, auth: false });
  const master = masterKey(password, sub, pre.kdfIterations);
  const form = new URLSearchParams({ grant_type: 'password', username: sub, password: masterPasswordHash(master, password) }).toString();
  const token = await api('/identity/connect/token', { method: 'POST', form, auth: false });
  state.token = token.access_token;
  save();
  print(decString(token.Key, stretch(master)).toString('base64'));
} else if (cmd === 'sync') {
  await sync();
  print('Syncing complete.');
} else if (cmd === 'create' && sub === 'item') {
  const k = keys();
  const cipher = await api('/api/ciphers', { method: 'POST', json: sealItem(decode(third), k) });
  upsert(cipher);
  print(openItem(cipher, k));
} else if (cmd === 'list' && sub === 'items') {
  const k = keys();
  print((state.ciphers ?? []).filter((c) => !c.deletedDate).map((c) => openItem(c, k)));
} else if (cmd === 'get' && sub === 'item') {
  const k = keys();
  const cipher = (state.ciphers ?? []).find((c) => c.id === third);
  if (!cipher) die('Not found.');
  print(openItem(cipher, k));
} else if (cmd === 'edit' && sub === 'item') {
  const k = keys();
  const cipher = await api(`/api/ciphers/${third}`, { method: 'PUT', json: sealItem(decode(fourth), k) });
  upsert(cipher);
  print(openItem(cipher, k));
} else if (cmd === 'delete' && sub === 'item') {
  keys();
  upsert(await api(`/api/ciphers/${third}/delete`, { method: 'PUT' }));
} else {
  die(`fake bw: unknown command ${argv.join(' ')}`);
}
