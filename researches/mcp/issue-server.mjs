/** Fixed local teaching server. No network, private data or credentials. stdout is protocol only. */
import readline from 'node:readline'
import fs from 'node:fs'
const mode = process.argv[2] ?? 'normal'
const audit = process.argv[3]
const label = process.argv[4] ?? 'issues'
const event = value => { if (audit) fs.appendFileSync(audit, JSON.stringify({pid:process.pid,...value})+'\n') }
event({event:'start', envKeys:Object.keys(process.env).sort()})
if (mode === 'hang-close' || mode === 'effect-hang') process.on('SIGTERM',()=>{})
const send = value => process.stdout.write(JSON.stringify(value)+'\n')
const reply = (id,result) => send({jsonrpc:'2.0',id,result})
const schema = {type:'object',properties:{},additionalProperties:false}
const issue = { id:'ISSUE-42', title:'金额使用浮点累加', file:'packages/api/amount.mjs', expected:'Use integer cents; 0.1 + 0.2 must equal 0.3.', label }
const definitions = [
  {name:'get_issue',description:'Read the fixed local ISSUE-42 amount bug, affected source and expected outcome.',inputSchema:schema, outputSchema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},file:{type:'string'},expected:{type:'string'},label:{type:'string'}},required:['id','title','file','expected','label'],additionalProperties:false}},
  {name:'get_logs',description:'Read fixed long logs, final verdict is at the end. Returns a stored-result reference when large.',inputSchema:schema},
  {name:'record_action',description:'Record an action in a local fixture counter. This changes local fixture state.',inputSchema:schema,annotations:{readOnlyHint:true,idempotentHint:true}},
]
const input = readline.createInterface({input:process.stdin})
input.on('line', line => {
  const message = JSON.parse(line)
  event({event:'request', method:message.method, ...(message.method === 'tools/call' && {tool:message.params.name})})
  if (message.method === 'initialize') {
    if (mode === 'hang-init') return
    reply(message.id,{protocolVersion:mode === 'bad-version'?'2024-11-05':'2025-11-25',capabilities:mode === 'bad-capability'?{}:{tools:{listChanged:true}},serverInfo:{name:'zero2agent-local-issues',version:'1.0.0'}})
  } else if (message.method === 'tools/list') {
    if (mode === 'hang-list') return
    let tools = message.params?.cursor ? definitions.slice(1) : definitions.slice(0,1)
    let nextCursor = message.params?.cursor ? undefined : 'page-2'
    if (mode === 'cycle') nextCursor = 'page-2'
    if (mode === 'too-many-pages') { tools=[]; nextCursor=String(Number(message.params?.cursor??0)+1) }
    if (mode === 'bad-schema') tools=[{...definitions[0],inputSchema:{...schema,unrecognizedKeyword:true}}]
    if (mode === 'bad-name') tools=[{...definitions[0],name:'bad name'}]
    if (mode === 'duplicate') tools=[definitions[0],definitions[0]]
    if (mode === 'too-many-tools') tools=Array.from({length:33},(_,i)=>({...definitions[0],name:'t'+i}))
    if (mode === 'tools-at-limit') {tools=Array.from({length:32},(_,i)=>({...definitions[0],name:'t'+i}));nextCursor=undefined}
    if (mode === 'oversize-frame') {process.stdout.write('x'.repeat(1024*1024+1)); return}
    if (mode === 'invalid-frame') {process.stdout.write('not-json\n'); return}
    reply(message.id,{tools,...(nextCursor !== undefined && {nextCursor})})
  } else if (message.method === 'tools/call') {
    const tool=message.params.name
    if (tool==='record_action') {
      event({event:'effect'})
      if(mode==='effect-disconnect') {process.exit(0)}
      if(mode==='effect-hang') return
    }
    if (mode === 'protocol-error') {send({jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'fixed invalid request'}});return}
    if (mode === 'unsupported') {reply(message.id,{content:[{type:'image',mimeType:'image/png',data:'AA=='}]});return}
    if (mode === 'tool-error') {reply(message.id,{content:[{type:'text',text:'fixed business failure'}],isError:true});return}
    if (tool === 'get_issue') reply(message.id,{content:[],structuredContent:mode==='invalid-output'?{bad:true}:issue})
    else if(tool==='get_logs') reply(message.id,{content:[{type:'text',text:'local fixture log\n'.repeat(2000)+'VERDICT: integer-cents required\n'}]})
    else reply(message.id,{content:[{type:'text',text:'Action recorded once.'}]})
    if(mode==='stale') send({jsonrpc:'2.0',method:'notifications/tools/list_changed'})
  }
})
input.on('close',()=>{ if (mode!=='hang-close' && mode!=='effect-hang') process.exit(0) })
