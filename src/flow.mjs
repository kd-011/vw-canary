// The steps a real client goes through. A step fails when bw exits non-zero, or when what
// it says afterwards does not match what was put in: an empty vault with exit 0 is a failure.
import { assertLoopback } from './register.mjs';

export const STEP_NAMES = ['config server', 'login', 'sync', 'create item', 'sync again', 'list and decrypt', 'edit item', 'delete item'];

const DEFAULT_TIMEOUT_MS = 180000;

const ITEM = {
  organizationId: null,
  collectionIds: null,
  folderId: null,
  type: 1,
  name: 'vw-canary test item',
  notes: 'made up by vw-canary',
  favorite: false,
  fields: [],
  login: { uris: [{ match: null, uri: 'https://example.invalid/' }], username: 'canary', password: 'not-a-real-password', totp: null },
  reprompt: 0,
};
const EDITED = { ...ITEM, name: 'vw-canary test item, edited', notes: 'edited by vw-canary' };

const encoded = (item) => Buffer.from(JSON.stringify(item)).toString('base64');

class StepFailure extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

const MAX_LINE = 400;

/**
 * The lines worth reading. Drops stack frames, the notes bw prints on any first run, and
 * the source excerpt Node prints above a crash. Very long lines are cut. The raw text stays
 * in the step's stdout and stderr.
 */
export function cleanText(text) {
  const lines = text.split('\n');
  const crash = lines.findIndex((l, i) => /^\S.*:\d+$/.test(l) && /^\s*\^+\s*$/.test(lines[i + 2] ?? ''));
  if (crash >= 0) lines.splice(crash, 3);
  return lines
    .filter((l) => l.trim() && !/^\s+at\s/.test(l) && !/^Could not find (dir|data file)/.test(l) && !/^Node\.js v\d/.test(l))
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)} ... (cut, --json has all of it)` : l))
    .join('\n');
}

function compareItem(got, want, short) {
  const fields = { name: [got?.name, want.name], notes: [got?.notes, want.notes], 'login.username': [got?.login?.username, want.login.username], 'login.password': [got?.login?.password, want.login.password], 'login.uri': [got?.login?.uris?.[0]?.uri, want.login.uris[0].uri] };
  for (const [field, [a, b]] of Object.entries(fields)) {
    if (a !== b) throw new StepFailure(`${short} returned ${field} as ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`, { command: short });
  }
}

export async function runFlow({ client, url, account, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  assertLoopback(url);
  let session = '';
  let itemId = null;

  const redact = (text) => {
    let out = text;
    for (const secret of [account.password, session]) if (secret) out = out.replaceAll(secret, '[redacted]');
    return out;
  };

  // Long base64 arguments are noise in a report. The test item holds nothing worth seeing.
  const bw = async (args) => {
    const command = `bw ${args.map((a) => (a.length > 60 ? '<encoded item>' : a)).join(' ')}`;
    const short = `bw ${['login', 'sync'].includes(args[0]) ? args[0] : args.slice(0, 2).join(' ')}`;
    const env = { VW_CANARY_PASSWORD: account.password };
    if (session) env.BW_SESSION = session;
    const res = await client.run(args, { env, timeoutMs });
    const details = { command, exit_code: res.code, stdout: res.stdout, stderr: res.stderr };
    if (res.spawnError) throw new StepFailure(`could not run ${short}: ${res.spawnError.message}`, details);
    if (res.timedOut) throw new StepFailure(`${short} timed out after ${Math.round(timeoutMs / 1000)}s`, details);
    if (res.code !== 0) throw new StepFailure(`${short} exited ${res.code}: ${cleanText(res.stderr) || cleanText(res.stdout) || '(no output)'}`, details);
    return { ...res, short, details };
  };

  const bwJson = async (args) => {
    const res = await bw(args);
    try {
      return { value: JSON.parse(res.stdout), ...res };
    } catch {
      throw new StepFailure(`${res.short} did not print JSON: ${cleanText(res.stdout) || cleanText(res.stderr) || '(no output)'}`, res.details);
    }
  };

  const listItems = async () => {
    const res = await bwJson(['list', 'items']);
    if (!Array.isArray(res.value)) throw new StepFailure(`${res.short} did not print a list`, res.details);
    return res;
  };

  const actions = {
    'config server': () => bw(['config', 'server', url]),
    login: async () => {
      const res = await bw(['login', account.email, '--passwordenv', 'VW_CANARY_PASSWORD', '--raw']);
      session = res.stdout.trim();
      if (!session) throw new StepFailure(`${res.short} exited 0 but printed no session key`, res.details);
    },
    sync: () => bw(['sync']),
    'create item': async () => {
      const res = await bwJson(['create', 'item', encoded(ITEM)]);
      if (!res.value?.id) throw new StepFailure(`${res.short} returned no item id`, res.details);
      itemId = res.value.id;
      compareItem(res.value, ITEM, res.short);
    },
    // --force, or bw compares revision dates and may skip the download.
    'sync again': () => bw(['sync', '--force']),
    'list and decrypt': async () => {
      const res = await listItems();
      const found = res.value.find((i) => i.id === itemId);
      if (!found) {
        throw new StepFailure(`${res.short} exited ${res.code} and returned ${res.value.length} items. The item created earlier should be there.`, res.details);
      }
      try {
        compareItem(found, ITEM, res.short);
      } catch (err) {
        err.details = res.details;
        throw err;
      }
    },
    'edit item': async () => {
      const edit = await bwJson(['edit', 'item', itemId, encoded(EDITED)]);
      compareItem(edit.value, EDITED, edit.short);
      await bw(['sync', '--force']);
      const got = await bwJson(['get', 'item', itemId]);
      compareItem(got.value, EDITED, got.short);
    },
    'delete item': async () => {
      await bw(['delete', 'item', itemId]);
      await bw(['sync', '--force']);
      const res = await listItems();
      if (res.value.some((i) => i.id === itemId)) {
        throw new StepFailure(`${res.short} still shows the item after bw delete item and a forced sync`, res.details);
      }
    },
  };

  const steps = [];
  let failed = false;
  for (const name of STEP_NAMES) {
    if (failed) {
      steps.push({ name, status: 'skip', duration_ms: 0, error: null });
      continue;
    }
    const started = Date.now();
    try {
      await actions[name]();
      steps.push({ name, status: 'pass', duration_ms: Date.now() - started, error: null });
    } catch (err) {
      if (!(err instanceof StepFailure)) throw err;
      failed = true;
      const d = err.details;
      steps.push({
        name,
        status: 'fail',
        duration_ms: Date.now() - started,
        error: {
          message: redact(err.message),
          command: redact(d.command ?? ''),
          exit_code: d.exit_code ?? null,
          stdout: redact(d.stdout ?? ''),
          stderr: redact(d.stderr ?? ''),
        },
      });
    }
  }
  return steps;
}
