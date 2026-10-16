// Local HTTP/real SDK example; deterministic responses, no external model requests.
import { createServer } from 'node:http'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const { Agent, allTools, ResultStore } = await import(process.env.DEMO_CORE_MODULE ?? new URL('../../packages/core/dist/index.js', import.meta.url))
const cwd = await realpath(await mkdtemp(join(tmpdir(), 'z2a-read-recovery-demo-')))
const directory = join(cwd, 'results')
const store = new ResultStore({directory}); store.setWorkspace(cwd)
const entry = await store.save('Saved build 19; observed stage finished.', {toolName:'terminal',toolCallId:'old-build',paths:[cwd]})
const requests=[], stages=[]
const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c)
  requests.push(JSON.parse(Buffer.concat(chunks).toString()))
  const n=requests.length
  const block=n===1 ? {type:'tool_use',id:'bad-read',name:'read_tool_result',input:{reference:entry.reference,tail:true,offset:entry.bytes}}
    :n===3 ? {type:'tool_use',id:'correct-read',name:'read_tool_result',input:{reference:entry.reference,tail:true}}
    :n===4 ? {type:'tool_use',id:'write-report',name:'write_file',input:{path:'artifact.json',content:'{"build":19,"stage":"finished"}'}}
    :{type:'text',text:'Task complete.'}
  const tool=block.type==='tool_use'
  res.writeHead(200,{'content-type':'text/event-stream'})
  const event=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`)
  event('message_start',{message:{id:`fixture-${n}`,type:'message',role:'assistant',model:'local-fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}})
  event('content_block_start',{index:0,content_block:tool?{...block,input:{}}:{type:'text',text:''}})
  event('content_block_delta',{index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}})
  event('content_block_stop',{index:0})
  event('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}})
  event('message_stop',{});res.end()
})
try {
  await writeFile(join(cwd,'artifact.json'),'{"build":0,"stage":"unknown"}')
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const agent=new Agent({cwd,results:{directory},config:{apiKey:'local-placeholder',baseURL:`http://127.0.0.1:${server.address().port}`},tools:allTools.filter(t=>t.name==='write_file'),permissions:{mode:'accept-edits'},limits:{maxRequests:6,maxIterations:6,maxToolCalls:4,requestTimeoutMs:2000},diagnostics:e=>{if(['evidence-read','artifact-check'].includes(e.kind))stages.push(`${e.kind}:${e.event}`)}})
  agent.restore({messages:[],context:{through:0,summary:''},results:store.snapshot()})
  await agent.runWithContract('Read the saved build evidence, then update artifact.json.',{version:1,artifacts:[{path:'artifact.json',format:'json',schema:{kind:'object',allowAdditional:false,fields:{build:{kind:'value',type:'number'},stage:{kind:'value',choices:['finished','unknown']}}}}]})
  const artifact=JSON.parse(await readFile(join(cwd,'artifact.json'),'utf8'))
  console.log(JSON.stringify({scope:'Deterministic local HTTP/SDK; not real-model semantic acceptance',requests:requests.length,stages,artifact},null,2))
  assert.deepEqual(artifact,{build:19,stage:'finished'},'A structurally valid unknown report must not finish an unresolved read')
  assert.equal(requests.length,5)
  assert.deepEqual(stages,['evidence-read:invalid-input','evidence-read:correcting','evidence-read:resolved','artifact-check:started','artifact-check:passed'])
  assert.ok(JSON.stringify(requests[2]).includes('One correction stage'))
  assert.ok(!JSON.stringify(agent.snapshot()).includes('One correction stage'))
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  await rm(cwd,{recursive:true,force:true})
}
