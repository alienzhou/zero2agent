import readline from 'node:readline'
import { terminalTool } from '@zero2agent/core'
import { setupTerminalRuntime } from '../../../packages/tui/dist/setup-terminal-runtime.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
setupTerminalRuntime(rl)
const receipt = await terminalTool.execute(
  { command: 'bash ./exit.sh', interactive: true },
  { cwd: process.cwd() }
)
console.log(`FINAL_RECEIPT:${JSON.stringify(receipt)}`)
rl.question('AFTER_TEARDOWN:', answer => {
  console.log(`ANSWER:${answer}`)
  console.log(`HISTORY:${JSON.stringify(rl.history)}`)
  rl.close()
})
