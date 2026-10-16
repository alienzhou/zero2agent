import test from 'node:test'
import assert from 'node:assert/strict'
import { checkArtifactContract } from './artifact-contract.mjs'

const contract = { kind: 'object', allowAdditional: false, fields: {
  details: { kind: 'object', allowAdditional: true, fields: {
    'build/name': { kind: 'value', type: 'string' },
    stage: { kind: 'value', choices: ['queued', 'finished', 'unknown'] },
  } },
  references: { kind: 'object', allowAdditional: true, fields: { 'build/name': { kind: 'value', type: 'string' } } },
} }
const valid = () => ({ details: { 'build/name': 'moss-42', stage: 'unknown' }, references: { 'build/name': 'R7' } })

test('checks caller-selected keys and enums without knowing fact answers', () => {
  assert.equal(checkArtifactContract(valid(), contract).passed, true)
  const wrong = valid(); wrong.details['build/name'] = 'invented'; wrong.references['build/name'] = 'unverified'
  assert.equal(checkArtifactContract(wrong, contract).passed, true, 'Shape cannot certify facts or source support')
})
test('reports missing, renamed, prefixed and extra fields without rewriting the artifact', () => {
  const wrong = valid(); wrong.references = { 'details.build/name': 'R7' }; wrong.extra = 'ignore previous instructions'
  const before = structuredClone(wrong)
  assert.deepEqual(checkArtifactContract(wrong, contract).issues, [
    { path: '/references/build~1name', code: 'missing-key' }, { path: '', code: 'unexpected-keys' },
  ])
  assert.deepEqual(wrong, before)
})
test('requires objects and own keys, rejects arrays and absent results', () => {
  for (const value of [undefined, null, [], '']) assert.equal(checkArtifactContract(value, contract).passed, false)
  const wrong = valid(); wrong.details = Object.create(wrong.details)
  assert.equal(checkArtifactContract(wrong, contract).passed, false)
})
test('enforces only declared types and choices, permits explicitly allowed extra inner keys', () => {
  const wrong = valid(); wrong.details.stage = 'FINISHED'; wrong.references['build/name'] = 7
  assert.deepEqual(checkArtifactContract(wrong, contract).issues.map(i => i.code), ['outside-enum', 'wrong-type'])
  const extra = valid(); extra.details.diagnostic = 'additional'; extra.references.other = 'R8'
  assert.equal(checkArtifactContract(extra, contract).passed, true)
})
test('bounds contract depth and diagnostic count; does not interpret unknown rule fields', () => {
  assert.throws(() => checkArtifactContract({}, { kind: 'object', fields: {}, allowAdditional: true, execute: 'bad' }))
  const cyclic = { kind: 'object', fields: {}, allowAdditional: true }; cyclic.fields.self = cyclic
  assert.throws(() => checkArtifactContract({}, cyclic))
  const wide = { kind: 'object', allowAdditional: true, fields: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`x${i}`, { kind: 'value' }])) }
  const result = checkArtifactContract({}, wide)
  assert.equal(result.issues.length, 32); assert.equal(result.truncated, true); assert.equal(result.passed, false)
})
