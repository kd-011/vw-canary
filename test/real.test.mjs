// The real thing: a real Vaultwarden container and the real Bitwarden CLI from npm. Skips
// itself when Docker or the network is not there. The pair is pinned so a failure means
// something here broke. The first run downloads an image and about 90 MB of npm packages.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runCli, sandbox } from '../test-support/helpers.mjs';

const SERVER = '1.37.5';
const CLIENT = '2026.10.1';
const dockerOk = spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
const npmOk = spawnSync('npm', ['view', `@bitwarden/cli@${CLIENT}`, 'version'], { stdio: 'ignore', timeout: 20000 }).status === 0;
const skip = !dockerOk ? 'docker is not available' : !npmOk ? 'the npm registry is not reachable' : false;

test(`real Vaultwarden ${SERVER} with real bw ${CLIENT} passes every step`, { skip, timeout: 600000 }, async (t) => {
  const sb = sandbox(t);
  const { code, stdout, stderr } = await runCli(['check', '--server', SERVER, '--client', CLIENT, '--json'], { env: { TMPDIR: sb.tmp, HOME: sb.home, npm_config_cache: sb.path('npm-cache') } });
  const report = JSON.parse(stdout);
  assert.equal(code, 0, `${stderr}\n${JSON.stringify(report.results[0].steps, null, 2)}`);
  const r = report.results[0];
  assert.equal(r.server.resolved, SERVER);
  assert.equal(r.client.resolved, CLIENT);
  assert.ok(r.steps.every((s) => s.status === 'pass'));
  assert.deepEqual(sb.leftovers(), []);
  const left = spawnSync('docker', ['ps', '-aq', '--filter', 'label=vw-canary'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', 'container left behind');
});
