// Independent paired assessment. Never rewrites raw evidence or the original 504 records.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { analyze, artifactShapeValid } from './analyze.mjs'
import { fixture, IDS, score } from './fixtures.mjs'
import { hasRequiredSourceKeys } from './source-map-audit.mjs'
import { checkArtifactContract } from './artifact-contract-described.mjs'
const hash = data => createHash('sha256').update(data).digest('hex')
const inputs = JSON.parse(await fs.readFile(new URL('contract-pair-v2/inputs.json', import.meta.url)))

export function assessContractRecord(evidence, contract) {
  const spec = fixture(evidence.id)
  const result = score(spec, evidence.report, evidence.calls)
  const contractValid = checkArtifactContract(evidence.report, contract.artifacts[0].schema).passed
  const sourcesValid = hasRequiredSourceKeys(evidence.report, spec.facts.map(f => f.key))
  const adopted = evidence.events.filter(e => e.phase === 'completed').length
  const valid = contractValid && sourcesValid && artifactShapeValid(evidence.report) && !evidence.error && adopted === evidence.depth
  return { taskPassed: valid && result.taskPassed, criticalPassed: valid && result.criticalPassed, contractValid, sourcesValid, adopted, facts: result.facts, forbidden: result.forbidden }
}

export async function analyzeContractDirectory(directory) {
  const original = await analyze(directory)
  assert.equal(original.complete, true, 'Require the complete fixed denominator')
  const expected = []
  for (const depth of [0, 1, 3]) for (const id of IDS) for (let repeat = 0; repeat < (depth ? 3 : 1); repeat++) expected.push({id, depth, repeat, file: `${id}-${depth}-${repeat}.json.gz`})
  assert.deepEqual(original.manifest.cases, expected)
  for (const [name, expectedHash] of Object.entries(original.manifest.evaluationHashes))
    assert.equal(hash(await fs.readFile(new URL(name, import.meta.url))), expectedHash, `Frozen evaluation identity: ${name}`)
  const rows = []
  for (const previous of original.rows) {
    const raw = await fs.readFile(path.join(directory, previous.file))
    const evidence = JSON.parse(gunzipSync(raw))
    const input = inputs.find(i => i.id === evidence.id)
    const declared = expected.find(c => c.file === previous.file)
    for (const key of ['id', 'depth', 'repeat']) assert.equal(evidence[key], declared[key])
    assert.equal(evidence.inputSha256, hash(JSON.stringify(input)))
    assert.equal(evidence.mode, original.manifest.mode)
    assert.equal(evidence.runtimeCommit, original.manifest.runtimeCommit)
    let parsed
    if (evidence.reportText !== undefined) { try { parsed = JSON.parse(evidence.reportText) } catch {} }
    assert.deepEqual(evidence.report, parsed, 'Saved report must match actual bytes')
    if (evidence.finalSnapshot.messages.some(m => m.role === 'user' && m.content === input.task) === false && !evidence.error)
      assert.fail('Original task missing from actual history')
    const assessed = assessContractRecord(evidence, input.contract)
    const checks = evidence.diagnostics.filter(e => e.kind === 'artifact-check')
    if (evidence.mode === 'baseline') assert.equal(checks.length, 0)
    if (evidence.mode === 'candidate' && !evidence.error) assert.equal(checks.at(-1)?.event, 'passed')
    rows.push({ ...previous, ...assessed, responseModels: [...new Set(evidence.diagnostics.filter(d => d.kind === 'request' && d.event === 'completed' && d.responseModel).map(d => d.responseModel))], completionChecks: checks.filter(e => e.event === 'started').length, repairs: checks.filter(e => e.event === 'repair').length, completionOutcome: checks.at(-1)?.event, error: evidence.error })
  }
  const totals = list => {
    const ordinary = list.flatMap(r => r.facts).filter(f => !f.critical)
    return { total: list.length, tasks: list.filter(r => r.taskPassed).length, critical: list.filter(r => r.criticalPassed).length, ordinaryCorrect: ordinary.filter(f => f.correct).length, ordinaryTotal: ordinary.length, contractValid: list.filter(r => r.contractValid).length, repairs: list.reduce((n,r) => n+r.repairs,0), completionChecks: list.reduce((n,r) => n+r.completionChecks,0) }
  }
  return { ...original, analyzedAt: new Date().toISOString(), scorerHashes: Object.fromEntries(await Promise.all(['analyze-contract-pair-v2.mjs','analyze.mjs','source-map-audit.mjs','artifact-contract-described.mjs','artifact-contract.mjs'].map(async name=>[name,hash(await fs.readFile(new URL(name,import.meta.url)))]))), rows, totals: totals(rows), pairedGroups: [0,1,3].map(depth=>({depth,...totals(rows.filter(r=>r.depth===depth))})), limitations: [...original.limitations, 'Explicit structural contracts are a new caller input; these results never replace v8 or the original 504 records.', 'Completion checks do not certify factual/source entailment; both sides retain the same independent oracle.', 'Known usage fields are retained for every attempt; missing usage remains unknown.'] }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [directory, baselineDirectory] = process.argv.slice(2)
  const result = await analyzeContractDirectory(directory)
  if (baselineDirectory) {
    const baseline = await analyzeContractDirectory(baselineDirectory)
    assert.equal(result.manifest.mode, 'candidate')
    assert.equal(baseline.manifest.mode, 'baseline')
    assert.deepEqual(result.manifest.evaluationHashes, baseline.manifest.evaluationHashes)
    result.acceptance = { criticalAll: result.totals.critical === 56, ordinaryAtLeast95: result.totals.ordinaryCorrect / result.totals.ordinaryTotal >= 0.95, noTaskRegression: result.totals.tasks >= Math.max(41,baseline.totals.tasks), baselineTasks: baseline.totals.tasks }
    result.acceptance.passed = result.acceptance.criticalAll && result.acceptance.ordinaryAtLeast95 && result.acceptance.noTaskRegression
  }
  await fs.writeFile(path.join(directory,'paired-analysis.json'), JSON.stringify(result,null,2)+'\n', {flag:'wx'})
  console.log(JSON.stringify({mode:result.manifest.mode,...result.totals,groups:result.pairedGroups,acceptance:result.acceptance}))
}
