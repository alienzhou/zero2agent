// Optional browser QA for this chapter. No dependency is added to the course site.
// PLAYWRIGHT_MODULE selects an existing Playwright module; CHROME_PATH is optional.
// SITE_BASE_URL enables reader checks against a running `pnpm site:preview` server.
// COURSE_QA_PAGE optionally limits diagram checks to one exact manifest filename.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const chapter = 'epic03-story003';
const dir = path.join(root, 'site/chapters', chapter);
const output = process.env.COURSE_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'e03-s003-course-'));
fs.mkdirSync(output, {recursive: true});
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const {chromium} = await import(path.isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pages.json')));
const selectedPages = manifest.pages.filter(page => !process.env.COURSE_QA_PAGE || page.file === process.env.COURSE_QA_PAGE);
if (!selectedPages.length) throw new Error('COURSE_QA_PAGE does not match a manifest page');
const results = {chapter, browser: browser.version(), pages: [], reader: [], failures: []};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
results.sources = Object.fromEntries(['author.cjs'].map(file => [file, hash(new URL(file, import.meta.url))]));
results.sources['course.css'] = hash(path.join(dir, 'course.css'));

try {
  const page = await browser.newPage({viewport: {width: 1080, height: 1440}, deviceScaleFactor: 1});
  for (const entry of selectedPages) {
    await page.goto(pathToFileURL(path.join(dir, entry.file)).href);
    await page.evaluate(() => document.fonts.ready);
    const check = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet').getBoundingClientRect();
      const overflow = [...document.querySelectorAll('h1,.deck,.explain,.diagram,.terminal')]
        .map(el => ({kind: el.tagName, text: el.textContent.slice(0, 60), rect: el.getBoundingClientRect().toJSON()}))
        .filter(e => e.rect.bottom > sheet.bottom + 1 || e.rect.right > sheet.right + 1 || e.rect.left < sheet.left - 1);
      const svgTextOverflow = [...document.querySelectorAll('svg text')].flatMap(el => {
        const b = el.getBBox(), v = el.ownerSVGElement.viewBox.baseVal;
        return b.x < 0 || b.x + b.width > v.width + 1 || b.y < 0 || b.y + b.height > v.height + 1 ? [{text: el.textContent}] : [];
      });
      const textOverlaps = [];
      for (const svg of document.querySelectorAll('svg')) {
        const all = [...svg.querySelectorAll('text')];
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
          const a = all[i].getBBox(), b = all[j].getBBox();
          const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (dx > 2 && dy > 2) textOverlaps.push([all[i].textContent, all[j].textContent]);
        }
      }
      return {overflow, svgTextOverflow, textOverlaps};
    });
    results.pages.push({file: entry.file, sha256: hash(path.join(dir, entry.file)), ...check});
    if (Object.values(check).some(items => items.length)) results.failures.push(entry.file);
    await page.screenshot({path: path.join(output, entry.file.replace('.html', '.png'))});
  }
  for (let sheet = 0; sheet < Math.ceil(selectedPages.length / 9); sheet++) {
    const images = selectedPages.slice(sheet * 9, sheet * 9 + 9).map(p => `<img src="${pathToFileURL(path.join(output, p.file.replace('.html', '.png'))).href}">`).join('');
    const contact = path.join(output, `contact-${sheet + 1}.html`);
    fs.writeFileSync(contact, `<style>body{margin:0;background:#ccc;display:grid;grid-template-columns:repeat(3,360px);gap:8px}img{width:360px;height:480px}</style>${images}`);
    await page.setViewportSize({width: 1096, height: 1456});
    await page.goto(pathToFileURL(contact).href);
    await page.screenshot({path: path.join(output, `contact-${sheet + 1}.png`)});
  }
  await page.close();

  if (process.env.SITE_BASE_URL) {
    const base = process.env.SITE_BASE_URL.replace(/\/$/, '');
    const course = JSON.parse(fs.readFileSync(path.join(root, 'site/course.json')));
    const entry = course.chapters.find(item => item.id === chapter);
    for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
      const reader = await browser.newPage({viewport, deviceScaleFactor: 1});
      const errors = [];
      reader.on('pageerror', error => errors.push(error.message));
      reader.on('response', response => {if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
      await reader.goto(`${base}/#/chapter/${chapter}/${entry.pages[0].id}`);
      await reader.locator('.lesson-section').first().waitFor();
      await reader.locator('iframe').first().contentFrame().locator('h1').waitFor();
      const overflow = await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await reader.screenshot({path: path.join(output, `reader-${viewport.width}.png`)});
      await reader.locator('.text-content summary').first().click();
      const textOpen = await reader.locator('.text-content').first().evaluate(el => el.open && el.querySelectorAll('p').length > 0);
      await reader.locator('.zoom-button').first().click();
      const zoomOpen = await reader.locator('.zoom-button').first().getAttribute('aria-expanded') === 'true';
      await reader.locator('.zoom-button').first().click();
      const zoomClosed = await reader.locator('.zoom-button').first().getAttribute('aria-expanded') === 'false';
      if (viewport.width < 600) {
        await reader.locator('#outline-button').click();
        await reader.screenshot({path: path.join(output, 'reader-mobile-outline.png')});
      }
      await reader.locator(`[data-outline-page="${entry.pages[8].id}"]`).click();
      await reader.waitForURL(`**/${entry.pages[8].id}`);
      await reader.waitForFunction(id => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 170, entry.pages[8].id, {timeout: 5000});
      await reader.screenshot({path: path.join(output, `reader-${viewport.width}-approval.png`)});
      const targetReachable = await reader.locator(`[id="${entry.pages[8].id}"]`).evaluate(el => Math.abs(el.getBoundingClientRect().top) < 170);
      const check = {viewport, sections: await reader.locator('.lesson-section').count(), overflow, textOpen, zoomOpen, zoomClosed, targetReachable, errors};
      results.reader.push(check);
      if (overflow || !textOpen || !zoomOpen || !zoomClosed || !targetReachable || errors.length || check.sections !== 18) results.failures.push(`reader-${viewport.width}`);
      await reader.close();
    }
  }
} finally {
  await browser.close();
}
results.passed = results.failures.length === 0;
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({output, passed: results.passed, failures: results.failures, pages: results.pages.length, reader: results.reader}, null, 2));
if (!results.passed) process.exitCode = 1;
