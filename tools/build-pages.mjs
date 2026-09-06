import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '_site');
const roots = ['index.html', 'styles.css', 'src', 'examples', 'VoltWeave-Standalone.html', 'LICENSE', 'ARCHITECTURE.md', 'OPERATORS.md'];

try {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['tools/standalone.py'], { cwd: root, stdio: 'inherit' });
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const entry of roots) {
    const source = join(root, entry);
    if (!existsSync(source)) throw new Error(`Missing deployment asset: ${entry}`);
    cpSync(source, join(output, entry), { recursive: true, errorOnExist: true, force: false });
  }
  writeFileSync(join(output, '.nojekyll'), '');
  const files = {};
  function inventory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name);
      if (entry.name === '.nojekyll') continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not deployable: ${path}`);
      if (entry.isDirectory()) inventory(path);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        files[relative(output, path).split('\\').join('/')] = { size: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex') };
      } else throw new Error(`Unsupported deployment asset: ${path}`);
    }
  }
  inventory(output);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const commit = process.env.GITHUB_SHA || 'local';
  if (commit !== 'local' && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Invalid GITHUB_SHA');
  writeFileSync(join(output, 'build-info.json'), JSON.stringify({ schemaVersion: 1, application: 'VoltWeave Studio', version, commit, files }, null, 2) + '\n');
  console.log(`Staged ${Object.keys(files).length} assets in ${relative(root, output)} for ${commit}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
