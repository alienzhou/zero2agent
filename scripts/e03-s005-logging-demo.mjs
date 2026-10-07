/** Local HTTP responses; production CLI, SDK, permissions, file tools and run journal. No real provider. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { LogStore } from '../packages/tui/dist/run-log.js';
import { SessionStore } from '../packages/tui/dist/session-store.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zero2agent-s005-demo-'));
const requests = [];
const event = (res,type,fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
const server = createServer(async(req,res)=>{
  let text=''; for await(const chunk of req) text+=chunk;
  const request=JSON.parse(text); requests.push(request);
  if(req.url.endsWith('count_tokens')) { res.writeHead(200,{'content-type':'application/json'}).end('{"input_tokens":30}'); return; }
  const last=request.messages.at(-1)?.content;
  if(typeof last==='string' && last.includes('演示请求失败')) {
    res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'Local teaching fixture: an intentional HTTP 401'}})); return;
  }
  const blocks=typeof last==='string' && last.includes('生成演示文件')
    ? [{type:'tool_use',id:'demo-write',name:'write_file',input:{path:'trace-demo.txt',content:'DEMO-ONLY'}}]
    : [{type:'text',text:'本地夹具已返回；请用 /logs 或 /log 查看真实宿主记录。'}];
  const stop=blocks[0].type==='tool_use'?'tool_use':'end_turn';
  if(!request.stream) {
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'demo-summary',type:'message',role:'assistant',model:'lesson-fixture',content:[{type:'text',text:'演示文件已生成，按记录继续。'}],stop_reason:'end_turn',usage:{input_tokens:30,output_tokens:8}})); return;
  }
  res.writeHead(200,{'content-type':'text/event-stream'});
  event(res,'message_start',{message:{id:'s005-demo',type:'message',role:'assistant',model:'lesson-fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}});
  blocks.forEach((block,index)=>{
    const tool=block.type==='tool_use';
    event(res,'content_block_start',{index,content_block:tool?{...block,input:{}}:{type:'text',text:''}});
    event(res,'content_block_delta',{index,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
    event(res,'content_block_stop',{index});
  });
  event(res,'message_delta',{delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:8}});
  event(res,'message_stop',{});res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,ZERO2AGENT_SKIP_LOCAL_ENV:'1',ZERO2AGENT_NO_SAVE:'0',ZERO2AGENT_NO_LOG:'0',ZERO2AGENT_SESSION_DIR:path.join(cwd,'sessions'),ZERO2AGENT_LOG_DIR:path.join(cwd,'logs'),ANTHROPIC_API_KEY:'local-demo-placeholder',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,MODEL_NAME:'lesson-fixture',CONTEXT_WINDOW:'30000',MAX_INPUT_TOKENS:'24000',MAX_OUTPUT_TOKENS:'2048',PERMISSION_MODE:'accept-edits'};
async function cli(args,{interactive=false,key=true,code=0}={}) {
  const childEnv={...env};if(!key)delete childEnv.ANTHROPIC_API_KEY;
  const child=spawn(process.execPath,[path.join(root,'packages/tui/dist/cli.js'),...args],{cwd,env:childEnv,stdio:interactive?'inherit':['ignore','pipe','pipe']});
  let output=''; if(!interactive) {
    child.stdout.on('data',data=>{output+=data;process.stdout.write(data)});
    child.stderr.on('data',data=>process.stderr.write(data));
  }
  const actual=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
  assert.equal(actual,code,'CLI exit status');return output;
}
try {
  console.log(`临时工作目录：${cwd}（退出自动删除）`);
  console.log('离线夹具；不调用真实模型。生产 CLI / SDK / 工具 / 日志都真实执行。');
  await cli(['生成演示文件，并记录工具结果。']);
  assert.equal(await fs.readFile(path.join(cwd,'trace-demo.txt'),'utf8'),'DEMO-ONLY');
  const logs=await LogStore.open(cwd,{root:env.ZERO2AGENT_LOG_DIR});const [normal]=await logs.list();
  const report=await logs.read(normal.id);assert.deepEqual(report.warnings,[]);
  const tool=report.records.find(r=>r.kind==='tool'&&r.event==='completed');assert(tool?.requestId);
  assert(report.records.some(r=>r.kind==='request'&&r.event==='completed'&&r.requestId===tool.requestId));
  const original=await fs.readFile(path.join(logs.directory,normal.id+'.jsonl'),'utf8');assert(!original.includes('DEMO-ONLY'));
  const before=requests.length;
  console.log('\n无 API key 的只读浏览：');await cli(['--logs'],{key:false});
  await cli(['--log',normal.id,'--log-operation',tool.operationId],{key:false});
  assert.equal(requests.length,before);assert.equal(await fs.readFile(path.join(logs.directory,normal.id+'.jsonl'),'utf8'),original);
  if(process.argv.includes('--tui')) {
    const sessions=await SessionStore.open(cwd,env.ZERO2AGENT_SESSION_DIR);const [session]=await sessions.list();
    console.log('\n进入 TUI：/logs 选择运行，/log 查看当前；PgUp/PgDn 查看记录，Esc 返回列表。exit 结束。');
    await cli(['--resume',session.id],{interactive:true});
  } else {
    console.log('\n模拟服务失败：实际本地 HTTP 401，错误正文不进入日志。');
    await cli(['演示请求失败'],{code:1});
    const failed=(await logs.list()).find(item=>item.id!==normal.id);assert(failed);
    const failure=await logs.read(failed.id);assert(failure.records.some(r=>r.kind==='request'&&r.errorKind==='auth'&&r.httpStatus===401));
    await cli(['--log',failed.id],{key:false});
    console.log('\nPASS：文件效果、请求/工具关联、无密钥只读与 HTTP 错误分类已核对。');
  }
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(cwd,{recursive:true,force:true});
}
