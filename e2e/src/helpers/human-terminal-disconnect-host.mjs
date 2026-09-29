import fs from 'node:fs'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

// Only lifecycle metadata, never terminal input/output, is captured for this fault test.
const trace = []
const record = event => {
  trace.push({
    event,
    ended: process.stdin.readableEnded,
    destroyed: process.stdin.destroyed,
    flowing: process.stdin.readableFlowing,
    handles: process._getActiveHandles().map(h => h.constructor.name),
  })
  fs.writeFileSync('disconnect-state.json', JSON.stringify(trace))
}
const exec = cp.execFileSync
cp.execFileSync = function (...args) {
  record(`before exec ${args[0]}`)
  try {
    return exec.apply(this, args)
  } finally {
    record(`after exec ${args[0]}`)
  }
}
syncBuiltinESMExports()
const write = process.stdout.write
process.stdout.write = function (...args) {
  record('before stdout')
  try {
    return write.apply(this, args)
  } finally {
    record('after stdout')
  }
}
const raw = process.stdin.setRawMode
process.stdin.setRawMode = function (value) {
  record(`before raw ${value}`)
  try {
    return raw.call(this, value)
  } finally {
    record(`after raw ${value}`)
  }
}
process.once('SIGHUP', () => record('SIGHUP'))
process.once('exit', () => record('exit'))
setInterval(() => record('tick'), 500).unref()
await import('../../../packages/tui/dist/cli.js')
