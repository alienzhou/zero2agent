import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else if (entry.isFile()) files.push(target);
    else throw new Error('Only regular files and directories belong in site/: ' + target);
  }
  return files;
}
async function checkReference(root, file, reference, attribute) {
  if (!reference || reference.startsWith('#')) return;
  if (/^data:/i.test(reference)) {
    if (/^data:image\/(?!svg\+xml)/i.test(reference)) throw new Error('Raster data in ' + file);
    return;
  }
  if (/^(https?:)?\/\//i.test(reference)) {
    if (attribute !== 'href') throw new Error('Remote runtime dependency in ' + file + ': ' + reference);
    return;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('/')) {
    throw new Error('Nonportable file reference in ' + file + ': ' + reference);
  }
  const pathname = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!pathname) return;
  const target = path.resolve(path.dirname(file), pathname);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Reference escapes site/: ' + reference);
  await readFile(target).catch(error => {
    throw new Error('Missing dependency in ' + file + ': ' + reference, {cause: error});
  });
}
export async function checkSite(directory) {
  const root = path.resolve(directory);
  const allFiles = await filesUnder(root);
  for (const file of allFiles) {
    if (!['.html', '.css', '.js', '.json'].includes(path.extname(file))) {
      throw new Error('Unexpected deployment file: ' + path.relative(root, file));
    }
    if (!['.html', '.css'].includes(path.extname(file))) continue;
    const body = await readFile(file, 'utf8');
    if (file.endsWith('.html')) {
      for (const match of body.matchAll(/\b(src|href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        await checkReference(root, file, match[2] ?? match[3], match[1].toLowerCase());
      }
    } else {
      for (const match of body.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
        await checkReference(root, file, (match[1] ?? match[2] ?? match[3]).trim(), 'src');
      }
    }
  }
  const course = JSON.parse(await readFile(path.join(root, 'course.json'), 'utf8'));
  const chapterIds = new Set();
  let count = 0;
  for (const chapter of course.chapters) {
    if (chapterIds.has(chapter.id) || !/^epic\d{2}-story\d{3}$/.test(chapter.id)) throw new Error('Invalid or duplicate chapter: ' + chapter.id);
    chapterIds.add(chapter.id);
    if (!chapter.pages.length) throw new Error('Empty chapter: ' + chapter.id);
    const manifest = JSON.parse(await readFile(path.join(root, 'chapters', chapter.id, 'pages.json'), 'utf8'));
    if (manifest.pages.length !== chapter.pages.length) throw new Error('Stale catalog: ' + chapter.id);
    const pageFiles = new Set();
    for (const [index, page] of chapter.pages.entries()) {
      if (!/^\d{2}-[\w-]+\.html$/.test(page.file) || pageFiles.has(page.file) || page.number !== index + 1) throw new Error('Invalid page order: ' + chapter.id);
      pageFiles.add(page.file);
      if (manifest.pages[index].file !== page.file || manifest.pages[index].title !== page.title || manifest.pages[index].number !== page.number) throw new Error('Stale page metadata: ' + chapter.id + '/' + page.file);
      await readFile(path.join(root, 'chapters', chapter.id, page.file));
      if (!page.paragraphs.length) throw new Error('Missing search text: ' + chapter.id + '/' + page.file);
      count++;
    }
    const contentFiles = (await readdir(path.join(root, 'chapters', chapter.id))).filter(file => /^\d{2}-.*\.html$/.test(file));
    if (contentFiles.some(file => !pageFiles.has(file))) throw new Error('Unlisted content page: ' + chapter.id);
  }
  if (course.totalPages !== count) throw new Error('Incorrect total page count');
  console.log('Site check passed: ' + course.chapters.length + ' chapters, ' + count + ' diagrams; local dependencies complete.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkSite(fileURLToPath(new URL('../site/', import.meta.url)));
}
