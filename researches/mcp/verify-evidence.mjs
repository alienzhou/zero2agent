// Verify an already-extracted evidence archive; does not execute archived code or business tools.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = await fs.realpath(process.argv[2] ?? '')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const index = JSON.parse(
  await fs.readFile(new URL('./evidence-archive.json', import.meta.url), 'utf8')
)
const manifestBytes = await fs.readFile(path.join(root, 'manifest.json'))
assert(
  [index, ...(index.supplements ?? [])].some(item => item.manifestSha256 === sha(manifestBytes)),
  'Manifest digest mismatch'
)
const manifest = JSON.parse(manifestBytes)
async function files(dir, prefix = '') {
  const all = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + e.name : e.name
    assert(!e.isSymbolicLink(), 'Archive cannot contain symlinks')
    if (e.isDirectory()) all.push(...(await files(path.join(dir, e.name), name)))
    else {
      assert(e.isFile())
      all.push(name)
    }
  }
  return all.sort()
}
assert.deepEqual(
  (await files(root)).filter(n => n !== 'manifest.json'),
  Object.keys(manifest.files).sort(),
  'Manifest file set differs'
)
for (const [name, entry] of Object.entries(manifest.files)) {
  assert(!path.isAbsolute(name) && !name.split('/').includes('..'))
  const bytes = await fs.readFile(path.join(root, name))
  assert.equal(bytes.length, entry.bytes, name)
  assert.equal(sha(bytes), entry.sha256, name)
}
for (const run of manifest.runs) {
  const result = JSON.parse(
    await fs.readFile(path.join(root, run.path, 'verification.json'), 'utf8')
  )
  for (const table of [result.sourceHashes, result.runtimeHashes])
    for (const [name, hash] of Object.entries(table)) {
      assert.equal(
        sha(await fs.readFile(path.join(root, run.path, 'source', name))),
        hash,
        run.path + ':' + name
      )
    }
  if (run.qualifiesCurrent) {
    assert(
      result.passed && result.hashesStillCurrent,
      'Accepted run must pass its own current-hash gate'
    )
    assert(result.cases.every(c => c.passed && c.requests <= 8 && c.tools <= 12))
    assert.equal(result.limits.maxDurationMs, 120000)
  }
}
console.log(
  JSON.stringify(
    {
      passed: true,
      files: Object.keys(manifest.files).length,
      runs: manifest.runs.map(r => ({ path: r.path, qualifiesCurrent: r.qualifiesCurrent })),
    },
    null,
    2
  )
)
