// Default: deterministic local HTTP/SSE, real child processes, no API key.
// --live: fixed two-file task using the currently configured service; no failed-task reruns.
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {Agent, allTools, getModelName} from '../../packages/core/dist/index.js';
import {SessionStore} from '../../packages/tui/dist/session-store.js';
import {CheckpointStore} from '../../packages/tui/dist/checkpoint-store.js';
import {Conversations} from '../../packages/tui/dist/conversations.js';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ownFile = fileURLToPath(import.meta.url);
const contract = {version:1,artifacts:['first','second'].map(stage=>({path:`${stage}.json`,format:'json',schema:{kind:'object',allowAdditional:false,fields:{stage:{kind:'value',choices:[stage]}}}}))};
const task='In this empty workspace, create first.json with {"stage":"first"}, then second.json with {"stage":"second"}. Use write_file. Complete each file once. Do not execute commands.';
const continuation='I inspected first.json and it is already correct. Continue the interrupted task in a new turn: keep first.json unchanged, create second.json with {"stage":"second"} if missing, then check completion. Do not repeat the first write.';

if (process.argv[2] === '--child') {
  const [dir, baseURL, mode, live] = process.argv.slice(3);
  const cwd=path.join(dir,'workspace');
  const store=await SessionStore.open(cwd,path.join(dir,'sessions'));
  const checkpoints=await CheckpointStore.open(cwd,{directory:path.join(dir,'checkpoints')});
  const write=allTools.find(t=>t.name==='write_file');
  const agent=new Agent({cwd,config:live==='yes'?{}:{apiKey:'offline-fixture',baseURL},
    results:{directory:path.join(dir,'results')},fileMutations:checkpoints.capture,
    permissions:{mode:'accept-edits'},limits:{maxIterations:8,maxRequests:12,maxToolCalls:8,maxDurationMs:180000},
    context:{maxInputTokens:24000,maxOutputTokens:2048,contextWindow:30000,counting:'conservative'},
    diagnostics:event=>appendFileSync(path.join(dir,`${mode}-diagnostics.jsonl`),JSON.stringify(event)+'\n',{mode:0o600}),
    tools:[{...write,execute:async(input,ctx)=>{
      const result=await write.execute(input,ctx);
      await fs.appendFile(path.join(dir,'effects.jsonl'),JSON.stringify({path:input.path})+'\n',{mode:0o600});
      return result;
    }}],
  });
  if(mode==='first') {
    let current=await store.save(store.fresh(),agent.snapshot(),{kind:'turn',pid:process.pid,host:hostname()});
    agent.setExecutionPersistence(async(snapshot,boundary)=>{
      current=await store.save(current,snapshot,current.pending);
      if(boundary==='tool-settled' && snapshot.recovery.tools.at(-1)?.state !== 'unknown' &&
        await fs.stat(path.join(cwd,'first.json')).then(()=>true,()=>false)) process.kill(process.pid,'SIGKILL');
    });
    await agent.runWithContract(task,contract,{sessionId:current.id});
    throw new Error('Expected crash point was not reached.');
  } else {
    const conversations=new Conversations(agent,store,undefined,undefined,checkpoints);
    const [item]=await store.list();
    console.log(await conversations.resume(item.id));
    const before=await fs.readFile(path.join(cwd,'first.json'),'utf8');
    await conversations.continueInterrupted(continuation);
    if(await fs.readFile(path.join(cwd,'first.json'),'utf8')!==before) throw new Error('First file changed during continuation.');
  }
} else {
  const live=process.argv.includes('--live');
  if(live) {
    try {process.loadEnvFile(path.join(root,'.env.local'));} catch {}
    if(!process.env.ANTHROPIC_API_KEY) throw new Error('Live mode requires the configured API key.');
  }
  const outputRoot=path.join(root,'tmp','e04-s004');
  await fs.mkdir(outputRoot,{recursive:true});
  const dir=await fs.mkdtemp(path.join(outputRoot,live?'live-':'offline-'));
  const cwd=path.join(dir,'workspace');
  await fs.mkdir(cwd,{mode:0o700});
  let requests=0;
  const server=live?undefined:createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    await fs.appendFile(path.join(dir,'requests.jsonl'),raw+'\n',{mode:0o600});
    const count=++requests;
    const blocks=count===1?['first','second'].map(stage=>({type:'tool_use',id:stage,name:'write_file',input:{path:`${stage}.json`,content:JSON.stringify({stage})}})):
      count===2?[{type:'tool_use',id:'remaining',name:'write_file',input:{path:'second.json',content:'{"stage":"second"}'}}]:[{type:'text',text:'Both files completed; first write was not repeated.'}];
    res.writeHead(200,{'content-type':'text/event-stream'});
    const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
    event('message_start',{message:{id:'offline',type:'message',role:'assistant',content:[],model:'deterministic-fixture',stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
    blocks.forEach((b,index)=>{event('content_block_start',{index,content_block:b.type==='tool_use'?{...b,input:{}}:{type:'text',text:''}});event('content_block_delta',{index,delta:b.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(b.input)}:{type:'text_delta',text:b.text}});event('content_block_stop',{index});});
    event('message_delta',{delta:{stop_reason:count<3?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}});event('message_stop',{});res.end();
  });
  if(server) await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseURL=server?`http://127.0.0.1:${server.address().port}`:'';
  const launch=mode=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[ownFile,'--child',dir,baseURL,mode,live?'yes':'no'],{env:process.env});
    const timer=setTimeout(()=>child.kill('SIGKILL'),200000);
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});
  });
  const report={mode:live?'real-service':'deterministic-http',startedAt:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),requestedModel:live?getModelName({}):'fixture',passed:false};
  report.sourceHashes=Object.fromEntries(await Promise.all(['packages/core/src/loop.ts','packages/core/src/execution-recovery.ts','packages/core/src/agent.ts','packages/core/src/session.ts','packages/tui/src/session-store.ts','packages/tui/src/conversations.ts'].map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  report.runtimeHashes=Object.fromEntries(await Promise.all(['packages/core/dist/loop.js','packages/core/dist/execution-recovery.js','packages/core/dist/agent.js','packages/core/dist/session.js','packages/tui/dist/session-store.js','packages/tui/dist/conversations.js'].map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  try {
    const first=await launch('first');
    await fs.writeFile(path.join(dir,'first.log'),first.output);
    report.firstExit={code:first.code,signal:first.signal};
    if(first.signal!=='SIGKILL')throw new Error('Initial process did not reach the expected crash point.');
    const store=await SessionStore.open(cwd,path.join(dir,'sessions'));
    const [item]=await store.list();
    const pending=await store.load(item.id);
    report.crashStates=pending.state.recovery.tools.map(t=>({tool:t.toolName,state:t.state}));
    const resumed=await launch('continued');
    await fs.writeFile(path.join(dir,'continued.log'),resumed.output);
    report.continueExit={code:resumed.code,signal:resumed.signal};
    if(resumed.code!==0)throw new Error('Continuation failed; retained evidence must be inspected.');
    for(const stage of ['first','second']) if(JSON.parse(await fs.readFile(path.join(cwd,`${stage}.json`),'utf8')).stage!==stage)throw new Error('Wrong artifact value.');
    const effects=(await fs.readFile(path.join(dir,'effects.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    if(effects.length!==2||effects.filter(e=>e.path==='first.json').length!==1||effects.filter(e=>e.path==='second.json').length!==1)throw new Error('Unexpected or repeated write.');
    const saved=await store.load(item.id);
    if(saved.pending||saved.state.recovery)throw new Error('Continuation did not settle.');
    const events=(await Promise.all(['first','continued'].map(async mode=>(await fs.readFile(path.join(dir,`${mode}-diagnostics.jsonl`),'utf8')).trim().split('\n').map(JSON.parse)))).flat();
    report.reportedModels=[...new Set(events.map(e=>e.responseModel).filter(Boolean))];
    report.modelRequests=events.filter(e=>e.kind==='request'&&e.event==='start'&&e.purpose==='model').length;
    report.effects=effects;report.passed=true;
  } catch(error) {report.failure=error.message;process.exitCode=1;}
  finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({...report,evidenceDirectory:dir},null,2));
}
