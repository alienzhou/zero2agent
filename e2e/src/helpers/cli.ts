/**
 * CLI 驱动 helper
 *
 * E2E 的被测对象是「构建产物 + 真实进程」，而不是 import 进来的模块。
 * 所有用例都通过这里 spawn `node dist/cli.js`，从而覆盖到进程边界：
 * 参数解析、环境变量校验、退出码、stdout/stderr 格式、交互模式的 stdin。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 仓库根目录（本文件位于 e2e/src/helpers/） */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

/** CLI 构建产物路径 */
export const CLI_ENTRY = path.join(REPO_ROOT, 'packages/tui/dist/cli.js')

export interface RunCliOptions {
  /** 位置参数，即一次性任务的消息 */
  args?: string[]
  /** 进程工作目录，决定 Agent 的文件操作根目录 */
  cwd?: string
  /** 追加/覆盖的环境变量；值为 undefined 表示从环境中删除该变量 */
  env?: Record<string, string | undefined>
  /** 写入 stdin 的内容，用于驱动交互模式 */
  stdin?: string
  /** 是否继承当前进程的环境变量，默认 true */
  inheritEnv?: boolean
}

export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
  /** stdout + stderr，断言"输出里有没有某段内容"时更省事 */
  output: string
}

/**
 * 运行一次 CLI 并等待其退出
 */
export function runCli(options: RunCliOptions = {}): Promise<CliResult> {
  const { args = [], cwd = REPO_ROOT, env = {}, stdin, inheritEnv = true } = options

  const childEnv: Record<string, string> = {}
  if (inheritEnv) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) childEnv[key] = value
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[key]
    } else {
      childEnv[key] = value
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))

    child.on('error', reject)
    child.on('close', code => {
      resolve({ code, stdout, stderr, output: stdout + stderr })
    })

    if (stdin !== undefined) {
      child.stdin.write(stdin)
    }
    child.stdin.end()
  })
}

/**
 * 创建一个临时工作目录，返回目录路径与清理函数
 *
 * 写类工具的用例必须在临时目录里跑，避免污染仓库。
 */
export async function makeTempWorkspace(
  files: Record<string, string> = {}
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-e2e-'))

  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(dir, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }

  return {
    dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  }
}

/** 剥掉 ANSI 转义序列，便于对文本做断言 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * 真实 LLM 层是否启用
 *
 * 需要同时具备 API KEY 与显式开关，避免误烧 token。
 */
export function isLiveEnabled(): boolean {
  return process.env.E2E_LIVE === '1' && Boolean(process.env.ANTHROPIC_API_KEY)
}

/** 未启用真实 LLM 时给出的跳过原因 */
export function liveSkipReason(): string {
  if (!process.env.ANTHROPIC_API_KEY) return '缺少 ANTHROPIC_API_KEY'
  if (process.env.E2E_LIVE !== '1') return '未设置 E2E_LIVE=1'
  return ''
}
