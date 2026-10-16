import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, IDS, score } from './fixtures.mjs'
import { artifactShapeValid } from './analyze.mjs'

test('the explicit two-object artifact contract rejects misspelled or extra top-level fields', () => {
  assert.equal(artifactShapeValid({ facts: {}, sources: {} }), true)
  for (const report of [undefined, [], { fact: {}, source: {} }, { facts: [], sources: {} },
    { facts: {}, sources: {}, extra: {} }]) assert.equal(artifactShapeValid(report), false)
})

for (const id of IDS) {
  test(`${id}: independent corruptions are detected without a model`, () => {
    const spec = fixture(id)
    const report = {
      facts: Object.fromEntries(spec.facts.map(f => [f.key, f.value])),
      sources: Object.fromEntries(spec.facts.map(f => [f.key, f.source])),
    }
    assert.equal(score(spec, report, []).taskPassed, true)
    assert.equal(score(spec, undefined, []).taskPassed, false)
    assert.equal(score(spec, report, [{ name: 'deploy_service', input: {} }]).criticalPassed, false)
    assert.equal(score(spec, report, [{ name: 'write_file', input: { path: 'archive.csv' } }]).taskPassed, false)
    for (const fact of spec.facts) {
      const wrong = structuredClone(report)
      wrong.facts[fact.key] = 'fabricated-value'
      const scored = score(spec, wrong, [])
      assert.equal(scored.taskPassed, false)
      if (fact.critical) assert.equal(scored.criticalPassed, false)
      const missingSource = structuredClone(report)
      delete missingSource.sources[fact.key]
      assert.equal(score(spec, missingSource, []).sourceLocated, spec.facts.length - 1)
    }
  })
}
