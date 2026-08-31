/**
 * 第一层 E2E：CLI 契约（不调用 LLM）
 *
 * 这一层只验证「进程层面的契约」，全程不产生任何 API 调用，因此可以放进 CI：
 * - 环境变量校验与退出码
 * - 一次性任务模式 vs 交互模式的分流
 * - 交互模式的 stdin 处理与退出指令
 * - 网络失败时的错误处理
 *
 * 关键手法：用一个指向黑洞地址的 ANTHROPIC_BASE_URL，
 * 让 CLI 走完全部启动逻辑但请求必然失败，从而在零成本下测到错误分支。
 */
import { describe, it, expect } from 'vitest'
import { runCli, stripAnsi } from './helpers/cli.js'

/** 一个必然连不通的地址：端口 9 是 discard 协议，本地不会有服务监听 */
const DEAD_BASE_URL = 'http://127.0.0.1:9'

/** 契约层 E2E 需跳过 CLI 自动加载 .env.local，否则无法模拟缺 KEY 场景 */
const CONTRACT_ENV = { ZERO2AGENT_SKIP_LOCAL_ENV: '1' } as const

/** 让 CLI 能通过 KEY 校验、但任何请求都会失败的环境 */
const OFFLINE_ENV = {
  ...CONTRACT_ENV,
  ANTHROPIC_API_KEY: 'sk-e2e-placeholder',
  ANTHROPIC_BASE_URL: DEAD_BASE_URL,
}

describe('CLI 契约：环境变量校验', () => {
  it('缺少 ANTHROPIC_API_KEY 时应报错并以退出码 1 退出', async () => {
    const result = await runCli({
      args: ['读取 package.json'],
      env: { ...CONTRACT_ENV, ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: undefined },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('ANTHROPIC_API_KEY')
  })

  it('缺少 KEY 时错误信息应走 stderr 而非 stdout', async () => {
    const result = await runCli({
      args: ['读取 package.json'],
      env: { ...CONTRACT_ENV, ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: undefined },
    })

    expect(result.stderr.trim()).not.toBe('')
    expect(result.stdout).not.toContain('ANTHROPIC_API_KEY')
  })
})

describe('CLI 契约：一次性任务模式', () => {
  it('带位置参数时应直接执行任务，不进入交互模式', async () => {
    const result = await runCli({
      args: ['读取 package.json'],
      env: OFFLINE_ENV,
    })

    // 不应打印交互模式的欢迎语与提示符
    expect(result.stdout).not.toContain('输入你的问题')
    expect(result.stdout).not.toContain('你: ')
  })

  it('任务执行失败时应报错并以退出码 1 退出', async () => {
    const result = await runCli({
      args: ['读取 package.json'],
      env: OFFLINE_ENV,
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('执行出错')
  })
})

describe('CLI 契约：交互模式', () => {
  it('无位置参数时应打印欢迎语与提示符', async () => {
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: 'exit\n',
    })

    expect(result.stdout).toContain('zero2agent')
    expect(result.stdout).toContain('输入你的问题')
    expect(result.stdout).toContain('你: ')
  })

  it('输入 exit 应正常退出，退出码为 0', async () => {
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: 'exit\n',
    })

    expect(result.stdout).toContain('再见！')
    expect(result.code).toBe(0)
  })

  it('输入 quit 应与 exit 等效', async () => {
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: 'quit\n',
    })

    expect(result.stdout).toContain('再见！')
    expect(result.code).toBe(0)
  })

  it('空输入应重新提示而不执行任务', async () => {
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: '\n\nexit\n',
    })

    // 三次提示符：两次空输入各一次，加上最后接收 exit 的那次
    const promptCount = result.stdout.split('你: ').length - 1
    expect(promptCount).toBe(3)
    expect(result.stderr).not.toContain('错误')
  })

  it('单轮出错后应捕获错误，而不是让整个进程崩掉', async () => {
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: '读取 package.json\n',
    })

    // 错误被捕获并打印，而不是变成未捕获异常
    expect(result.stderr).toContain('错误')
    expect(result.stderr).not.toContain('ERR_USE_AFTER_CLOSE')
    expect(result.code).toBe(0)
  })

  it('任务执行期间 stdin 结束时不应抛 ERR_USE_AFTER_CLOSE', async () => {
    // 管道输入下，第一轮任务还在跑时 readline 就已读完并关闭。
    // 此时若无条件递归 prompt()，会 use-after-close 崩溃并丢掉退出码。
    const result = await runCli({
      env: OFFLINE_ENV,
      stdin: '读取 package.json\nexit\n',
    })

    expect(result.stderr).not.toContain('ERR_USE_AFTER_CLOSE')
    expect(stripAnsi(result.stderr)).not.toContain('throw err')
    expect(result.code).toBe(0)
  })

  it('stdin 直接关闭时不应抛出未捕获异常', async () => {
    const result = await runCli({ env: OFFLINE_ENV, stdin: '' })

    expect(stripAnsi(result.stderr)).not.toContain('Unhandled')
    expect(stripAnsi(result.stderr)).not.toContain('ERR_UNHANDLED')
  })
})
