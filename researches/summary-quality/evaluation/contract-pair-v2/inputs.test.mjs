import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from '../fixtures.mjs'
import { checkArtifactContract } from '../artifact-contract-described.mjs'
const before=JSON.parse(await fs.readFile(new URL('../contract-pair-v1/inputs.json',import.meta.url)))
const after=JSON.parse(await fs.readFile(new URL('./inputs.json',import.meta.url)))
test('the only new caller information is seven descriptions, without answers or source labels',()=>{
  let annotations=0
  for(let i=0;i<after.length;i++){
    const old=before[i], next=structuredClone(after[i])
    assert.equal(next.originalTask,old.originalTask)
    for(const [key,rule]of Object.entries(next.contract.artifacts[0].schema.fields.facts.fields))if(rule.description!==undefined){
      annotations++
      const fact=fixture(next.id).facts.find(f=>f.key===key)
      assert.ok(!rule.description.includes(String(fact.value)))
      assert.ok(!rule.description.includes(fact.source))
      delete rule.description
    }
    assert.deepEqual(next.contract,old.contract)
  }
  assert.equal(annotations,7)
})
test('descriptions do not convert a structurally valid wrong fact into semantic validation',()=>{
  const schema={kind:'object',allowAdditional:false,fields:{project:{kind:'value',type:'string',description:'Project identity, distinct from a diagnostic ID.'}}}
  assert.equal(checkArtifactContract({project:'A_DIAGNOSTIC_CODE'},schema).passed,true)
  assert.equal(checkArtifactContract({},schema).passed,false)
  assert.throws(()=>checkArtifactContract({}, {...schema,description:'a'.repeat(1025)}))
})
