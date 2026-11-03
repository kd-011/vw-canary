// Terminal tables and the --json document. docs/json-schema.md describes the latter, and a
// test keeps the two in step.
import fs from 'node:fs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const color = () => process.stdout.isTTY && !process.env.NO_COLOR;
const CODES = { PASS: 32, FAIL: 31, ERROR: 33, SKIP: 90 };
const paint = (label, text = label) => (color() && CODES[label] ? `\x1b[${CODES[label]}m${text}\x1b[0m` : text);

const indent = (text, by = '  ') => text.split('\n').map((l) => by + l).join('\n');
const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

const versionLabel = ({ requested, resolved }) => (resolved && resolved !== requested ? `${requested} (${resolved})` : requested);

export function renderCheck(r) {
  const lines = [`server ${versionLabel(r.server)}  client ${versionLabel(r.client)}`, ''];
  for (const s of r.steps) {
    const label = s.status.toUpperCase();
    lines.push(s.status === 'skip' ? `  ${paint(label)}  ${s.name}` : `  ${paint(label)}  ${s.name.padEnd(18)}${seconds(s.duration_ms).padStart(8)}`);
  }
  if (r.first_failure) lines.push('', `First failure, ${r.first_failure.step}:`, indent(r.first_failure.message));
  if (r.server_log) lines.push('', 'Last lines of the server log:', indent(r.server_log));
  if (r.error) lines.push(`  ${paint('ERROR')}  ${r.error.stage}`, '', 'The client was not tested:', indent(r.error.message));
  return lines.join('\n');
}

export function renderMatrix(results) {
  const servers = [...new Set(results.map((r) => r.server.requested))];
  const clients = [...new Set(results.map((r) => r.client.requested))];
  const first = Math.max('server \\ client'.length, ...servers.map((s) => s.length)) + 2;
  const cols = clients.map((c) => Math.max(c.length, 5) + 2);
  const lines = [('server \\ client'.padEnd(first) + clients.map((c, i) => c.padEnd(cols[i])).join('')).trimEnd()];
  for (const server of servers) {
    const cells = clients.map((client, i) => {
      const label = results.find((r) => r.server.requested === server && r.client.requested === client).status.toUpperCase();
      return paint(label, i === clients.length - 1 ? label : label.padEnd(cols[i]));
    });
    lines.push(server.padEnd(first) + cells.join(''));
  }
  const problems = results.filter((r) => r.status !== 'pass');
  for (const r of problems) {
    const where = `server ${r.server.requested}, client ${r.client.requested}`;
    lines.push('');
    if (r.first_failure) lines.push(`${where}: FAIL at ${r.first_failure.step}`, indent(r.first_failure.message));
    else lines.push(`${where}: ERROR at ${r.error.stage}, the client was not tested`, indent(r.error.message));
  }
  return lines.join('\n');
}

export function summarise(results) {
  const count = (status) => results.filter((r) => r.status === status).length;
  return { total: results.length, passed: count('pass'), failed: count('fail'), errors: count('error') };
}

export function verdict(results) {
  const { errors, failed } = summarise(results);
  if (errors) return { status: 'error', exit_code: 2 };
  if (failed) return { status: 'fail', exit_code: 1 };
  return { status: 'pass', exit_code: 0 };
}

export function summaryLine(results) {
  const { total, passed, failed, errors } = summarise(results);
  const noun = total === 1 ? 'combination' : 'combinations';
  if (total === 1 && passed === 1) return 'The combination passed.';
  if (passed === total) return `All ${total} ${noun} passed.`;
  const parts = [];
  if (failed) parts.push(total === 1 ? 'The combination failed.' : `${failed} of ${total} ${noun} failed.`);
  if (errors) parts.push(total === 1 ? 'The combination could not be tested.' : `${errors} of ${total} could not be tested.`);
  return parts.join(' ');
}

export function toJson(mode, results) {
  return {
    schema_version: 1,
    tool: { name: 'vw-canary', version: VERSION },
    mode,
    ...verdict(results),
    summary: summarise(results),
    results,
  };
}

export const CAVEAT = 'A PASS means the CLI flow works. It does not test the browser extension, the web vault or the mobile apps.';
