// The server behind the fake docker: the bundled stub, on the certificate passed in. The
// image tag picks how it behaves, so tests can get a real FAIL or a registration error.
import fs from 'node:fs';
import path from 'node:path';
import { startStub } from '../src/stub/server.mjs';

const [dir, image] = process.argv.slice(2);
const version = image.split(':')[1];
const stub = await startStub({
  tls: { cert: fs.readFileSync(path.join(dir, 'cert.pem')), key: fs.readFileSync(path.join(dir, 'key.pem')) },
  cipherField: version === '1.2.0' ? 'items' : 'ciphers',
  signups: version !== '1.0.0',
});
fs.writeFileSync(path.join(dir, 'port'), String(stub.port));
process.on('SIGTERM', () => process.exit(0));
