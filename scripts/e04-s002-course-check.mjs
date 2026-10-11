import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.COURSE_URL ?? 'http://127.0.0.1:8896';
const root=process.cwd();
const out=path.join(root,'.authoring/site/chapters/epic04-story002/verification');
await fs.mkdir(out,{recursive:true});
const chapter='epic04-story002';
const manifest=JSON.parse(await fs.readFile(`site/chapters/${chapter}/pages.json`,'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={capturedAt:new Date().toISOString(),browser:browser.version(),pages:[],reader:[],errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 for(const entry of manifest.pages){
  await page.goto(`${base}/chapters/${chapter}/${entry.file}`);
  await page.evaluate(()=>document.fonts.ready);
  const issues=await page.evaluate(()=>{
   const issues=[];
   const sheet=document.querySelector('.sheet').getBoundingClientRect();
   for(const el of document.querySelectorAll('[data-block],svg')) {
    const r=el.getBoundingClientRect();
    if(r.x<sheet.x-1||r.right>sheet.right+1||r.bottom>sheet.bottom-16||r.top<sheet.top) issues.push({type:'page-boundary',tag:el.tagName,text:el.textContent.slice(0,60),box:[r.x,r.y,r.width,r.height]});
   }
   for(const svg of document.querySelectorAll('svg')){
    const view=svg.viewBox.baseVal;
    const texts=[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,box:t.getBBox()}));
    for(const {text,box:r} of texts) if(r.x < -1 || r.x+r.width>view.width+1||r.y< -1||r.y+r.height>view.height+1) issues.push({type:'svg-boundary',text,box:[r.x,r.y,r.width,r.height]});
    for(let a=0;a<texts.length;a++)for(let b=a+1;b<texts.length;b++){
     const x=texts[a].box,y=texts[b].box;
     if(Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)>2&&Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)>2) issues.push({type:'text-overlap',text:[texts[a].text,texts[b].text]});
    }
   }
   return issues;
  });
  await page.screenshot({path:path.join(out,entry.file.replace('.html','.png'))});
  report.pages.push({file:entry.file,issues});
 }
 for(let group=0;group<3;group++){
  // Render the actual HTML pages through scaled iframes, rather than redrawing the figures.
  await page.setViewportSize({width:1080,height:960});
  await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,360px)}.cell{width:360px;height:480px;overflow:hidden}iframe{width:1080px;height:1440px;border:0;transform:scale(.333333);transform-origin:top left}</style>${manifest.pages.slice(group*6,group*6+6).map(p=>`<div class="cell"><iframe src="${base}/chapters/${chapter}/${p.file}"></iframe></div>`).join('')}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({path:path.join(out,`contact-${group+1}.png`)});
 }
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  await page.setViewportSize(viewport);
  await page.goto(`${base}/#/chapter/${chapter}`);
  await page.locator('.lesson-section').first().waitFor();
  const count=await page.locator('.lesson-section').count();
  if(count!==18)throw Error('Reader chapter must have 18 sections');
  await page.locator('.text-content summary').first().click();
  if(!await page.locator('.text-content').first().getAttribute('open') && !await page.locator('.text-content').first().evaluate(el=>el.open)) throw Error('Text cannot expand');
  await page.locator('.zoom-button').first().click();
  if(await page.locator('.zoom-button').first().getAttribute('aria-expanded')!=='true')throw Error('Cannot zoom figure');
  await page.screenshot({path:path.join(out,`reader-${viewport.width}-expanded.png`)});
  await page.locator('.zoom-button').first().click();
  await page.locator('.text-content summary').first().click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow)throw Error('Reader overflows horizontally');
  if(viewport.width<1100){
   await page.locator('#outline-button').click();
   await page.screenshot({path:path.join(out,'reader-mobile-outline.png')});
  }
  await page.locator('.outline-link').nth(6).click();
  await page.waitForFunction(()=>location.hash.includes('07-'));
  await page.bringToFront();
  await page.locator('[id="07-utf8"]').waitFor({state:'visible'}).catch(()=>{});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForTimeout(400);
  const selected=await page.locator('.lesson-section').nth(6).getAttribute('id');
  await page.screenshot({path:path.join(out,`reader-${viewport.width}.png`)});
  report.reader.push({viewport,count,textExpanded:true,zoom:true,navigation:true,selected,horizontalOverflow:overflow});
 }
 report.sourceHashes=Object.fromEntries(await Promise.all(['.authoring/site/chapters/epic04-story002/author.cjs','site/chapters/epic04-story002/course.css','site/chapters/epic04-story002/pages.json'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
}finally{await browser.close();await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({pages:report.pages.length,issues:report.pages.filter(p=>p.issues.length),errors:report.errors}));
if(report.pages.some(p=>p.issues.length)||report.errors.length)process.exitCode=1;
