// Regenerates docs/screenshots/terminal.png and .github/social-preview.png from a real
// `vw-canary demo` run. Not part of the package. Needs a Chromium-family browser: set
// BROWSER, or it tries chromium, chromium-browser, google-chrome and brave-browser on PATH.
// Playwright's chrome-headless-shell works well here. Brave can hang without writing a file.
//   node scripts/make-hero.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const heroFile = path.join(root, 'docs/screenshots/terminal.png');
const socialFile = path.join(root, '.github/social-preview.png');

const demo = spawnSync(process.execPath, [path.join(root, 'bin/vw-canary.mjs'), 'demo'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
if (demo.status !== 1) throw new Error(`demo should exit 1 (one pair fails on purpose), got ${demo.status}\n${demo.stderr}`);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lines = demo.stdout.trimEnd().split('\n');
const rows = lines.map((line) => {
  const painted = esc(line)
    .replace(/\bPASS\b/g, '<b class="pass">PASS</b>')
    .replace(/\bFAIL\b/g, '<b class="fail">FAIL</b>')
    .replace(/\bSKIP\b/g, '<b class="skip">SKIP</b>');
  return `<div>${painted || '&nbsp;'}</div>`;
});

const candidates = [process.env.BROWSER, 'chromium', 'chromium-browser', 'google-chrome', 'brave-browser'].filter(Boolean);
const browser = candidates.find((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0);
if (!browser) throw new Error('no Chromium-family browser found; set BROWSER');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vwc-hero-'));

function shoot(name, page, width, height, out) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, page);
  fs.rmSync(out, { force: true });
  // A fresh profile, so this works while the same browser is open. Some browsers hang on exit, so the file counts, not the exit code.
  const shot = spawnSync(browser, ['--headless', '--no-sandbox', '--hide-scrollbars', '--no-first-run', '--disable-background-networking', '--disable-component-update', `--user-data-dir=${path.join(dir, 'profile')}`, '--force-device-scale-factor=1', `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${file}`], { encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL' });
  if (!fs.existsSync(out)) throw new Error(`screenshot failed: ${shot.stderr}`);
  console.log(`wrote ${path.relative(root, out)}`);
}

const TERMINAL_CSS = `.bar{padding:26px 44px 0;height:24px}.bar i{display:inline-block;width:20px;height:20px;border-radius:50%;margin-right:14px}
main{padding:30px 44px 30px}b{font-weight:400}.pass{color:#7ee2a8}.fail{color:#ff7b72}.skip{color:#7d8590}`;
const BAR = '<div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>';

shoot('hero.html', `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#d6dbe3;font:20px/34px "IBM Plex Mono","Fira Mono","DejaVu Sans Mono",monospace;white-space:pre}
${TERMINAL_CSS}
</style>${BAR}<main>${rows.join('')}</main>`, 1360, 70 + 60 + lines.length * 34, heroFile);

shoot('social.html', `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:640px;overflow:hidden;color:#f0f2f5;font-family:"Fira Sans","DejaVu Sans",sans-serif;
background:radial-gradient(circle at 0% 100%,#16302a 0,#0b0d12 40%),#0b0d12;position:relative}
.rule{position:absolute;left:72px;top:96px;width:64px;height:8px;border-radius:4px;background:#5fd8a0}
h1{position:absolute;left:72px;top:116px;margin:0;font-size:88px;line-height:112px;font-weight:600;letter-spacing:-2px}
p{position:absolute;left:72px;top:244px;width:480px;margin:0;font-size:32px;line-height:43px;color:#9aa6b6}
.repo{position:absolute;left:72px;top:550px;font:28px "Fira Mono","DejaVu Sans Mono",monospace;color:#5fd8a0}
.term{position:absolute;left:600px;top:96px;width:620px;background:#0d1117;border:1px solid #2a3038;border-radius:18px;color:#d6dbe3;
font:13.5px/21px "Fira Mono","DejaVu Sans Mono",monospace;white-space:pre-wrap;overflow:hidden}
.term .bar{padding:16px 22px 0;height:12px}.term .bar i{width:10px;height:10px;margin-right:7px;display:inline-block;border-radius:50%}
.term main{padding:14px 22px 18px}b{font-weight:400}.pass{color:#7ee2a8}.fail{color:#ff7b72}.skip{color:#7d8590}
</style><div class="rule"></div><h1>vw-canary</h1>
<p>Checks whether a Bitwarden client version still works against a Vaultwarden server version, in a throwaway container.</p>
<div class="repo">kd-011/vw-canary</div>
<div class="term">${BAR}<main>${rows.slice(2, -3).join('')}</main></div>`, 1280, 640, socialFile);

fs.rmSync(dir, { recursive: true, force: true });
