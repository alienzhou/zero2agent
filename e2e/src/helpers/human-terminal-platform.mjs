import { runHumanTerminal } from '../../../packages/tui/dist/human-terminal.js'

// Only the guard is simulated; this is not Windows/ConPTY integration evidence.
Object.defineProperty(process, 'platform', { value: 'win32' })
try {
  await runHumanTerminal({ command: 'echo MUST_NOT_RUN', cwd: process.cwd() })
  process.exitCode = 1
} catch (error) {
  console.log(`GUARD:${error.message}`)
}
