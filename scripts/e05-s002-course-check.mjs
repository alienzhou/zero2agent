// Local browser verification; screenshots remain in ignored tmp/, never in course sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.COURSE_URL ?? 'http://127.0.0.1:8897';
const root=process.cwd();
const chapter=process.env.COURSE_CHAPTER ?? 'epic05-story002';
if(!/^epic\d{2}-story\d{3}$/.test(chapter)) throw Error('Invalid chapter id');
const evidenceRoot=path.join(root,'tmp/e05-s002');
await fs.mkdir(evidenceRoot,{recursive:true});
const out=await fs.mkdtemp(path.join(evidenceRoot,'course-'));
const manifest=JSON.parse(await fs.readFile(`site/chapters/${chapter}/pages.json`,'utf8'));
if(manifest.pages.length<2||manifest.pages.length>manifest.maxImages) throw Error('Invalid authored page count');
const actual=(await fs.readdir(`site/chapters/${chapter}`)).filter(file=>/^\d{2}-.*\.html$/.test(file)).sort();
if(JSON.stringify(actual)!==JSON.stringify(manifest.pages.map(p=>p.file).sort())) throw Error('Manifest and page files differ');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={capturedAt:new Date().toISOString(),chapter,browser:browser.version(),manifestPages:manifest.pages.length,pages:[],reader:[],errors:[],requestFailures:[],resourceErrors:[]};
const sources=[`.authoring/site/chapters/${chapter}/author.cjs`,`site/chapters/${chapter}/course.css`,`site/chapters/${chapter}/pages.json`,'scripts/e05-s002-course-check.mjs',...manifest.pages.map(entry=>`site/chapters/${chapter}/${entry.file}`)];
report.sourceHashes=Object.fromEntries(await Promise.all(sources.map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
try {
  const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('requestfailed',request=>report.requestFailures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{if(response.status()>=400)report.resourceErrors.push({url:response.url(),status:response.status()});});
  for(const entry of manifest.pages){
    const response=await page.goto(`${base}/chapters/${chapter}/${entry.file}`,{waitUntil:'networkidle'});
    if(!response?.ok())throw Error('Page request failed: '+entry.file);
    await page.evaluate(()=>document.fonts.ready);
    const issues=await page.evaluate(()=>{
      const issues=[];
      const sheet=document.querySelector('.sheet')?.getBoundingClientRect();
      if(!sheet)return [{type:'missing-sheet'}];
      if(sheet.width!==1080||sheet.height!==1440)issues.push({type:'sheet-size',box:[sheet.width,sheet.height]});
      for(const element of document.querySelectorAll('[data-block],.page-header,.cover-tags,svg,pre')){
        const box=element.getBoundingClientRect();
        if(box.x<sheet.x-1||box.right>sheet.right+1||box.bottom>sheet.bottom-16||box.top<sheet.top)
          issues.push({type:'page-boundary',tag:element.tagName,text:element.textContent.slice(0,80),box:[box.x,box.y,box.width,box.height]});
        if(element.tagName==='PRE'&&(element.scrollWidth>element.clientWidth+1||element.scrollHeight>element.clientHeight+1))
          issues.push({type:'pre-overflow',text:element.textContent.slice(0,80)});
      }
      for(const diagram of document.querySelectorAll('svg')){
        const view=diagram.viewBox.baseVal;
        for(const terminal of diagram.querySelectorAll('[data-terminal]')){
          const [x,y,width,height]=terminal.getAttribute('data-terminal').split(' ').map(Number);
          for(const text of terminal.querySelectorAll('text')){
            const box=text.getBBox();
            if(box.x<x+12||box.x+box.width>x+width-12||box.y<y+12||box.y+box.height>y+height-12)
              issues.push({type:'terminal-text-boundary',text:text.textContent,box:[box.x,box.y,box.width,box.height]});
          }
        }
        const texts=[...diagram.querySelectorAll('text')].map(text=>({text:text.textContent,box:text.getBBox()}));
        for(const {text,box} of texts)
          if(box.x<view.x-1||box.x+box.width>view.x+view.width+1||box.y<view.y-1||box.y+box.height>view.y+view.height+1)
            issues.push({type:'svg-text-boundary',text,box:[box.x,box.y,box.width,box.height]});
        const geometry=diagram.getBBox();
        if(geometry.x<view.x-1||geometry.x+geometry.width>view.x+view.width+1||geometry.y<view.y-1||geometry.y+geometry.height>view.y+view.height+1)
          issues.push({type:'svg-geometry-boundary',box:[geometry.x,geometry.y,geometry.width,geometry.height]});
        for(let a=0;a<texts.length;a++)for(let b=a+1;b<texts.length;b++){
          const x=texts[a].box,y=texts[b].box;
          if(Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)>2&&Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)>2)
            issues.push({type:'text-overlap',text:[texts[a].text,texts[b].text]});
        }
      }
      return issues;
    });
    await page.screenshot({path:path.join(out,entry.file.replace('.html','.png'))});
    report.pages.push({file:entry.file,sources:entry.sources,issues});
  }
  for(let group=0;group<Math.ceil(manifest.pages.length/6);group++){
    await page.setViewportSize({width:1080,height:960});
    await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,360px)}.cell{width:360px;height:480px;overflow:hidden}iframe{width:1080px;height:1440px;border:0;transform:scale(.333333);transform-origin:top left}</style>${manifest.pages.slice(group*6,group*6+6).map(entry=>`<div class="cell"><iframe src="${base}/chapters/${chapter}/${entry.file}"></iframe></div>`).join('')}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({path:path.join(out,`contact-${group+1}.png`)});
  }
  const selectedIndex=Math.min(6,manifest.pages.length-1);
  const selectedFile=manifest.pages[selectedIndex].file.replace('.html','');
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.goto(`${base}/#/chapter/${chapter}`,{waitUntil:'networkidle'});
    await page.locator('.lesson-section').first().waitFor();
    const count=await page.locator('.lesson-section').count();
    if(count!==manifest.pages.length)throw Error('Reader chapter differs from the authored manifest');
    await page.locator('.text-content summary').first().click();
    if(!await page.locator('.text-content').first().evaluate(element=>element.open))throw Error('Text cannot expand');
    const extracted=await page.locator('.text-content').first().innerText();
    if(!extracted.includes('Agent')||extracted.trim().length<60)throw Error('Reader text content missing');
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
    await page.locator('.outline-link').nth(selectedIndex).click();
    await page.waitForFunction(file=>location.hash.includes(file),selectedFile);
    await page.locator('.lesson-section').nth(selectedIndex).waitFor({state:'visible'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForTimeout(400);
    const selected=await page.locator('.lesson-section').nth(selectedIndex).getAttribute('id');
    await page.screenshot({path:path.join(out,`reader-${viewport.width}.png`)});
    report.reader.push({viewport,count,textExpanded:true,zoom:true,navigation:true,selected,horizontalOverflow:overflow});
  }
}catch(error){
  report.errors.push(error.message);
  process.exitCode=1;
}finally{
  await browser.close();
  await fs.writeFile(path.join(out,'checks.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({evidenceDirectory:out,pages:report.pages.length,reader:report.reader,issues:report.pages.filter(page=>page.issues.length),errors:report.errors,requestFailures:report.requestFailures,resourceErrors:report.resourceErrors}));
if(report.pages.some(page=>page.issues.length)||report.errors.length||report.requestFailures.length||report.resourceErrors.length)process.exitCode=1;
