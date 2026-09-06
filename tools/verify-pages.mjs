import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] || process.env.PAGE_URL || 'http://localhost:8080/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const expectedCommit = process.env.GITHUB_SHA || 'local';
const attempts = Number(process.env.VERIFY_ATTEMPTS || 24);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) throw new Error('Invalid VERIFY_ATTEMPTS');

async function read(path) {
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error(`Unsafe asset path: ${path}`);
  url.searchParams.set('verify', expectedCommit);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function verify() {
  const info = JSON.parse((await read('build-info.json')).toString('utf8'));
  if (info.application !== 'VoltWeave Studio' || info.schemaVersion !== 1 || info.commit !== expectedCommit)
    throw new Error(`Published commit is ${info.commit}; expected ${expectedCommit}`);
  const entries = Object.entries(info.files || {});
  for (const required of ['index.html', 'styles.css', 'src/app.js', 'src/worker.js', 'src/runtime.js', 'VoltWeave-Standalone.html'])
    if (!info.files[required]) throw new Error(`Missing required asset: ${required}`);
  for (let offset = 0; offset < entries.length; offset += 4) {
    await Promise.all(entries.slice(offset, offset + 4).map(async ([path, file]) => {
      const bytes = await read(path);
      if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
        throw new Error(`Published asset checksum mismatch: ${path}`);
    }));
  }
  console.log(`Verified ${entries.length} deployed assets and commit ${info.commit} at ${base.href}`);
}

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    await verify();
    break;
  } catch (error) {
    if (attempt === attempts) throw error;
    console.log(`Verification ${attempt}/${attempts}: ${error.message}`);
    await delay(5000);
  }
}
