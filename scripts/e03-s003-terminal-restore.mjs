/** Verify actual terminal mode restoration around the production TUI on a real PTY. */
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const { spawn } = createRequire(join(root, 'packages/tui/package.json'))('@lydell/node-pty');
const cwd = await mkdtemp(join(tmpdir(), 'zero2agent-restore-'));
const supervisor = `
const {execFileSync,spawn}=require('node:child_process');
const mode=()=>execFileSync('/bin/stty',['-g'],{stdio:['inherit','pipe','inherit'],encoding:'utf8'}).trim();
const before=mode();
const child=spawn(process.execPath,[process.argv[1]],{stdio:'inherit',env:process.env});
process.stdout.write('CHILD_PID='+child.pid+'\\n');
child.on('exit',(code,signal)=>{
 process.stdout.write('RESTORED_MODE='+String(before===mode())+' EXIT_CODE='+code+' SIGNAL='+signal+'\\n');
 const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout});
 rl.question('ECHO_READY> ',answer=>{process.stdout.write('AFTER_INPUT='+answer+'\\n');rl.close()});
});`;
const results = [];
try {
  for (const kind of ['exit', 'SIGTERM', 'SIGHUP']) {
    let output = '', ended = false;
    const host = spawn(process.execPath, ['-e', supervisor, join(root, 'packages/tui/dist/cli.js')], {
      cwd, cols: 80, rows: 24, name: 'xterm-256color', env: { PATH:'/usr/bin:/bin', HOME:cwd, TMPDIR:cwd, TERM:'xterm-256color', ZERO2AGENT_SKIP_LOCAL_ENV:'1', ANTHROPIC_API_KEY:'offline-restoration', ANTHROPIC_BASE_URL:'http://127.0.0.1:9', MODEL_NAME:'offline-restoration', CONTEXT_WINDOW:'200000' },
    });
    host.onData(data => output += data);
    const exit = new Promise(resolve => host.onExit(result => { ended = true; resolve(result); }));
    async function wait(marker) {
      const until = Date.now() + 10_000;
      while (!output.includes(marker)) {
        if (ended || Date.now() > until) throw new Error('Missing ' + marker + '\n' + output.slice(-2000));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try {
      await wait('你: ');
      if (kind === 'exit') host.write('exit\r');
      else process.kill(Number(output.match(/CHILD_PID=(\d+)/)[1]), kind);
      await wait('ECHO_READY> ');
      assert(output.includes('RESTORED_MODE=true'));
      const expected = { exit: 0, SIGTERM: 143, SIGHUP: 129 }[kind];
      assert(output.includes('EXIT_CODE=' + expected));
      host.write('canonical-input\r');
      await wait('AFTER_INPUT=canonical-input');
      const result = await exit;
      assert.equal(result.exitCode, 0);
      results.push({ kind, sttyModeRestored: true, canonicalInputRestored: true, tuiExitCode: expected });
    } finally {
      if (!ended) { host.kill('SIGTERM'); await exit; }
    }
  }
  console.log(JSON.stringify({ platform:process.platform, node:process.version, capturedAt:new Date().toISOString(), fixture:'Real outer PTY; production TUI; /bin/stty before/after; parent readline after child exit', passed:true, results },null,2));
} finally { await rm(cwd, {recursive:true, force:true}); }
