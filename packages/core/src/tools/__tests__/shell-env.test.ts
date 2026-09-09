import { describe, it, expect, beforeEach } from 'vitest'
import { applyShellOverrides, getBaseShellEnv, resetShellEnvCacheForTests } from '../shell-env.js'

beforeEach(() => {
  resetShellEnvCacheForTests()
})

describe('shell-env', () => {
  it('[P0] 模块级缓存：第二次不抛错且返回同一引用', () => {
    const a = getBaseShellEnv()
    const b = getBaseShellEnv()
    expect(a).toBe(b)
  })

  it('[P0] 覆盖项符合 D05 定稿', () => {
    const env = applyShellOverrides({ FOO: 'bar' })
    expect(env.FOO).toBe('bar')
    expect(env.TERM).toBe('dumb')
    expect(env.PAGER).toBe('cat')
    expect(env.GIT_PAGER).toBe('cat')
    expect(env.GIT_EDITOR).toBe('true')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_ASKPASS).toBe('')
    expect(env.SSH_ASKPASS).toBe('')
    expect(env.DISPLAY).toBe('')
    expect(env).not.toHaveProperty('NO_COLOR')
  })
})
