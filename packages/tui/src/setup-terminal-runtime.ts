import {
  getTerminalRuntimeHooks,
  listBackgroundProcesses,
  setTerminalRuntimeHooks,
} from '@zero2agent/core'
import * as readline from 'node:readline'

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

export interface SetupTerminalRuntimeOptions {
  /** 测试 harness 可挂接状态行，不改变生产 onStatus 行为 */
  onStatusLine?: (line: string) => void
}

/**
 * 生产 TUI 的 terminal 运行时绑定（按键接管 / 运行中提示）。
 * 交互模式须传入与 CLI 相同的 readline.Interface。
 */
export function setupTerminalRuntime(
  rl?: readline.Interface,
  options?: SetupTerminalRuntimeOptions
): void {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true

  setTerminalRuntimeHooks({
    isTTY,
    onStatus: line => {
      options?.onStatusLine?.(line)
      process.stdout.write(`${DIM}${line}${RESET}\n`)
    },
    attachInterrupts: controller => {
      if (!isTTY) return () => {}

      readline.emitKeypressEvents(process.stdin)
      const wasRaw = process.stdin.isRaw
      if (process.stdin.isTTY) process.stdin.setRawMode(true)
      rl?.pause()

      const onKeypress = (_str: string, key: readline.Key) => {
        if (!key) return
        if (key.ctrl && key.name === 'x') controller.signalCancel()
        if (key.ctrl && key.name === 's') controller.signalSkip()
        // Ctrl-C 保持默认语义，不吞掉
        if (key.ctrl && key.name === 'c') {
          process.stdin.removeListener('keypress', onKeypress)
          if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false)
          rl?.resume()
          process.kill(process.pid, 'SIGINT')
        }
      }
      process.stdin.on('keypress', onKeypress)

      return () => {
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false)
        rl?.resume()
      }
    },
    promptBackgroundCleanup: async entries => {
      if (!isTTY || entries.length === 0) return false
      console.log(`\n还有 ${entries.length} 个后台命令在运行：`)
      for (const e of entries) {
        const elapsed = Math.round((Date.now() - e.startAt) / 1000)
        console.log(`  [${e.pid}] ${e.command} （已运行 ${elapsed}s）`)
      }
      return new Promise(resolve => {
        const cleanupRl = readline.createInterface({ input: process.stdin, output: process.stdout })
        cleanupRl.question('要一并结束吗？(y/N) ', answer => {
          cleanupRl.close()
          resolve(answer.trim().toLowerCase() === 'y')
        })
      })
    },
  })
}

export async function cleanupBackgroundOnExit(): Promise<void> {
  const entries = listBackgroundProcesses()
  if (entries.length === 0) return

  const runtime = getTerminalRuntimeHooks()
  const shouldKill = await runtime.promptBackgroundCleanup?.(entries)
  if (!shouldKill) return

  for (const entry of entries) {
    try {
      process.kill(-entry.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch {
        // ignore
      }
    }
  }
}
