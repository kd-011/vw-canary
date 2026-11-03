// Stands in for npm: "installs" a bw that is the bundled fake client. Client version
// 2026.1.0 gets the old-format profile, 9999.0.0 does not exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.FAKE_STATE, 'calls.jsonl'), `${JSON.stringify({ tool: 'npm', args })}\n`);
const spec = args.find((a) => a.startsWith('@bitwarden/cli@'));
const version = spec.split('@').at(-1);
if (version === '9999.0.0') {
  process.stderr.write(`npm error code ETARGET\nnpm error notarget No matching version found for ${spec}.\n`);
  process.exit(1);
}
const bin = path.join(args[args.indexOf('--prefix') + 1], 'node_modules/.bin');
fs.mkdirSync(bin, { recursive: true });
const fake = fileURLToPath(new URL('../src/stub/fake-bw.mjs', import.meta.url));
const profile = version === '2026.1.0' ? 'old' : 'new';
const run = `"${process.execPath}" "${fake}" --profile=${profile} --report-version=${version}`;
fs.writeFileSync(path.join(bin, 'bw'), `#!/bin/sh\ncase "$1 $2" in\n${process.env.FAKE_NPM_WRAP ?? ''}\nesac\nexec ${run} "$@"\n`);
fs.chmodSync(path.join(bin, 'bw'), 0o755);
