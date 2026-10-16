// Deterministic teaching example: real Core/SDK, local HTTP fixture, no external model service.
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Agent, allTools } from '../../packages/core/dist/index.js'

let requests = 0
const server = createServer(async (req, res) => {
  for await (const _chunk of req) { /* drain the local fixture request */ }
  const write = ++requests === 2
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`)
  event('message_start', {message:{id:`fixture-${requests}`,type:'message',role:'assistant',model:'teaching-fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}})
  event('content_block_start', {index:0,content_block:write?{type:'tool_use',id:'artifact-write',name:'write_file',input:{}}:{type:'text',text:''}})
  event('content_block_delta', {index:0,delta:write?{type:'input_json_delta',partial_json:JSON.stringify({path:'artifact.json',content:'{"build":19,"stage":"finished"}'})}:{type:'text_delta',text:requests===1?'Claimed complete, but no file exists yet.':'Completed with a real artifact.'}})
  event('content_block_stop', {index:0})
  event('message_delta', {delta:{stop_reason:write?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}})
  event('message_stop', {})
  res.end()
})
const cwd = await mkdtemp(join(tmpdir(),'z2a-contract-demo-'))
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const events = []
  const agent = new Agent({
    cwd, config:{apiKey:'local-fixture-placeholder',baseURL:`http://127.0.0.1:${server.address().port}`},
    tools:allTools.filter(tool=>tool.name==='write_file'), permissions:{mode:'accept-edits'},
    limits:{maxIterations:4,maxRequests:4,maxToolCalls:4,requestTimeoutMs:2000},
    diagnostics:event=>{if(event.kind==='artifact-check') events.push(event.event)},
  })
  const contract = {
    version:1,
    artifacts:[{path:'artifact.json',format:'json',schema:{
      kind:'object',allowAdditional:false,
      fields:{build:{kind:'value',type:'number'},stage:{kind:'value',choices:['queued','finished','unknown']}},
    }}],
  }
  await agent.runWithContract('Write build 19 with observed stage finished to artifact.json.',contract)
  assert.deepEqual(JSON.parse(await readFile(join(cwd,'artifact.json'),'utf8')),{build:19,stage:'finished'})
  assert.deepEqual(events,['started','failed','repair','started','passed'])
  assert.equal(requests,3)
  assert.ok(!JSON.stringify(agent.snapshot()).includes('Harness artifact validation'))
  console.log(JSON.stringify({scope:'deterministic local HTTP fixture, not real-model acceptance',requests,events,actualFileVerified:true,feedbackPersisted:false},null,2))
} finally {
  server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve))
  await rm(cwd,{recursive:true,force:true})
}
