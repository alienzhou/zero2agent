/** Local HTTP/SSE only; production CLI, SDK, permissions, tools, saves and logs are real. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { LogStore } from '../packages/tui/dist/run-log.js';
import { CheckpointStore } from '../packages/tui/dist/checkpoint-store.js';
import { RUN_LIMIT_FLAGS } from '../packages/tui/dist/run-options.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zero2agent-e04-s001-'));
const cwd = path.join(directory, 'workspace');
await fs.mkdir(cwd);
const requests = [], counts = new Map();
function reply(res, blocks, complete = true) {
  const emit = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
  const stop = blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  res.writeHead(200, {'content-type':'text/event-stream'});
  emit('message_start', {message:{id:'recovery-demo',type:'message',role:'assistant',model:'claude-sonnet-4-20250514',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
  blocks.forEach((b,index) => {
    const tool = b.type === 'tool_use';
    emit('content_block_start', {index,content_block:tool?{...b,input:{}}:{type:'text',text:''}});
    emit('content_block_delta', {index,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(b.input)}:{type:'text_delta',text:b.text}});
    emit('content_block_stop',{index});
  });
  emit('message_delta',{delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:10}});
  if(complete)emit('message_stop',{});
  res.end();
}
const server = createServer(async(req,res) => {
  let data = ''; for await(const chunk of req)data += chunk;
  const body = JSON.parse(data);
  const index = body.messages.findLastIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('演示'));
  const input = body.messages[index]?.content ?? '';
  const key = `${index}:${input}`;
  const n = (counts.get(key) ?? 0)+1; counts.set(key,n);
  requests.push({input,n,body});
  const failure = (status, wait = 1) => res.writeHead(status,{'content-type':'application/json','retry-after-ms':String(wait)}).end(JSON.stringify({type:'error',error:{type:status===401?'authentication_error':'api_error',message:'Local teaching fault'}}));
  if(input.includes('鉴权')) {failure(401);return;}
  if(input.includes('等待取消') && n===1) {failure(429,20000);return;}
  if(input.includes('请求重试') && n<3) {failure(n===1?429:500);return;}
  if(input.includes('先写入')) {
    if(n===1) {reply(res,[{type:'tool_use',id:'write-once',name:'write_file',input:{path:'effect.txt',content:'WRITTEN-ONCE'}}]);return;}
    if(n<4) {failure(500);return;}
  }
  if(input.includes('重复失败')) {reply(res,[{type:'tool_use',id:`missing-${n}`,name:'read_file',input:{path:'missing.txt'}}]);return;}
  if(input.includes('半截流') && n===1) {reply(res,[{type:'text',text:'这段是未完成草稿。'}],false);return;}
  reply(res,[{type:'text',text:'本地确定性响应已完成。请核对请求次数、真实文件和日志，不只看这句回答。'}]);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const env = {...process.env};
for(const flag of Object.keys(RUN_LIMIT_FLAGS)) delete env[`ZERO2AGENT_${flag.slice(2).replaceAll('-','_').toUpperCase()}`];
Object.assign(env,{ZERO2AGENT_SKIP_LOCAL_ENV:'1',ANTHROPIC_API_KEY:'local-demo-placeholder',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,MODEL_NAME:'claude-sonnet-4-20250514',CONTEXT_WINDOW:'30000',MAX_INPUT_TOKENS:'24000',MAX_OUTPUT_TOKENS:'2048',PERMISSION_MODE:'accept-edits',PERMISSION_RULES:'[]',ZERO2AGENT_RETRY_BASE_MS:'1',ZERO2AGENT_NO_SAVE:'0',ZERO2AGENT_NO_LOG:'0',ZERO2AGENT_NO_CHECKPOINTS:'0',ZERO2AGENT_SESSION_DIR:path.join(directory,'sessions'),ZERO2AGENT_LOG_DIR:path.join(directory,'logs'),ZERO2AGENT_CHECKPOINT_DIR:path.join(directory,'checkpoints')});
async function cli(args, expected = 0, interactive = false) {
  const child = spawn(process.execPath,[path.join(root,'packages/tui/dist/cli.js'),...args],{cwd,env,stdio:interactive?'inherit':['ignore','pipe','pipe']});
  if(!interactive) {child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);}
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
  assert.equal(code,expected,'CLI exit code');
}
try {
  console.log(`临时工作目录：${cwd}（退出自动删除）`);
  console.log('离线演示，不请求远端模型；生产 CLI、SDK、文件、权限、保存与日志真实运行。');
  let before = requests.length;
  await cli(['演示请求重试']); assert.equal(requests.length-before,3);
  before = requests.length;
  await cli(['演示先写入，再遇到服务失败']); assert.equal(requests.length-before,4);
  assert.equal(await fs.readFile(path.join(cwd,'effect.txt'),'utf8'),'WRITTEN-ONCE');
  const checkpoints = await CheckpointStore.open(cwd,{directory:env.ZERO2AGENT_CHECKPOINT_DIR});
  assert.equal((await checkpoints.list()).length,1);
  before = requests.length;
  await cli(['--max-repeated-failures','2','演示重复失败'],1);assert.equal(requests.length-before,2);
  before = requests.length;
  await cli(['演示半截流']);assert.equal(requests.length-before,2);
  before = requests.length;
  await cli(['演示鉴权失败'],1);assert.equal(requests.length-before,1);
  const logs = await LogStore.open(cwd,{root:env.ZERO2AGENT_LOG_DIR});
  for(const item of await logs.list()) {
    const report=await logs.read(item.id);assert.deepEqual(report.warnings,[]);
    assert(report.records.some(r=>r.kind==='request'&&r.attempt===1));
  }
  console.log('\nPASS：重试 3 次、写入仅 1 条 Checkpoint、相同失败 2 次停止、半截流 2 次、鉴权只请求 1 次。');
  if(process.argv.includes('--tui')) {
    console.log('进入真实 TUI：输入“演示等待取消”，看到 20000ms 后按 Ctrl-C；再输入“演示半截流”，用 /logs 查看尝试。exit 结束。');
    await cli([],0,true);
  }
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(directory,{recursive:true,force:true});
}
