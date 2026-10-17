// Deterministic process fixture: production Agent, SessionStore, CheckpointStore and Conversations.
import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { Agent, allTools } from '../../../packages/core/dist/index.js'
import { SessionStore } from '../../../packages/tui/dist/session-store.js'
import { CheckpointStore } from '../../../packages/tui/dist/checkpoint-store.js'
import { Conversations } from '../../../packages/tui/dist/conversations.js'

const [cwd, baseURL, stop, mode = 'crash'] = process.argv.slice(2)
const store = await SessionStore.open(cwd, path.join(cwd, 'sessions'))
const checkpoints = await CheckpointStore.open(cwd)
const write = allTools.find(t => t.name === 'write_file')
const agent = new Agent({
  results: { directory: path.join(cwd, 'results') },
  ...(process.env.SAFE_RESUME_REQUESTS ? { limits: { maxRequests: Number(process.env.SAFE_RESUME_REQUESTS) } } : {}),
  cwd, config: { apiKey: 'fixture', baseURL },
  permissions: { mode: mode === 'deny' ? 'default' : 'accept-edits' },
  fileMutations: checkpoints.capture,
  tools: [{ ...write, execute: async (input, ctx) => {
    const output = await write.execute(input, ctx)
    await fs.appendFile(path.join(cwd, 'effects.txt'), `${input.path}\n`)
    if (stop === 'effect') process.kill(process.pid, 'SIGKILL')
    return output
  } }],
})
if (mode !== 'crash') {
  const conversations = new Conversations(agent, store, undefined, undefined, checkpoints)
  const [item] = await store.list()
  console.log(await conversations.resume(item.id))
  if (mode === 'inspect') {
    // Saving and loading again must keep the gate and must not duplicate historical receipts.
    await conversations.save()
    console.log(await conversations.resume(item.id))
    try { await conversations.run('bypass recovery') } catch (error) { console.log(error.name) }
  } else {
    await conversations.continueInterrupted('I inspected the effects. Continue the unfinished task; do not repeat completed writes.')
  }
} else {
  const seed = await fs.readFile(path.join(cwd, 'result-seed.json'), 'utf8').catch(() => '')
  if (seed) agent.restore({ ...agent.snapshot(), results: JSON.parse(seed) })
  let current = await store.save(store.fresh(), agent.snapshot(), { kind: 'turn', pid: process.pid, host: hostname() })
  agent.setExecutionPersistence(async (snapshot, boundary) => {
    current = await store.save(current, snapshot, current.pending)
    if (boundary === stop) process.kill(process.pid, 'SIGKILL')
  })
  const contract = process.env.SAFE_RESUME_CONTRACT ? JSON.parse(process.env.SAFE_RESUME_CONTRACT) : undefined
  const prompt = 'Create first.txt and second.txt exactly once, then finish.'
  if (contract) await agent.runWithContract(prompt, contract, { sessionId: current.id })
  else await agent.run(prompt, { sessionId: current.id })
}
