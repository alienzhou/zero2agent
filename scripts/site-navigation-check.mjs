import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.COURSE_URL ?? 'http://127.0.0.1:8898';
const course = JSON.parse(await fs.readFile('site/course.json', 'utf8'));
const [previous, next] = course.chapters.slice(-2);
await fs.mkdir('tmp/site-navigation', {recursive:true});
const output = await fs.mkdtemp(path.resolve('tmp/site-navigation/review-'));
const report = {sourceHashes:{}, viewports:[], errors:[]};
const browser = await chromium.launch({channel:'chrome', headless:true});
report.browser = browser.version();
try {
  for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
    });
    const result = {viewport, from:previous.id, to:next.id};
    report.viewports.push(result);
    const waitChapter = async chapter => {
      await page.waitForFunction(({id, count}) =>
        location.hash.startsWith(`#/chapter/${id}`) &&
        document.querySelectorAll('.lesson-section').length === count,
        {id:chapter.id, count:chapter.pages.length}, {timeout:3000});
    };
    try {
      await page.goto(`${base}/#/chapter/${previous.id}`);
      await waitChapter(previous);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // Force a real scroll callback to settle after a native link changes the hash,
      // but before hashchange handles it. The old reader overwrote the new route here.
      result.queuedScrollFrames = await page.evaluate(() => {
        const native = window.requestAnimationFrame;
        const queued = [];
        window.requestAnimationFrame = callback => { queued.push(callback); return queued.length; };
        try {
          window.dispatchEvent(new Event('scroll'));
          document.querySelector('.chapter-pagination a:last-child').click();
        } finally {
          window.requestAnimationFrame = native;
        }
        for (const callback of queued) callback(performance.now());
        return queued.length;
      });
      if (!result.queuedScrollFrames) throw Error('Scroll/navigation interleaving was not exercised');
      await waitChapter(next);
      result.pendingScrollCannotOverwriteNavigation = true;

      await page.locator('.chapter-pagination a').first().click();
      await waitChapter(previous);
      await page.locator('.chapter-pagination a').nth(1).click();
      await waitChapter(next);
      result.pointerPagination = true;
      await page.goBack();
      await waitChapter(previous);
      result.browserBack = true;

      await page.locator('#search-button').click();
      await page.locator('#search-input').fill(next.title);
      await page.locator(`.search-result[href*="${next.id}"]`).first().click();
      await waitChapter(next);
      if (await page.locator('#search-dialog').evaluate(el => el.open)) throw Error('Search dialog stayed open');
      result.search = true;
      const target = next.pages[Math.floor(next.pages.length / 2)];
      if (viewport.width < 1100) await page.locator('#outline-button').click();
      await page.locator(`[data-outline-page="${target.id}"]`).click();
      await page.waitForFunction(id => location.hash.endsWith(`/${id}`), target.id);
      await page.reload();
      await page.waitForFunction(id => document.querySelector('[aria-current="location"]')?.getAttribute('data-outline-page') === id, target.id);
      result.deepLinkAndReload = true;
      await page.screenshot({path:path.join(output, `reader-${viewport.width}.png`)});
    } catch (error) {
      result.failure = {message:error.message, url:page.url()};
      await page.screenshot({path:path.join(output, `failure-${viewport.width}.png`)});
      throw error;
    } finally {
      await page.close();
    }
  }
} catch (error) {
  report.errors.push(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const file of ['site/assets/book.js', 'site/course.json', 'scripts/site-navigation-check.mjs'])
    report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, ...report}));
  if (report.errors.length) process.exitCode = 1;
}
