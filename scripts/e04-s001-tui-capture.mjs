/** Capture lossless local-fixture PTY evidence; render snapshots by replaying actual bytes. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const auditDeps = process.env.TUI_AUDIT_DEPS;
if (!auditDeps) throw Error('Set TUI_AUDIT_DEPS to an existing @xterm/xterm dependency directory.');
const out = root + '/researches/failure-recovery/acceptance/screens';
await mkdir(out, {recursive:true});
const {spawn} = createRequire(root+'/packages/tui/package.json')('@lydell/node-pty');
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? createRequire(auditDeps+'/package.json').resolve('playwright'));
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH && {executablePath:process.env.CHROME_PATH})});
let raw='', pos=0, ended=false;
const host = spawn(process.execPath,[root+'/scripts/e04-s001-recovery-demo.mjs','--tui'],{name:'xterm-256color',cols:96,rows:30,cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,TERM:'xterm-256color',TMPDIR:process.env.TMPDIR??'/tmp'}});
host.onData(data=>raw+=data);
const exit = new Promise(resolve=>host.onExit(result=>{ended=true;resolve(result)}));
async function waitExit(ms=10000){let timer;try{return await Promise.race([exit,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Demo did not exit')),ms))]);}finally{clearTimeout(timer)}}
async function until(marker,from=0){const deadline=Date.now()+15000;while(!raw.slice(from).includes(marker)){if(ended||Date.now()>deadline)throw Error('Missing '+marker+'\n'+raw.slice(-2000));await new Promise(r=>setTimeout(r,25));}}
try {
 const page = await browser.newPage({viewport:{width:1080,height:800},deviceScaleFactor:1});
 const css = await readFile(auditDeps+'/node_modules/@xterm/xterm/css/xterm.css','utf8');
 await page.setContent(`<style>${css}body{margin:0;background:#F4F1EA;padding:24px}#terminal{padding:16px;background:#202622;border:1px solid #596057;border-radius:10px;display:inline-block}h1{font:16px system-ui;margin:0 0 16px;color:#596057}</style><h1>Zero2Agent · E04-S001 · local SSE / production CLI / real PTY</h1><div id="terminal"></div>`);
 await page.addScriptTag({path:auditDeps+'/node_modules/@xterm/xterm/lib/xterm.js'});
 await page.evaluate(()=>{window.term=new Terminal({cols:96,rows:30,fontFamily:'Menlo, monospace',fontSize:14,lineHeight:1.2,theme:{background:'#202622',foreground:'#F4F1EA',cyan:'#9EDAC8',green:'#A6D0A7',yellow:'#F0D393'},allowProposedApi:true});window.term.open(document.getElementById('terminal'));});
 async function paint(name){await new Promise(r=>setTimeout(r,180));const data=raw.slice(pos);pos=raw.length;await page.evaluate(data=>new Promise(r=>window.term.write(data,r)),data);await page.locator('#terminal').screenshot({path:out+'/'+name+'.png'});const screen=await page.evaluate(()=>Array.from({length:window.term.rows},(_,i)=>window.term.buffer.active.getLine(i)?.translateToString(true,0,window.term.cols)??'').join('\n'));await writeFile(out+'/'+name+'.txt',screen+'\n');console.log('Captured '+name);}
 await until('你: ');await paint('01-ready');
 let from=raw.length;host.write('演示等待取消\r');await until('20000ms',from);await paint('02-backoff');
 host.resize(54,14);await page.evaluate(()=>window.term.resize(54,14));await paint('02b-backoff-course');
 host.resize(96,30);await page.evaluate(()=>window.term.resize(96,30));
 from=raw.length;host.write('\x03');await until('本轮已取消',from);await paint('03-cancelled');
 from=raw.length;host.write('演示半截流\r');await until('已保存 r',from);await paint('04-draft-and-recovered');
 host.resize(42,18);await page.evaluate(()=>window.term.resize(42,18));await paint('05-narrow');
 host.resize(96,30);await page.evaluate(()=>window.term.resize(96,30));
 from=raw.length;host.write('/logs\r');await until('选择运行日志',from);await paint('06-log-list');
 from=raw.length;host.write('\r');await until('查看运行日志',from);host.write('\x1b[F');await paint('07-attempt-log');
 from=raw.length;host.write('\x1b');await until('选择运行日志',from);
 from=raw.length;host.write('\x1b');await until('你: ',from);
 from=raw.length;host.write('exit\r');await until('再见',from);const result=await waitExit();assert.equal(result.exitCode,0);
 const cwd=raw.match(/临时工作目录：([^\r\n]+)（退出自动删除）/)?.[1];assert(cwd);assert.equal(await access(cwd).then(()=>true,()=>false),false);
 assert(raw.slice(from).includes('\x1b[?1049l'));assert(raw.slice(from).includes('\x1b[?25h'));
 // The demo injects only a public placeholder key. No configured service is loaded.
 await writeFile(out+'/raw-pty.ansi.gz',gzipSync(raw));
 const sourceFiles=['scripts/e04-s001-recovery-demo.mjs','packages/core/src/loop.ts','packages/core/src/request-executor.ts','packages/tui/src/runtime-state.ts','packages/tui/src/runtime-tui.ts','packages/tui/src/cli.ts'];
 await writeFile(out+'/capture.json',JSON.stringify({capturedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:process.platform,node:process.version,browser:browser.version(),xterm:JSON.parse(await readFile(auditDeps+'/node_modules/@xterm/xterm/package.json','utf8')).version,viewport:[96,30],narrow:[42,18],fixture:'local HTTP/SSE; production CLI and real PTY; actual bytes replayed through xterm.js',sourceHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(root+'/'+f)).digest('hex')]))),rawSha256:createHash('sha256').update(raw).digest('hex'),screensAreDerived:true,rawLossless:true,terminalRestorationEscapes:true,demoWorkspaceRemoved:true},null,2)+'\n');
} finally {if(!ended){host.kill('SIGTERM');try{await waitExit()}catch{host.kill('SIGKILL');await waitExit()}}await writeFile(out+'/raw-pty.ansi.gz',gzipSync(raw));await browser.close()}
