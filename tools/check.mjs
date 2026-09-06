/** Syntax-check every source/test module using the same Node executable as the caller. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = ['src', 'tests', 'tools'].flatMap(directory => readdirSync(resolve(root, directory))
    .filter(name => /\.(m?js)$/.test(name)).map(name => `${directory}/${name}`));
paths.push('server.mjs');
for (const path of paths) {
    const result = spawnSync(process.execPath, ['--check', resolve(root, path)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${paths.length} JavaScript modules.`);
