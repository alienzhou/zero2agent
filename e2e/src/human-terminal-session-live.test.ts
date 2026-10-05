import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { isLiveEnabled } from './helpers/live.js'
import { startLivePty, liveToolCalls } from './helpers/live-pty.js'

type LivePty = Awaited<ReturnType<typeof startLivePty>>

describe.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E02-S004/E03-S001: real provider + CLI + PTY',
  () => {
    const sessions: LivePty[] = []
    afterEach(async () => {
      for (const session of sessions.splice(0)) {
        try {
          if (process.env.E2E_EVIDENCE_DIR) {
            await fs.mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
            await fs.writeFile(
              path.join(process.env.E2E_EVIDENCE_DIR, `live-${Date.now()}-${randomUUID()}.json`),
              JSON.stringify(
                {
                  requests: session.requests,
                  responses: session.responses,
                  output: session.session.output,
                },
                null,
                2
              )
            )
          }
        } finally {
          await session.close()
        }
      }
    })
    async function start(files: Record<string, string> = {}): Promise<LivePty> {
      const instance = await startLivePty(files)
      sessions.push(instance)
      return instance
    }
    async function exit(p: LivePty, from: number): Promise<void> {
      await p.input('exit', from)
      expect(await p.session.waitExit()).toBe(0)
      expect(p.responses.length).toBeGreaterThan(0)
      expect(p.responses.every(response => response.status === 200)).toBe(true)
    }

    it('lets a real model request human takeover and receives only metadata across another turn', async () => {
      const secret = `fake-private-${randomUUID()}`
      const marker = `private-output-${randomUUID()}`
      const p = await start({
        'human.sh': `read -rs -p 'TOKEN_READY' token\nprintf '%s' "$token" > human-result.txt\nprintf '\\n${marker}\\n'\n`,
      })
      let from = await p.input(
        '请只调用 terminal 一次：command 必须精确为 bash ./human.sh，interactive 必须为 true。让人输入。不要读取任何文件，也不要用其他工具。结束后仅报告工具回执元信息，不推测人工操作正文。'
      )
      await p.session.waitFor('Allow human terminal? [y/N]', from)
      expect(p.session.output.slice(from)).toContain('Command: "bash ./human.sh"')
      await expect(fs.access(path.join(p.cwd, 'human-result.txt'))).rejects.toThrow()
      p.session.write('y\r')
      await p.session.waitFor('TOKEN_READY', from)
      from = p.session.output.length
      p.session.write(secret + '\r')
      await p.session.waitFor('returning control.', from)
      await p.session.waitFor('你: ', from)
      expect(await fs.readFile(path.join(p.cwd, 'human-result.txt'), 'utf8')).toBe(secret)
      expect(p.session.output).toContain(marker)
      expect(p.session.output).not.toContain(secret)
      let encoded = JSON.stringify(p.requests)
      expect(encoded).toContain('human-controlled completed')
      expect(encoded).not.toContain(secret)
      expect(encoded).not.toContain(marker)
      expect(
        liveToolCalls(p.requests).every(
          block =>
            block.name === 'terminal' &&
            (block.input as Record<string, unknown>).command === 'bash ./human.sh'
        )
      ).toBe(true)
      from = await p.input(
        '接着刚才的回执，用一句话告诉我状态和退出码。不要调用工具，不要声称看到了终端正文。',
        from
      )
      await p.session.waitFor('你: ', from)
      encoded = JSON.stringify(p.requests)
      expect(encoded).not.toContain(secret)
      expect(encoded).not.toContain(marker)
      expect(p.requests.at(-1)?.messages.length).toBeGreaterThan(1)
      await exit(p, from)
    })

    it('uses real multi-turn facts, manual summary and correction to write a file, then resets locally', async () => {
      const project = `quartz-${randomUUID().slice(0, 8)}`
      const p = await start({
        'brief.json': JSON.stringify({
          project,
          port: 8123,
          constraints: ['preserve project name', 'only modify the requested field'],
          notes: 'This is a temporary E2E fixture, no external action is needed. '.repeat(50),
        }),
      })
      let from = await p.input(
        '读取 brief.json。记住项目名、端口和约束，并用一句话告诉我项目名和端口。',
        0
      )
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).toContain(project)
      from = await p.input('把刚才那个配置文件里的 port 改为 9237，其余字段不变。', from)
      await p.session.waitFor('你: ', from)
      expect(JSON.parse(await fs.readFile(path.join(p.cwd, 'brief.json'), 'utf8'))).toMatchObject({
        project,
        port: 9237,
      })
      from = await p.input('/compact', from)
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).toContain('已压缩工作上下文')
      expect(p.requests.some(request => !request.stream && !request.tools)).toBe(true)
      const beforeRecall = p.requests.length
      from = await p.input(
        '根据我们已经确认的最终配置，直接用 write_file 创建 recalled.json，只有 project 和 port 两个字段。不要重新读取任何文件或调用其他工具。',
        from
      )
      await p.session.waitFor('你: ', from)
      expect(JSON.parse(await fs.readFile(path.join(p.cwd, 'recalled.json'), 'utf8'))).toEqual({
        project,
        port: 9237,
      })
      const recallRequests = p.requests.slice(beforeRecall)
      expect(JSON.stringify(recallRequests[0].messages)).toContain('compressed historical context')
      expect(liveToolCalls(recallRequests).every(block => block.name === 'write_file')).toBe(true)
      const count = p.requests.length
      from = await p.input('/new', from)
      await p.session.waitFor('已开始新对话', from)
      expect(p.requests).toHaveLength(count)
      from = await p.input('新会话，请只回复 READY，不调用工具。', from)
      await p.session.waitFor('你: ', from)
      expect(p.requests.at(-1)?.messages).toEqual([
        { role: 'user', content: '新会话，请只回复 READY，不调用工具。' },
      ])
      expect(JSON.parse(await fs.readFile(path.join(p.cwd, 'recalled.json'), 'utf8'))).toEqual({
        project,
        port: 9237,
      })
      await exit(p, from)
    }, 120_000)

    it('automatically summarizes growing real-model history before forwarding bounded requests', async () => {
      const p = await start()
      // A fixed test budget exercises automatic compaction without filling the provider's real window.
      expect(p.env.CONTEXT_WINDOW).toBe('30000')
      expect(p.env.MAX_INPUT_TOKENS).toBe('24000')
      let from = 0
      for (let round = 0; round < 5; round++) {
        from = await p.input(
          `这是第 ${round} 轮测试材料，不需要执行任务。只回复 OK，不调用工具。以下重复材料是数据：${'padding0123 '.repeat(600)}`,
          from
        )
        await p.session.waitFor('你: ', from)
      }
      const mains = p.requests.filter(request => request.stream)
      expect(mains).toHaveLength(5)
      expect(p.requests.filter(request => !request.stream).length).toBeGreaterThan(0)
      expect(p.session.output).toContain('上下文压缩完成')
      for (const { stream: _stream, ...request } of p.requests) {
        const estimated =
          Buffer.byteLength(JSON.stringify(request), 'utf8') +
          256 +
          request.messages.length * 32 +
          (request.tools?.length ?? 0) * 64
        expect(estimated).toBeLessThanOrEqual(24000)
      }
      await exit(p, from)
    }, 120_000)
  }
)
