import * as readline from 'node:readline'
import type { ApprovalRequest, ApprovalResponse, PermissionOptions } from '@zero2agent/core'

/** Reuse the main readline only while a Turn is running; never consume piped answers. */
export function createApprovalHandler(
  getReadline: () => readline.Interface | undefined
): NonNullable<PermissionOptions['requestApproval']> {
  return async (request: ApprovalRequest): Promise<ApprovalResponse> => {
    const answer = (decision: 'allow' | 'deny', reason: string): ApprovalResponse => ({
      requestId: request.id,
      decision,
      reason,
    })
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      return answer('deny', 'Approval requires an interactive TTY')
    if (request.signal.aborted) return answer('deny', 'Approval expired')
    const shared = getReadline()
    const rl = shared ?? readline.createInterface({ input: process.stdin, output: process.stdout })
    // JSON encoding renders control characters as text rather than terminal commands.
    process.stdout.write(
      `\nApproval · ${JSON.stringify(request.toolName)}\n工作目录: ${JSON.stringify(request.cwd)}\n参数: ${JSON.stringify(request.input, null, 2)}\n原因: ${JSON.stringify(request.reason)}\n`
    )
    try {
      return await new Promise<ApprovalResponse>(resolve => {
        let settled = false
        const finish = (decision: 'allow' | 'deny', reason: string) => {
          if (settled) return
          settled = true
          rl.removeListener('close', onClose)
          rl.removeListener('SIGINT', onInterrupt)
          request.signal.removeEventListener('abort', onAbort)
          // Abort just this question; the conversational readline remains available.
          question.abort()
          resolve(answer(decision, reason))
        }
        const question = new AbortController()
        const onClose = () => finish('deny', 'Input closed')
        const onInterrupt = () => finish('deny', 'Approval cancelled by user')
        const onAbort = () => finish('deny', String(request.signal.reason))
        rl.once('close', onClose)
        rl.once('SIGINT', onInterrupt)
        request.signal.addEventListener('abort', onAbort, { once: true })
        rl.question('允许这次操作？[y/N]: ', { signal: question.signal }, input => {
          const approved = input.trim().toLowerCase() === 'y'
          finish(
            approved ? 'allow' : 'deny',
            approved ? 'User approved this call' : 'User denied this call'
          )
        })
      })
    } finally {
      if (!shared) rl.close()
    }
  }
}

export function permissionOptionsFromEnv(
  handler: PermissionOptions['requestApproval']
): PermissionOptions {
  return {
    mode: (process.env.PERMISSION_MODE ?? 'default') as PermissionOptions['mode'],
    rules: process.env.PERMISSION_RULES ? JSON.parse(process.env.PERMISSION_RULES) : undefined,
    approvalTimeoutMs: process.env.APPROVAL_TIMEOUT_MS
      ? Number(process.env.APPROVAL_TIMEOUT_MS)
      : undefined,
    requestApproval: handler,
  }
}
