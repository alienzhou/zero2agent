// Research-only checker for caller-supplied contracts. No prompt inference, I/O or fixes.
// This intentionally small grammar is not a general JSON Schema implementation.
import assert from 'node:assert/strict'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1')
const primitive = value => value === null || ['string', 'boolean'].includes(typeof value) ||
  typeof value === 'number' && Number.isFinite(value)

export function checkArtifactContract(value, contract) {
  let nodes = 0
  const active = new Set()
  const validateContract = (rule, depth) => {
    assert.ok(object(rule) && !active.has(rule) && depth <= 12 && ++nodes <= 512, 'Invalid or unbounded contract')
    active.add(rule)
    if (rule.kind === 'object') {
      assert.ok(Object.keys(rule).every(k => ['kind', 'fields', 'allowAdditional'].includes(k)))
      assert.ok(object(rule.fields) && typeof rule.allowAdditional === 'boolean')
      for (const [key, child] of Object.entries(rule.fields)) {
        assert.ok(Buffer.byteLength(key) <= 256)
        validateContract(child, depth + 1)
      }
    } else {
      assert.equal(rule.kind, 'value')
      assert.ok(Object.keys(rule).every(k => ['kind', 'type', 'choices'].includes(k)))
      assert.ok(rule.type === undefined || ['string', 'number', 'boolean'].includes(rule.type))
      if (rule.choices !== undefined)
        assert.ok(Array.isArray(rule.choices) && rule.choices.length > 0 && rule.choices.length <= 32 && rule.choices.every(primitive))
    }
    active.delete(rule)
  }
  validateContract(contract, 0)
  const issues = []
  let truncated = false
  const issue = (path, code) => {
    if (issues.length === 32) { truncated = true; return }
    // Extra property names are artifact data. Do not echo their content in diagnostics.
    issues.push({ path, code })
  }
  const check = (actual, rule, path) => {
    if (rule.kind === 'object') {
      if (!object(actual)) { issue(path, 'expected-object'); return }
      for (const [key, child] of Object.entries(rule.fields)) {
        const childPath = path + '/' + pointer(key)
        if (!Object.hasOwn(actual, key)) issue(childPath, 'missing-key')
        else check(actual[key], child, childPath)
      }
      if (!rule.allowAdditional && Object.keys(actual).some(key => !Object.hasOwn(rule.fields, key)))
        issue(path, 'unexpected-keys')
    } else {
      if (rule.type && (typeof actual !== rule.type || rule.type === 'number' && !Number.isFinite(actual)))
        issue(path, 'wrong-type')
      if (rule.choices && !rule.choices.some(choice => choice === actual)) issue(path, 'outside-enum')
    }
  }
  check(value, contract, '')
  return { passed: issues.length === 0, issues, truncated }
}
