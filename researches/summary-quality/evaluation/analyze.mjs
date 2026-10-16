// Read immutable synthetic evidence; do not rewrite outcomes or rerun failed tasks.
import fs from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { fixture, score } from './fixtures.mjs'

const ratio = (n, d) => ({ count: n, total: d, rate: d ? n / d : null })
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}
const bytes = value => Buffer.byteLength(JSON.stringify(value))

export function artifactShapeValid(report) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  return object(report) && Object.keys(report).sort().join(',') === 'facts,sources' &&
    object(report.facts) && object(report.sources)
}

export async function analyze(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  const rows = [], missing = []
  for (const item of manifest.cases) {
    let raw
    try { raw = await fs.readFile(path.join(directory, item.file)) }
    catch (error) { if (error.code === 'ENOENT') { missing.push(item.file); continue } throw error }
    const evidence = JSON.parse(gunzipSync(raw))
    const scored = score(fixture(evidence.id), evidence.report, evidence.calls)
    const validShape = artifactShapeValid(evidence.report)
    // Frozen report scores must agree with independent recomputation.
    if (JSON.stringify(scored) !== JSON.stringify(evidence.score)) throw new Error(`Score mismatch: ${item.file}`)
    const requests = evidence.diagnostics.filter(e => e.kind === 'request')
    const starts = requests.filter(e => e.event === 'start')
    const completed = requests.filter(e => e.event === 'completed')
    const errors = requests.filter(e => e.event === 'error')
    const adopted = evidence.events.filter(e => e.phase === 'completed').length
    const causes = []
    if (errors.length) causes.push(...new Set(errors.map(e => `transport:${e.errorKind ?? 'unknown'}`)))
    if (completed.some(e => e.purpose === 'summary' && e.stopReason === 'max_tokens')) causes.push('summary-output-truncated')
    if (evidence.error && !causes.length) causes.push(evidence.error)
    if (evidence.report === undefined && !evidence.error) causes.push('report-missing-or-unparseable')
    if (evidence.report && !validShape) causes.push('invalid-report-schema')
    if (evidence.report?.facts && scored.facts.some(f => !f.correct)) causes.push('incorrect-facts')
    if (scored.forbidden.length) causes.push('forbidden-tool-attempt')
    if (adopted !== evidence.depth) causes.push('adoption-count-mismatch')
    const last = evidence.snapshots?.at(-1)
    rows.push({
      id: evidence.id, depth: evidence.depth, repeat: evidence.repeat, file: item.file,
      sha256: createHash('sha256').update(raw).digest('hex'),
      frozenScoreTaskPassed: scored.taskPassed, artifactShapeValid: validShape,
      taskPassed: scored.taskPassed && validShape && !evidence.error && adopted === evidence.depth,
      criticalPassed: scored.criticalPassed && validShape && !evidence.error && adopted === evidence.depth,
      reportParsed: evidence.report !== undefined, causes, adopted,
      facts: scored.facts, forbidden: scored.forbidden,
      elapsedMs: evidence.elapsedMs,
      requests: Object.fromEntries(['model', 'summary', 'count'].map(purpose => {
        const begin = starts.filter(e => e.purpose === purpose)
        const end = completed.filter(e => e.purpose === purpose)
        return [purpose, {
          attempts: begin.length,
          inputTokensKnown: end.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0),
          outputTokensKnown: end.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0),
          cacheReadTokensKnown: end.reduce((sum, e) => sum + (e.cacheReadTokens ?? 0), 0),
          cacheWriteTokensKnown: end.reduce((sum, e) => sum + (e.cacheWriteTokens ?? 0), 0),
          missingInputUsage: begin.length - end.filter(e => Number.isFinite(e.inputTokens)).length,
          missingOutputUsage: begin.length - end.filter(e => Number.isFinite(e.outputTokens)).length,
          durationMsKnown: requests.filter(e => e.purpose === purpose && Number.isFinite(e.durationMs)).reduce((sum, e) => sum + e.durationMs, 0),
        }]
      })),
      recallCalls: evidence.calls.filter(c => ['read_history', 'read_tool_result'].includes(c.name)).length,
      contextBytes: evidence.workingContext ? bytes(evidence.workingContext) : null,
      rawHistoryBytes: last ? bytes(last.messages) : null,
      summaryBytes: last ? bytes(last.context.summary) - 2 : null,
    })
  }
  const groups = [0, 1, 3].map(depth => {
    const tasks = rows.filter(r => r.depth === depth)
    const facts = tasks.flatMap(t => t.facts)
    const ordinary = facts.filter(f => !f.critical)
    const asserted = facts.filter(f => f.actual !== undefined)
    return {
      depth, tasks: ratio(tasks.filter(t => t.taskPassed).length, tasks.length),
      criticalTasks: ratio(tasks.filter(t => t.criticalPassed).length, tasks.length),
      criticalFacts: ratio(facts.filter(f => f.critical && f.correct).length, facts.filter(f => f.critical).length),
      ordinaryFacts: ratio(ordinary.filter(f => f.correct).length, ordinary.length),
      sourceLabels: ratio(facts.filter(f => f.located).length, facts.length),
      conflictingAssertions: ratio(asserted.filter(f => !f.correct).length, asserted.length),
      unlocatedAssertions: ratio(asserted.filter(f => !f.located).length, asserted.length),
      forbiddenTasks: tasks.filter(t => t.forbidden.length).length,
      medianElapsedMs: median(tasks.map(t => t.elapsedMs)),
      medianWorkingToRawByteRatio: median(tasks.filter(t => t.contextBytes !== null && t.rawHistoryBytes).map(t => t.contextBytes / t.rawHistoryBytes)),
      recallCalls: tasks.reduce((sum, t) => sum + t.recallCalls, 0),
      requestTotals: Object.fromEntries(['model', 'summary', 'count'].map(p => [p,
        tasks.reduce((total, t) => {
          for (const [key, value] of Object.entries(t.requests[p])) total[key] = (total[key] ?? 0) + value
          return total
        }, {}),
      ])),
    }
  })
  return { directory, manifest, complete: missing.length === 0, missing, groups, rows,
    limitations: [
      'Source labels are literal-label matching, not semantic entailment or proof of an actual recall.',
      'Conflict/unsupported ratios cover facts asserted in the report, not all prose in the answer or summary.',
      'Missing report/error tasks count as failures; unknown usage is not zero cost.',
      'Known token totals are vendor-reported fields, not billable costs; byte ratios are not token compression ratios.',
      'Requested model name identifies the compatible API request, not an independently verified upstream model.',
    ] }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const dir of process.argv.slice(2)) {
    const result = await analyze(dir)
    await fs.writeFile(path.join(dir, 'analysis.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify({ directory: dir, complete: result.complete, groups: result.groups }))
  }
}
