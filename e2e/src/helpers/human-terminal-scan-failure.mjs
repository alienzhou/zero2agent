import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { terminalTool } from '@zero2agent/core'
import { setupTerminalRuntime } from '../../../packages/tui/dist/setup-terminal-runtime.js'

const exec = cp.execFileSync
cp.execFileSync = function (file, args, options) {
  if (file === '/bin/ps') {
    // Allow the real command to create its child before injecting inspection failure.
    exec('/bin/sleep', ['0.1'])
    throw new Error('Injected process inspection failure')
  }
  return exec(file, args, options)
}
syncBuiltinESMExports()
setupTerminalRuntime()
console.log(
  await terminalTool.execute(
    { command: 'bash ./scan.sh', interactive: true },
    { cwd: process.cwd() }
  )
)
