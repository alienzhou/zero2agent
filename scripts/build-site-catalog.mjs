import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const configuration = JSON.parse(await readFile(new URL('../.authoring/site/course.json', import.meta.url), 'utf8'));
const epics = configuration.epics;
const definitions = configuration.chapters;
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}[name]));
}
function paragraphsFromHTML(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const text = body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|defs)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:div|p|h[1-6]|li|pre|section|article|text|header|footer|tr|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}
const chapters = [];
for (const [index, {id, title, description, sourceURL, epic}] of definitions.entries()) {
  if (!/^epic\d{2}-story\d{3}$/.test(id) || !epics.some(item => item.id === epic)) throw new Error("Invalid chapter metadata: " + id);
  const directory = path.join(site, 'chapters', id);
  const manifest = JSON.parse(await readFile(path.join(directory, 'pages.json'), 'utf8'));
  const files = manifest.pages.map(page => page.file);
  const pages = [];
  for (const [pageIndex, file] of files.entries()) {
    if (!/^\d{2}-[\w-]+\.html$/.test(file)) throw new Error('Invalid page filename: ' + file);
    const html = await readFile(path.join(directory, file), 'utf8');
    const paragraphs = paragraphsFromHTML(html);
    const pageTitle = manifest.pages[pageIndex].title;
    if (!pageTitle || !paragraphs.length) throw new Error('Missing readable content: ' + id + '/' + file);
    pages.push({id: file.slice(0, -5), file, number: pageIndex + 1, title: pageTitle, paragraphs});
  }
  const [, epicNumber, storyNumber] = id.match(/^epic(\d+)-story(\d+)$/);
  chapters.push({
    id, number: index + 1, epic, title, description,
    code: 'E' + epicNumber + '-S' + storyNumber,
    sourceURL,
    pages,
  });
}
const data = {title: 'Zero2Agent', epics, chapters, totalPages: chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0)};
await writeFile(path.join(site, 'course.json'), JSON.stringify(data, null, 2) + '\n');
console.log('Course catalog: ' + chapters.length + ' chapters, ' + data.totalPages + ' diagrams.');
