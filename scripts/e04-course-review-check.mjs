import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.COURSE_URL ?? 'http://127.0.0.1:8898';
const root = process.cwd();
await fs.mkdir('tmp/e04-course-review', { recursive: true });
const output = await fs.mkdtemp(path.join(root, 'tmp/e04-course-review/browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
try {
  for (const story of [1, 2, 3, 4]) {
    const chapter = `epic04-story${String(story).padStart(3, '0')}`;
    const manifest = JSON.parse(await fs.readFile(`site/chapters/${chapter}/pages.json`, 'utf8'));
    const directory = path.join(output, chapter);
    await fs.mkdir(directory);
    const report = { chapter, capturedAt: new Date().toISOString(), browser: browser.version(), pages: [], reader: [], errors: [] };
    reports.push(report);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('requestfailed', request => report.errors.push(`${request.failure()?.errorText} ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    try {
      for (const entry of manifest.pages) {
        await page.goto(`${base}/chapters/${chapter}/${entry.file}`);
        await page.evaluate(() => document.fonts.ready);
        const issues = await page.evaluate(() => {
          const issues = [];
          const sheet = document.querySelector('.sheet').getBoundingClientRect();
          for (const element of document.querySelectorAll('[data-block],svg')) {
            const r = element.getBoundingClientRect();
            if (r.x < sheet.x - 1 || r.right > sheet.right + 1 || r.bottom > sheet.bottom - 16 || r.top < sheet.top)
              issues.push({ type: 'page-boundary', text: element.textContent.slice(0, 60), box: [r.x, r.y, r.width, r.height] });
          }
          for (const pre of document.querySelectorAll('pre')) if (pre.scrollWidth > pre.clientWidth + 1) issues.push({ type: 'pre-overflow' });
          for (const svg of document.querySelectorAll('svg')) {
            const view = svg.viewBox.baseVal;
            const texts = [...svg.querySelectorAll('text')].map(t => ({ text: t.textContent, box: t.getBBox() }));
            for (const { text, box: r } of texts)
              if (r.x < -1 || r.x + r.width > view.width + 1 || r.y < -1 || r.y + r.height > view.height + 1)
                issues.push({ type: 'svg-boundary', text });
            for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
              const x = texts[a].box, y = texts[b].box;
              if (Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 2 && Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 2)
                issues.push({ type: 'text-overlap', text: [texts[a].text, texts[b].text] });
            }
          }
          return issues;
        });
        await page.screenshot({ path: path.join(directory, entry.file.replace('.html', '.png')) });
        report.pages.push({ file: entry.file, number: entry.number, issues });
      }
      for (let group = 0; group < Math.ceil(manifest.pages.length / 6); group++) {
        await page.setViewportSize({ width: 1080, height: 960 });
        await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,360px)}.cell{width:360px;height:480px;overflow:hidden}iframe{width:1080px;height:1440px;border:0;transform:scale(.333333);transform-origin:top left}</style>${manifest.pages.slice(group * 6, group * 6 + 6).map(p => `<div class="cell"><iframe src="${base}/chapters/${chapter}/${p.file}"></iframe></div>`).join('')}`);
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: path.join(directory, `contact-${group + 1}.png`) });
      }
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`${base}/#/chapter/${chapter}`);
        await page.locator('.lesson-section').first().waitFor();
        const count = await page.locator('.lesson-section').count();
        if (count !== manifest.pages.length) throw Error('Reader and manifest disagree');
        await page.locator('.text-content summary').first().click();
        if (!await page.locator('.text-content').first().evaluate(el => el.open)) throw Error('Text cannot expand');
        await page.locator('.zoom-button').first().click();
        if (await page.locator('.zoom-button').first().getAttribute('aria-expanded') !== 'true') throw Error('Cannot zoom figure');
        await page.screenshot({ path: path.join(directory, `reader-${viewport.width}-expanded.png`) });
        await page.locator('.zoom-button').first().click();
        await page.locator('.text-content summary').first().click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (overflow) throw Error('Reader overflows horizontally');
        if (viewport.width < 1100) await page.locator('#outline-button').click();
        const nav = Math.floor(count / 2);
        const target = manifest.pages[nav].file.replace('.html', '');
        await page.locator('.outline-link').nth(nav).click();
        await page.waitForFunction(id => location.hash.includes(id), target);
        await page.locator('.lesson-section').nth(nav).waitFor({ state: 'visible' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(directory, `reader-${viewport.width}.png`) });
        report.reader.push({ viewport, count, navigation: true, selected: target, textExpanded: true, zoom: true, horizontalOverflow: overflow });
      }
      report.sourceHashes = Object.fromEntries(await Promise.all([`.authoring/site/course.json`, 'site/course.json', 'scripts/e04-course-review-check.mjs', `.authoring/site/chapters/${chapter}/author.cjs`, `site/chapters/${chapter}/course.css`, `site/chapters/${chapter}/pages.json`].map(async file => [file, createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
      report.evidenceDirectory = path.relative(root, directory);
    } finally {
      await page.close();
      await fs.writeFile(path.join(directory, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(reports.map(r => ({ chapter: r.chapter, pages: r.pages.length, issues: r.pages.filter(p => p.issues.length), errors: r.errors })), null, 2) + '\n');
}
console.log(JSON.stringify({ evidenceDirectory: output, chapters: reports.map(r => ({ chapter: r.chapter, pages: r.pages.length, issues: r.pages.filter(p => p.issues.length), errors: r.errors })) }));
if (reports.some(r => r.errors.length || r.pages.some(p => p.issues.length))) process.exitCode = 1;
