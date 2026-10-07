// Export-only normalization added after the initial run: trim derived text frames. Raw ANSI capture is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {createRequire} from 'node:module';
const require=createRequire('/Users/zhouhongxuan/program/works/zero2agent-e03-s003/packages/tui/package.json');
const pty=require('@lydell/node-pty');
const {Terminal}=createRequire('/tmp/zero2agent-research/ux-opencode/package.json')('@xterm/headless');
const product=process.argv[2];
const taskRoot=fs.mkdtempSync(path.join('/tmp/zero2agent-research/',`ux-${product}-`));
const taskHome=path.join(taskRoot,'home');
const cwd=path.join(taskRoot,'work');
fs.mkdirSync(taskHome,{recursive:true});fs.mkdirSync(cwd,{recursive:true});
const env={PATH:process.env.PATH,HOME:taskHome,TMPDIR:taskRoot,TERM:'xterm-256color',LANG:'en_US.UTF-8',XDG_CONFIG_HOME:path.join(taskHome,'.config'),XDG_DATA_HOME:path.join(taskHome,'.local/share'),XDG_CACHE_HOME:path.join(taskHome,'.cache'),OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_SHARE:'1',OPENCODE_DISABLE_CLAUDE_CODE:'1',OPENCODE_DISABLE_EXTERNAL_SKILLS:'1',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_PROJECT_CONFIG:'1',OPENCODE_DISABLE_MODELS_FETCH:'1'};
let executable,args;
if(product==='codex'){
 executable='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
 args=['--no-daemon','--no-alt-screen','-s','read-only','-a','never','-m','ui-observation','-c','model_provider="observation"','-c','model_providers.observation={ name="UI observation", base_url="http://127.0.0.1:9", wire_api="responses", requires_openai_auth=false }'];
}else{
 executable='/tmp/zero2agent-research/ux-opencode/node_modules/.bin/opencode';args=[];
 env.OPENCODE_CONFIG_CONTENT=JSON.stringify({autoupdate:false,share:'disabled',enabled_providers:[],plugin:[],permission:'deny'});
}
const terminal=new Terminal({cols:100,rows:32,allowProposedApi:true});
const child=pty.spawn(executable,args,{name:'xterm-256color',cols:100,rows:32,cwd,env});
let raw='';let seq=0;let dead=false;
const metadata={product,executable,args,cwd,taskHome,initialSize:{cols:100,rows:32},started:new Date().toISOString(),actions:[]};
child.onData(data=>{raw+=data;terminal.write(data);if(data.includes('\x1b]11;?'))child.write('\x1b]11;rgb:0000/0000/0000\x07');});
terminal.onData(data=>child.write(data));
function frame(label){const rows=[];for(let y=0;y<terminal.rows;y++)rows.push(terminal.buffer.active.getLine(terminal.buffer.active.viewportY+y)?.translateToString(true)??'');const text=rows.map(row=>row.trimEnd()).join('\n').trimEnd();fs.writeFileSync(path.join(taskRoot,`${String(seq++).padStart(2,'0')}-${label}.txt`),text+'\n');fs.writeFileSync(path.join(taskRoot,'terminal.ansi'),raw);fs.writeFileSync(path.join(taskRoot,'metadata.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify({taskRoot,label,frame:text}));}
child.onExit(e=>{dead=true;metadata.exit=e;frame('exit');setTimeout(()=>process.exit(0),100);});
await new Promise(r=>setTimeout(r,2200));frame('startup');
const input=readline.createInterface({input:process.stdin});
for await(const line of input){let act;try{act=JSON.parse(line);}catch{continue;}metadata.actions.push(act);if(act.resize){terminal.resize(act.resize.cols,act.resize.rows);child.resize(act.resize.cols,act.resize.rows);}if(act.text)child.write(act.text);await new Promise(r=>setTimeout(r,act.wait??650));frame(act.label??'action');if(act.stop&&!dead){child.kill();await new Promise(r=>setTimeout(r,300));process.exit(0);}}
