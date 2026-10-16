import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, score } from './fixtures.mjs'
import { artifactShapeValid } from './analyze.mjs'
import { hasRequiredSourceKeys, missingSourceKeys } from './source-map-audit.mjs'

test('detects the frozen scorer and top-level audit gap without changing either legacy result', () => {
  const spec = fixture('corrections')
  const report = { facts: Object.fromEntries(spec.facts.map(f => [f.key, f.value])),
    sources: Object.fromEntries(spec.facts.map(f => ['facts.' + f.key, f.source])) }
  assert.equal(score(spec, report, []).taskPassed, true)
  assert.equal(artifactShapeValid(report), true)
  assert.equal(hasRequiredSourceKeys(report, spec.facts.map(f => f.key)), false)
  assert.deepEqual(missingSourceKeys(report, ['project', 'port']), ['project', 'port'])
})

test('rejects missing, nested, renamed, array and inherited mappings', () => {
  for (const sources of [undefined, null, [], { deploy: 'D1' }, { facts: { deployment: 'D1' } }, Object.create({ deployment: 'D1' })])
    assert.equal(hasRequiredSourceKeys({ sources }, ['deployment']), false)
})

test('does not confuse key presence with source validity or semantic support', () => {
  assert.equal(hasRequiredSourceKeys({ sources: { port: 'h0:unverified-reference' } }, ['port']), true)
  assert.equal(hasRequiredSourceKeys({ sources: { port: 'invented-label', extra: 'D2' } }, ['port']), true)
})
