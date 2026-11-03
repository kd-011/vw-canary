// The report with nothing real behind it: the stub server and the fake client, talking real
// HTTPS with real Bitwarden-style encryption, in-process and in a temp dir.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub/server.mjs';

const FAKE_BW = fileURLToPath(new URL('./stub/fake-bw.mjs', import.meta.url));

export const DEMO_SERVERS = ['stub-a', 'stub-b'];
export const DEMO_CLIENTS = ['fake-old', 'fake-new'];

// stub-b moved the cipher list to a new field. fake-old only knows the old name, so its
// vault comes back empty with no error, which is what a real break tends to look like.
export const demoProvider = {
  iterations: 5000,
  preflight: async () => {},
  describeServer: (version) => `${version} (bundled stub)`,
  describeClient: (version) => `${version} (bundled fake client)`,
  installClient: async (version) => ({
    command: [process.execPath, path.normalize(FAKE_BW), `--profile=${version === 'fake-old' ? 'old' : 'new'}`, `--report-version=${version}`],
  }),
  startServer: async (version) => {
    const stub = await startStub({ cipherField: version === 'stub-b' ? 'items' : 'ciphers' });
    return { url: stub.url, ca: stub.ca, resolved: version, stop: stub.stop };
  },
};
