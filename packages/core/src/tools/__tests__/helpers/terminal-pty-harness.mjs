/**
 * 在真实 PTY（由外层 script 提供）里跑 terminal，绑定与 TUI 相同的 keypress 逻辑。
 */
import * as fs from 'node:fs'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { terminalTool } from '../../../../dist/tools/terminal.js'
import { setTerminalRuntimeHooks } from '../../../../dist/tools/terminal-runtime.js'

const TERMINAL_DIST = fileURLToPath(new URL('../../../../dist/tools/terminal.js', import.meta.url))
if (!fs.existsSync(TERMINAL_DIST)) {
  console.error('terminal dist missing; run pnpm build in packages/core first')
  process.exit(2)
}

function setupTerminalRuntimeLikeTui(statusLogPath) {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true
  const statusLog = statusLogPath ? fs.createWriteStream(statusLogPath, { flags: 'a' }) : null

  setTerminalRuntimeHooks({
    isTTY,
    onStatus: line => {
      statusLog?.write(`${JSON.stringify({ at: Date.now(), line })}\n`)
      process.stdout.write(`${line}\n`)
    },
    attachInterrupts: controller => {
      if (!isTTY) return () => {}

      readline.emitKeypressEvents(process.stdin)
      const wasRaw = process.stdin.isRaw
      if (process.stdin.isTTY) process.stdin.setRawMode(true)

      const onKeypress = (_str, key) => {
        if (!key) return
        if (key.ctrl && key.name === 'x') controller.signalCancel()
        if (key.ctrl && key.name === 's') controller.signalSkip()
        if (key.ctrl && key.name === 'c') {
          process.stdin.removeListener('keypress', onKeypress)
          if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false)
          process.kill(process.pid, 'SIGINT')
        }
      }
      process.stdin.on('keypress', onKeypress)

      return () => {
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false)
      }
    },
  })

  return isTTY
}

const config = JSON.parse(process.argv[2])
const { cwd, command, resultPath, statusLogPath, readyPath } = config

setupTerminalRuntimeLikeTui(statusLogPath)
if (readyPath) {
  fs.writeFileSync(readyPath, String(process.pid))
}

try {
  const result = await terminalTool.execute({ command }, { cwd })
  fs.writeFileSync(resultPath, result)
  process.exit(0)
} catch (err) {
  fs.writeFileSync(resultPath, `HARNESS_ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
