import readline from 'node:readline'
import { terminalTool } from '@zero2agent/core'
import { setupTerminalRuntime } from '../../../packages/tui/dist/setup-terminal-runtime.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
setupTerminalRuntime(rl)
const snapshot = () => ({
  raw: process.stdin.isRaw,
  paused: process.stdin.isPaused(),
  data: process.stdin.listeners('data'),
  keypress: process.stdin.listeners('keypress'),
})
const baseline = snapshot()
for (let round = 1; round <= 2; round++) {
  console.log(`HARNESS_ROUND_${round}`)
  const receipt = await terminalTool.execute(
    { command: 'bash ./secret.sh', interactive: true },
    { cwd: process.cwd() }
  )
  const after = snapshot()
  const restored = after.raw === baseline.raw && after.paused === baseline.paused &&
    ['data', 'keypress'].every(event => after[event].length === baseline[event].length &&
      after[event].every((listener, index) => listener === baseline[event][index]))
  console.log(`RESTORED_${round}:${restored}`)
  console.log(`RECEIPT_${round}:${JSON.stringify(receipt)}`)
}
rl.question('AFTER_READY:', answer => {
  console.log(`AFTER:${answer}`)
  console.log(`HISTORY:${JSON.stringify(rl.history)}`)
  rl.close()
})
