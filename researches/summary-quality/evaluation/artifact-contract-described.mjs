// Independent research checker: descriptions are input annotations, never semantic proof.
import assert from 'node:assert/strict'
import { checkArtifactContract as checkStructuralContract } from './artifact-contract.mjs'
export function checkArtifactContract(value, contract) {
  let nodes=0
  const strip=(rule, depth=0)=>{
    assert.ok(rule && typeof rule==='object' && depth<=12 && ++nodes<=512)
    assert.ok(rule.description===undefined || typeof rule.description==='string' && Buffer.byteLength(rule.description)<=1024)
    const {description,...structure}=rule
    if(structure.kind==='object') structure.fields=Object.fromEntries(Object.entries(structure.fields).map(([key,child])=>[key,strip(child,depth+1)]))
    return structure
  }
  return checkStructuralContract(value,strip(contract))
}
