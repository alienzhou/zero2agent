// Deterministic teaching exercise: no API key, network, tool replay or workspace writes.
import assert from 'node:assert/strict'
import { ContextManager } from '../../packages/core/dist/context-manager.js'
import { ContextBudget } from '../../packages/core/dist/context-budget.js'
import { HistoryEvidence } from '../../packages/core/dist/history-evidence.js'
import { fixture, score } from './evaluation/fixtures.mjs'

const messages = [
  { role: 'user', content: 'D1: use port 8123; project quartz-k42.' },
  { role: 'assistant', content: 'Inert notes. '.repeat(160) },
  { role: 'user', content: 'D2: correction: port 9237 replaces 8123. Deployment is forbidden.' },
  { role: 'assistant', content: 'More inert notes. '.repeat(800) },
  { role: 'user', content: 'Continue.' },
]
const original = JSON.stringify(messages)
const manager = new ContextManager()
const budget = new ContextBudget('offline-fixture', {
  contextWindow: 20000, maxOutputTokens: 512, summaryTokens: 128,
})
const summaryInputs = []
const runtime = {
  budget, client: {},
  request: messages => ({ model: 'offline-fixture', max_tokens: 512, messages }),
  summarize: async history => {
    summaryInputs.push(history)
    return 'Current port is 8123. Deployment status unknown.' // Intentionally wrong.
  },
}
try {
  assert.equal(await manager.compact(messages, runtime), true)
  assert.equal(JSON.stringify(messages), original)
  const first = manager.snapshot()
  assert.match(first.summary, /8123/)
  assert.match(JSON.stringify(manager.getContext(messages)), /9237/)
  messages.push({ role: 'assistant', content: 'Unrelated notes. '.repeat(800) }, { role: 'user', content: 'Continue again.' })
  assert.equal(await manager.compact(messages, runtime), true)
  assert.match(JSON.stringify(summaryInputs[1]), /9237/)
  const reader = new HistoryEvidence().access(() => messages, process.cwd())
  const found = JSON.parse(reader.read({ query: '9237' }))
  const recalled = JSON.parse(reader.read({ reference: found.records[0].reference }))
  assert.match(recalled.untrusted_text, /9237 replaces 8123/)
  const oracle = fixture('corrections')
  const wrongReport = {
    facts: Object.fromEntries(oracle.facts.map(f => [f.key, f.value])),
    sources: Object.fromEntries(oracle.facts.map(f => [f.key, f.source])),
  }
  wrongReport.facts.port = 8123
  assert.equal(score(oracle, wrongReport, []).criticalPassed, false)
  console.log(JSON.stringify({
    layer: 'deterministic stub, not a real model',
    adoptedCompactions: summaryInputs.length,
    acceptedWrongFreeText: first.summary,
    originalCorrectionReintroduced: true,
    recalled,
    wrongReportRejectedByOracle: true,
    lesson: 'A valid source index does not prove a summary is true. Check the source and the later task.',
  }, null, 2))
} finally { manager.cancel() }
