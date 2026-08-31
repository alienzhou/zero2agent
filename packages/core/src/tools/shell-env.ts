import { execFileSync } from 'node:child_process'

const DELIMITER = '__Z2A_ENV__'

let cachedEnv: NodeJS.ProcessEnv | null = null
let loadFailed = false
let failureNoticePending = false

/**
 * 启动时用 login shell 采集一次 env，模块级缓存。
 * 采集失败回退 process.env，并在首次回执告知模型。
 */
export function getBaseShellEnv(): NodeJS.ProcessEnv {
  if (cachedEnv) return cachedEnv

  const shell = process.env.SHELL || '/bin/bash'
  const rc = shell.includes('zsh') ? '~/.zshrc' : '~/.bashrc'
  const cmd = `[ -f ${rc} ] && source ${rc} < /dev/null; echo -n "${DELIMITER}"; command env; echo -n "${DELIMITER}"`

  try {
    const out = execFileSync(shell, ['-lc', cmd], {
      timeout: 5000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    })
    const parts = out.split(DELIMITER)
    const envBlock = parts[1] ?? ''
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const line of envBlock.split('\n')) {
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx)
      const value = line.slice(idx + 1)
      env[key] = value
    }
    cachedEnv = env
    loadFailed = false
  } catch {
    cachedEnv = { ...process.env }
    loadFailed = true
    failureNoticePending = true
  }

  return cachedEnv
}

/** 若采集失败，消费一次性回执提示 */
export function consumeShellEnvFailureNotice(): boolean {
  if (loadFailed && failureNoticePending) {
    failureNoticePending = false
    return true
  }
  return false
}

/** 每次 spawn 时覆盖的防挂起 env */
export function applyShellOverrides(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    TERM: 'dumb',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    DISPLAY: '',
  }
}

export function buildSpawnEnv(): NodeJS.ProcessEnv {
  return applyShellOverrides(getBaseShellEnv())
}

/** 测试用：重置模块缓存 */
export function resetShellEnvCacheForTests(): void {
  cachedEnv = null
  loadFailed = false
  failureNoticePending = false
}
