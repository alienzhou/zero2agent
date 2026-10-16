// Offline regressions from preserved service evidence. No model requests or record rewrites.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { ResultStore, readToolResultTool } from '../../../../packages/core/dist/index.js'
import { fixture } from '../fixtures.mjs'
import { assessContractRecord } from '../analyze-contract-pair-v2.mjs'

const evidence = JSON.parse(gunzipSync(await fs.readFile(new URL('./candidate/result-recall-0-0.json.gz', import.meta.url))))
const contracts = JSON.parse(await fs.readFile(new URL('./contracts.json', import.meta.url)))
const spec = fixture('result-recall')

test('a repaired file and passed structure check do not hide critical factual failure', () => {
  const checks = evidence.diagnostics.filter(d => d.kind === 'artifact-check')
  assert.deepEqual(checks.map(d => d.event), ['started', 'failed', 'repair', 'started', 'passed'])
  const assessed = assessContractRecord(evidence, contracts['result-recall'])
  assert.equal(assessed.contractValid, true)
  assert.equal(assessed.taskPassed, false)
  assert.equal(assessed.criticalPassed, false)
  assert.equal(assessed.facts.filter(f => !f.correct).length, 3)
})

test('the actual invalid recall combines mutually exclusive modes, without reaching storage', async () => {
  const recall = evidence.calls.filter(c => c.name === 'read_tool_result')
  assert.equal(recall.length, 1)
  assert.equal(recall[0].input.tail, true)
  assert.equal(typeof recall[0].input.offset, 'number')
  let reads = 0
  await assert.rejects(readToolResultTool.execute(recall[0].input, {
    results: { read: async () => { reads++; throw new Error('unexpected read') } },
  }), /INVALID_RESULT_RANGE/)
  assert.equal(reads, 0)
})

test('reconstructed identical synthetic bytes contain the requested tail; this is not a service rerun', async () => {
  const raw = evidence.finalSnapshot.messages.flatMap(m => Array.isArray(m.content) ? m.content : [])
    .find(b => b.type === 'tool_result' && b.tool_use_id === 'build-output')
  const receipt = JSON.parse(raw.content)
  assert.equal(createHash('sha256').update(spec.resultBody).digest('hex'), receipt.sha256)
  assert.equal(Buffer.byteLength(spec.resultBody), receipt.bytes)
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-recall-regression-')))
  try {
    const store = new ResultStore({ directory: path.join(directory, 'results') })
    store.setWorkspace(directory)
    const saved = await store.save(spec.resultBody, { toolName: 'terminal', toolCallId: 'build-output', paths: [directory] })
    const tail = JSON.parse(await readToolResultTool.execute({ reference: saved.reference, tail: true, limit: 4096 }, { results: store }))
    assert.equal(tail.eof, true)
    for (const fact of spec.facts) assert.ok(tail.untrusted_text.includes(fact.value))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
