import fs from 'node:fs'

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
process.once('SIGHUP', () => record('SIGHUP'))
process.once('exit', () => record('exit'))
setInterval(() => record('tick'), 500).unref()
await import('../../../packages/tui/dist/cli.js')
