/**
 * 在真实 PTY 中跑 terminal，复用生产 setupTerminalRuntime。
 * 使用最小 readline stub（仅 pause/resume）避免 question 抢占 stdin。
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setupTerminalRuntime } from '../../../../../tui/dist/setup-terminal-runtime.js'
import { terminalTool } from '../../../../dist/tools/terminal.js'
import { getTerminalRuntimeHooks, setTerminalRuntimeHooks } from '../../../../dist/index.js'

const TUI_SETUP = fileURLToPath(
  new URL('../../../../../tui/dist/setup-terminal-runtime.js', import.meta.url)
)
const TERMINAL_DIST = fileURLToPath(new URL('../../../../dist/tools/terminal.js', import.meta.url))

if (!fs.existsSync(TUI_SETUP)) {
  console.error('tui dist missing; run pnpm --filter @zero2agent/tui build first')
  process.exit(2)
}
if (!fs.existsSync(TERMINAL_DIST)) {
  console.error('core dist missing; run pnpm --filter @zero2agent/core build first')
  process.exit(2)
}

const config = JSON.parse(process.argv[2])
const { cwd, command, resultPath, statusLogPath, readyPath, commandStartPath } = config

let commandStartAt = 0
let statusStream = null
if (statusLogPath) {
  statusStream = fs.createWriteStream(statusLogPath, { flags: 'a' })
}

/** 交互模式 readline 在 terminal 期间 pause/resume 的最小替身（供生产 attachInterrupts 调用） */
const rlTracePath = config.rlTracePath
const rlTrace = []
const rl = {
  pause() {
    rlTrace.push('pause')
  },
  resume() {
    rlTrace.push('resume')
  },
  close() {},
}

setupTerminalRuntime(rl, {
  onStatusLine: line => {
    if (!statusStream) return
    if (!commandStartAt) commandStartAt = Date.now()
    statusStream.write(
      `${JSON.stringify({
        at: Date.now(),
        sinceStartMs: Date.now() - commandStartAt,
        line,
      })}\n`
    )
  },
})

// Schedule test keys from the production listener becoming ready, not Python/Node startup.
const runtime = getTerminalRuntimeHooks()
setTerminalRuntimeHooks({
  ...runtime,
  attachInterrupts(controller) {
    const detach = runtime.attachInterrupts(controller)
    if (commandStartPath) fs.writeFileSync(commandStartPath, String(Date.now()))
    return detach
  },
})

if (readyPath) {
  fs.writeFileSync(readyPath, String(process.pid))
}

try {
  const result = await terminalTool.execute({ command }, { cwd })
  fs.writeFileSync(resultPath, result)
  if (rlTracePath) {
    fs.writeFileSync(rlTracePath, JSON.stringify(rlTrace))
  }
  process.exit(0)
} catch (err) {
  fs.writeFileSync(resultPath, `HARNESS_ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
