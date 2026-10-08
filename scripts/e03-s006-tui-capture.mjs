import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const auditDeps = process.env.TUI_AUDIT_DEPS;
if (!auditDeps) throw new Error('Set TUI_AUDIT_DEPS to a directory with @xterm/xterm installed.');
const out = root + '/researches/file-checkpoints/acceptance/screens';
await mkdir(out, { recursive: true });
const require = createRequire(root + '/packages/tui/package.json');
const { spawn } = require('@lydell/node-pty');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? createRequire(auditDeps + '/package.json').resolve('playwright'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH }) });
try {
const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 1 });
const css = await readFile(auditDeps + '/node_modules/@xterm/xterm/css/xterm.css', 'utf8');
await page.setContent(`<style>${css}body{margin:0;background:#11151d;color:#ddd;padding:24px}#terminal{padding:16px;background:#131923;border:1px solid #334151;border-radius:12px;display:inline-block}h1{font:16px system-ui;margin:0 0 16px;color:#a4b5c9}</style><h1>Zero2Agent · E03-S006 · 真实 PTY 输出</h1><div id="terminal"></div>`);
await page.addScriptTag({ path: auditDeps + '/node_modules/@xterm/xterm/lib/xterm.js' });
await page.evaluate(() => { window.term = new Terminal({ cols: 96, rows: 30, fontFamily: 'Menlo, monospace', fontSize: 14, lineHeight: 1.2, theme: { background:'#131923', foreground:'#dce3ed', cyan:'#72d7e7', green:'#91d69d', yellow:'#f0d590' }, allowProposedApi: true }); window.term.open(document.getElementById('terminal')); });
let raw = '', pos = 0, exited = false;
const pty = spawn(process.execPath, [root + '/scripts/e03-s006-checkpoint-demo.mjs', '--tui'], { name: 'xterm-256color', cols: 96, rows: 30, cwd: root, env: { PATH: process.env.PATH, HOME:auditDeps, TMPDIR:'/tmp', TERM:'xterm-256color' } });
pty.onData(data => raw += data);
const exit = new Promise(resolve => pty.onExit(event => { exited = true; resolve(event); }));
async function waitExit(ms = 10_000) { let timer; try { return await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Demo did not exit')), ms); })]); } finally { clearTimeout(timer); } }
async function until(marker, from=0) { const deadline=Date.now()+15000; while(!raw.slice(from).includes(marker)) { if(Date.now()>deadline || exited) throw Error('Missing '+marker+'\n'+raw.slice(-3500)); await new Promise(r=>setTimeout(r,25)); } }
async function paint(name) { await new Promise(r=>setTimeout(r,140)); const data=raw.slice(pos);pos=raw.length; await page.evaluate(data => new Promise(r=>window.term.write(data,r)),data); await page.locator('#terminal').screenshot({path:out+'/'+name+'.png'}); const screen=await page.evaluate(()=>Array.from({length:window.term.rows},(_,i)=>window.term.buffer.active.getLine(i)?.translateToString(true, 0, window.term.cols)??'').join('\n')); await writeFile(out+'/'+name+'.txt',screen.split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n'); console.log('Captured ' + name); }
try {
 await until('你: '); await paint('01-session-with-checkpoint');
 let from=raw.length;pty.write('/checkpoints\r');await until('选择文件 Checkpoint',from);await paint('02-file-list');
 from=raw.length;pty.write('\r');await until('文件差异',from);await paint('03-file-diff');
 from=raw.length;pty.write('r');await until('确认文件回退',from);await paint('04-restore-preview');
 pty.resize(42,18);await page.evaluate(()=>window.term.resize(42,18));await paint('05-narrow-restore-preview');
 pty.resize(96,30);await page.evaluate(()=>window.term.resize(96,30));from=raw.length;pty.write('y');await until('已回退',from);await paint('06-restored');
 from=raw.length;pty.write('/checkpoint-stats\r');await until('Checkpoint 占用',from);await paint('07-storage');
 from=raw.length;pty.write('\x1b');await until('你: ',from);
 from=raw.length;pty.write('exit\r');await until('再见',from);await waitExit();
 const workspace = raw.match(/临时工作目录：([^\r\n]+)（退出自动删除）/)?.[1];
 assert(workspace, 'Demo must report its temporary directory');
 assert.equal(await access(workspace).then(() => true, () => false), false);
 assert(raw.slice(from).includes('\x1b[?1049l'));
 assert(raw.slice(from).includes('\x1b[?25h'));
 await writeFile(out+'/raw-pty.ansi.gz',gzipSync(raw));
 await writeFile(out+'/capture.json',JSON.stringify({platform:process.platform,viewport:[96,30],narrow:[42,18],fixture:'local SSE; production CLI in real node-pty; raw output replayed in xterm.js 6.0.0',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),capturedAt:new Date().toISOString(),sourceHashes:Object.fromEntries(await Promise.all(['packages/core/src/file-mutations.ts','packages/core/src/loop.ts','packages/tui/src/checkpoint-store.ts','packages/tui/src/checkpoint-view.ts','packages/tui/src/conversations.ts','packages/tui/src/runtime-tui.ts','packages/tui/src/cli.ts'].map(async name=>[name,createHash('sha256').update(await readFile(root+'/'+name)).digest('hex')]))),rawSha256:createHash('sha256').update(raw).digest('hex'),restorationEscapesObserved:true,demoWorkspaceRemoved:true},null,2));
} finally { if(!exited) { pty.kill('SIGTERM'); try { await waitExit(); } catch { pty.kill('SIGKILL'); await waitExit(); } } }
} finally { await browser.close(); }
