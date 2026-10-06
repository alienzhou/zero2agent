import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check-site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildSite() {
  const configuration = JSON.parse(await readFile(path.join(root, '.authoring/site/course.json'), 'utf8'));
  for (const chapter of configuration.chapters) {
    if (!/^epic\d{2}-story\d{3}$/.test(chapter.id)) throw new Error('Invalid chapter id: ' + chapter.id);
    const author = path.join(root, '.authoring/site/chapters', chapter.id, 'author.cjs');
    try { await access(author); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    execFileSync(process.execPath, [author], {
      cwd: path.join(root, 'site/chapters', chapter.id),
      stdio: 'inherit',
    });
    console.log('Authored ' + chapter.id);
  }
  execFileSync(process.execPath, [path.join(root, 'scripts/build-site-catalog.mjs')], {stdio: 'inherit'});
  await checkSite(path.join(root, 'site'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
}
