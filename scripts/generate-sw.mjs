// Post-build: writes dist/sw.js with a precache list of the built files and a
// content hash as version (any change → new cache → update prompt in the app).

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = join(root, 'dist');

// Large and only needed by some devices: cached at first use instead.
const RUNTIME_ONLY = [/^vendor\/tesseract\/core\//];
const SKIP = [/^sw\.js$/, /\.map$/, /^\.?_/];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await walk(dist)).map((p) => relative(dist, p).split(sep).join('/')).sort();
const hash = createHash('sha256');
const precache = [];
for (const f of files) {
  if (SKIP.some((r) => r.test(f))) continue;
  hash.update(f).update(await readFile(join(dist, f)));
  if (RUNTIME_ONLY.some((r) => r.test(f))) continue;
  precache.push(`./${f}`);
}
precache.unshift('./');

const template = await readFile(join(root, 'src/sw/sw.template.js'), 'utf8');
const version = hash.digest('hex').slice(0, 12);
const sw = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2));
await writeFile(join(dist, 'sw.js'), sw);
console.log(`sw.js written: version ${version}, ${precache.length} precached files`);
