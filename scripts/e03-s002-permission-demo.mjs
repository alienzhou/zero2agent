// Offline follow-along: real write effects through the production execution gate.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionController, allTools } from '../packages/core/dist/index.js'
import { executeToolCalls } from '../packages/core/dist/loop.js'

const cwd = await mkdtemp(join(tmpdir(), 'z2a-permission-demo-'))
const write = allTools.find(tool => tool.name === 'write_file')
try {
  for (const decision of ['deny', 'allow']) {
    const permissions = new PermissionController({ requestApproval: async request => ({requestId:request.id, decision}) })
    const results = await executeToolCalls([{type:'tool_use', id:decision, name:write.name, input:{path:`${decision}.txt`,content:'approved once'}}], [write], {cwd}, undefined, permissions)
    const file = await readFile(join(cwd, `${decision}.txt`), 'utf8').catch(() => null)
    if ((file !== null) !== (decision === 'allow')) throw new Error('Unexpected file effect')
    console.log(JSON.stringify({decision,result:results[0],fileExists:file!==null}))
  }
} finally { await rm(cwd, {recursive:true,force:true}) }
