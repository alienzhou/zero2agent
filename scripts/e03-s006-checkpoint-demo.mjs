/** Offline fixture; production SDK/CLI/file tools/checkpoints run unchanged. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CheckpointStore } from '../packages/tui/dist/checkpoint-store.js';
import { SessionStore } from '../packages/tui/dist/session-store.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'zero2agent-s006-demo-'));
const cwd=path.join(temp,'work');await fs.mkdir(cwd);await fs.writeFile(path.join(cwd,'settings.txt'),'theme=light\n');
const requests=[];
const event=(res,type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
const server=createServer(async(req,res)=>{
 let text='';for await(const c of req)text+=c;const request=JSON.parse(text);requests.push(request);
 const last=request.messages.at(-1)?.content;
 const blocks=typeof last==='string'&&last.includes('修改演示文件')?[{type:'tool_use',id:'demo-write',name:'write_file',input:{path:'settings.txt',content:'theme=dark\n'}}]:[{type:'text',text:'演示修改已完成。用 /checkpoints 查看差异，再预览回退。'}];
 res.writeHead(200,{'content-type':'text/event-stream'});
 event(res,'message_start',{message:{id:'checkpoint-demo',type:'message',role:'assistant',model:'lesson-fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}});
 blocks.forEach((block,index)=>{const tool=block.type==='tool_use';event(res,'content_block_start',{index,content_block:tool?{...block,input:{}}:{type:'text',text:''}});event(res,'content_block_delta',{index,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});event(res,'content_block_stop',{index});});
 event(res,'message_delta',{delta:{stop_reason:blocks[0].type==='tool_use'?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:8}});event(res,'message_stop',{});res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,ZERO2AGENT_SKIP_LOCAL_ENV:'1',ZERO2AGENT_NO_SAVE:'0',ZERO2AGENT_NO_LOG:'0',ZERO2AGENT_NO_CHECKPOINTS:'0',ZERO2AGENT_CHECKPOINT_DIR:path.join(temp,'checkpoints'),ZERO2AGENT_SESSION_DIR:path.join(temp,'sessions'),ZERO2AGENT_LOG_DIR:path.join(temp,'logs'),ANTHROPIC_API_KEY:'local-demo-placeholder',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,MODEL_NAME:'lesson-fixture',CONTEXT_WINDOW:'30000',MAX_INPUT_TOKENS:'24000',MAX_OUTPUT_TOKENS:'2048',PERMISSION_MODE:'accept-edits'};
async function cli(args,{interactive=false,key=false,code=0}={}) {
 const childEnv={...env};if(!key)delete childEnv.ANTHROPIC_API_KEY;
 const child=spawn(process.execPath,[path.join(root,'packages/tui/dist/cli.js'),...args],{cwd,env:childEnv,stdio:interactive?'inherit':['ignore','pipe','pipe']});
 let output='';if(!interactive){child.stdout.on('data',data=>{output+=data;process.stdout.write(data)});child.stderr.on('data',data=>process.stderr.write(data));}
 assert.equal(await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}),code,'CLI exit');return output;
}
try {
 console.log(`临时工作目录：${cwd}（退出自动删除）`);
 console.log('本地确定性响应，不调用真实模型；SDK、权限、文件写入和 Checkpoint 都真实执行。');
 await cli(['修改演示文件，把 light 改成 dark。'],{key:true});assert.equal(await fs.readFile(path.join(cwd,'settings.txt'),'utf8'),'theme=dark\n');
 const store=await CheckpointStore.open(cwd,{directory:env.ZERO2AGENT_CHECKPOINT_DIR});const [record]=await store.list();assert(record);
 if(process.argv.includes('--tui')) {
  const sessions=await SessionStore.open(cwd,env.ZERO2AGENT_SESSION_DIR);const [session]=await sessions.list();
  console.log('进入 TUI：/checkpoints → Enter 查看差异 → r 预览回退 → y 执行；n/Enter/Esc 取消。exit 退出。');
  await cli(['--resume',session.id],{key:true,interactive:true});
 } else {
  const before=requests.length;
  await cli(['--checkpoints']);await cli(['--checkpoint',record.id]);
  const preview=await cli(['--undo',record.id]);const token=preview.match(/确认令牌: ([0-9a-f]{64})/)[1];
  assert.equal(await fs.readFile(path.join(cwd,'settings.txt'),'utf8'),'theme=dark\n');
  await cli(['--undo',record.id,'--confirm',token]);assert.equal(await fs.readFile(path.join(cwd,'settings.txt'),'utf8'),'theme=light\n');
  const [inverse]=await store.list();const redo=await store.preview(inverse.id);await cli(['--undo',inverse.id,'--confirm',redo.token]);
  assert.equal(await fs.readFile(path.join(cwd,'settings.txt'),'utf8'),'theme=dark\n');
  await cli(['--checkpoint-stats']);assert.equal(requests.length,before);
  const plan=await store.preview(record.id);await fs.writeFile(path.join(cwd,'settings.txt'),'theme=human\n');
  await cli(['--undo',record.id,'--confirm',plan.token],{code:1});assert.equal(await fs.readFile(path.join(cwd,'settings.txt'),'utf8'),'theme=human\n');
  console.log('PASS：真实文件修改、差异、无密钥回退、撤销回退、手工修改冲突、无工具重放。');
 }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
