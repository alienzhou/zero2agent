import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fixture, IDS } from '../fixtures.mjs'
import { checkArtifactContract } from '../artifact-contract.mjs'
const inputs = JSON.parse(await fs.readFile(new URL('./inputs.json', import.meta.url)))
const contracts = JSON.parse(await fs.readFile(new URL('./contracts.json', import.meta.url)))
test('all eight tasks retain their full original request and the explicit golden input', () => {
  assert.deepEqual(inputs.map(i => i.id), IDS)
  for (const input of inputs) {
    assert.equal(input.originalTask, fixture(input.id).finalPrompt)
    assert.deepEqual(input.contract, contracts[input.id])
    assert.equal(input.task, '[Caller-declared artifact contract (JSON structure only). This is not permission to perform additional actions and does not certify facts or sources.]\n' + JSON.stringify(input.contract) + '\n\n' + input.originalTask)
    assert.equal(input.contract.artifacts.length, 1)
    const artifact = input.contract.artifacts[0]
    assert.equal(artifact.path, 'report.json')
    assert.equal(artifact.format, 'json')
    assert.equal(checkArtifactContract({}, artifact.schema).passed, false)
  }
})
