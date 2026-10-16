// Additional audit of an existing prompt requirement. Frozen runner, scores and analyses stay intact.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { fixture } from './fixtures.mjs'
import { analyze } from './analyze.mjs'

export function missingSourceKeys(report, requiredKeys) {
  const sources = report?.sources
  return requiredKeys.filter(key => !sources || typeof sources !== 'object' ||
    Array.isArray(sources) || !Object.hasOwn(sources, key))
}

export function hasRequiredSourceKeys(report, requiredKeys) {
  return missingSourceKeys(report, requiredKeys).length === 0
}

export async function auditSourceMaps(directory) {
  const before = await analyze(directory)
  assert.equal(before.complete, true, 'Audit requires the complete fixed denominator')
  const rows = []
  for (const previous of before.rows) {
    const raw = await fs.readFile(path.join(directory, previous.file))
    const evidence = JSON.parse(gunzipSync(raw))
    assert.equal(createHash('sha256').update(raw).digest('hex'), previous.sha256)
    const missing = missingSourceKeys(evidence.report, fixture(evidence.id).facts.map(f => f.key))
    rows.push({ file: previous.file, sha256: previous.sha256, id: previous.id, depth: previous.depth,
      oldTaskPassed: previous.taskPassed, oldCriticalPassed: previous.criticalPassed,
      missingRequiredSourceKeys: missing,
      taskPassed: previous.taskPassed && missing.length === 0,
      criticalPassed: previous.criticalPassed && missing.length === 0 })
  }
  const totals = selected => ({
    total: selected.length,
    oldTasks: selected.filter(r => r.oldTaskPassed).length,
    tasks: selected.filter(r => r.taskPassed).length,
    oldCritical: selected.filter(r => r.oldCriticalPassed).length,
    critical: selected.filter(r => r.criticalPassed).length,
  })
  return { directory, totals: totals(rows), groups: [0, 1, 3].map(depth => ({ depth, ...totals(rows.filter(r => r.depth === depth)) })), rows }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [output, ...directories] = process.argv.slice(2)
  assert.ok(output && directories.length)
  const results = []
  for (const directory of directories) results.push(await auditSourceMaps(directory))
  const audit = {
    scope: 'Require every requested fact key to appear as an own key in sources, as specified by the original final prompt. No source-value semantics or entailment certification. No model requests or replacement of frozen evidence, scores or analysis files.',
    auditedAt: new Date().toISOString(),
    checkerSha256: createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),
    fixtureSha256: createHash('sha256').update(await fs.readFile(new URL('./fixtures.mjs', import.meta.url))).digest('hex'),
    results,
  }
  await fs.writeFile(output, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(results.map(r => ({ directory: r.directory, ...r.totals }))))
}
