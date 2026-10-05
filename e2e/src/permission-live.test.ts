import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isLiveEnabled } from './helpers/live.js'
import { startLivePty } from './helpers/live-pty.js'

describe.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E03-S002: real provider approval through CLI and PTY',
  () => {
    it.each([true, false])('real model write proposal with user approved=%s', async approved => {
      const p = await startLivePty()
      try {
        const from = await p.input(
          '请仅使用 write_file 工具一次，在当前目录创建 approval-result.txt，content 参数精确为 permission-live-ok。收到工具结果后立即结束，不重试、不改用其他工具。不要使用 terminal。'
        )
        await p.session.waitFor('[y/N]: ', from)
        await expect(readFile(join(p.cwd, 'approval-result.txt'))).rejects.toThrow()
        const after = p.session.output.length
        p.session.write(approved ? 'y\r' : 'n\r')
        await p.session.waitFor('你: ', after)
        expect(await readFile(join(p.cwd, 'approval-result.txt'), 'utf8').catch(() => null)).toBe(
          approved ? 'permission-live-ok' : null
        )
        const blocks = p.requests.flatMap(r =>
          r.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []))
        )
        const receipt = blocks.find(b => b.type === 'tool_result')
        expect(receipt).toBeDefined()
        expect(receipt?.is_error === true).toBe(!approved)
        expect(p.responses.every(r => r.status === 200)).toBe(true)
        if (process.env.E2E_EVIDENCE_DIR) {
          await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
          await writeFile(
            join(process.env.E2E_EVIDENCE_DIR, `permission-${approved ? 'approve' : 'deny'}.json`),
            JSON.stringify(
              {
                provider: 'configured live provider',
                approved,
                requests: p.requests,
                responses: p.responses,
                output: p.session.output,
              },
              null,
              2
            )
          )
        }
        await p.input('exit', after)
        expect(await p.session.waitExit()).toBe(0)
      } finally {
        await p.close()
      }
    })
  }
)
