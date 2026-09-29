import readline from 'node:readline'
import path from 'node:path'
import { runHumanTerminal } from '../../../packages/tui/dist/human-terminal.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const baseline = {
  raw: process.stdin.isRaw,
  data: process.stdin.rawListeners('data'),
  keys: process.stdin.rawListeners('keypress'),
}
let failed = false
try {
  await runHumanTerminal(
    { command: 'echo SHOULD_NOT_RUN', cwd: path.join(process.cwd(), 'missing-directory') },
    rl
  )
} catch {
  failed = true
}
const same = (event, expected) => {
  const actual = process.stdin.rawListeners(event)
  return (
    actual.length === expected.length && actual.every((listener, i) => listener === expected[i])
  )
}
console.log(
  `FAILURE_RESTORED:${failed && baseline.raw === process.stdin.isRaw && same('data', baseline.data) && same('keypress', baseline.keys)}`
)
rl.question('AFTER_FAILURE:', answer => {
  console.log(`ANSWER:${answer}`)
  rl.close()
})
