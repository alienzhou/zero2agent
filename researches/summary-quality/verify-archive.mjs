// Verify an extracted, separately downloaded evidence archive. No network, model, or Git writes.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

assert.equal(process.argv.length, 3, 'Pass the extracted archive directory')
const root = await fs.realpath(process.argv[2])
const pinned = JSON.parse(await fs.readFile(new URL('./evidence-archive.json', import.meta.url)))
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json')))
assert.equal(manifest.version, 1)
assert.equal(manifest.originalHead, pinned.originalHead)
assert.equal(manifest.baseCommit, pinned.baseCommit)
assert.equal(manifest.formalRecords, pinned.formalRecords)
assert.equal(manifest.snapshotFiles, pinned.snapshotFiles)
let verified = 0
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'))
  const target = await fs.realpath(path.join(root, name))
  assert.ok(target.startsWith(root + path.sep), 'Archive file must stay inside the extraction root')
  assert.equal(createHash('sha256').update(await fs.readFile(target)).digest('hex'), expected, name)
  verified++
}
assert.equal(verified, pinned.snapshotFiles + 1) // Complete snapshot plus original Git bundle.
console.log(JSON.stringify({ originalHead: manifest.originalHead, verifiedFiles: verified, formalRecords: manifest.formalRecords }))
