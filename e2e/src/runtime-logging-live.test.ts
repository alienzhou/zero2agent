import { it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { isLiveEnabled, runCli } from './helpers/cli.js'
import { startLivePty } from './helpers/live-pty.js'
import { LogStore } from '../../packages/tui/dist/run-log.js'

it.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E03-S005 live: real model tool results correlate to logs and the viewer never calls the provider',
  async () => {
    const token = `LOG-PROBE-${randomUUID()}`
    const p = await startLivePty(
      { 'probe.txt': token },
      { PERMISSION_MODE: 'read-only' },
      { ui: 'tui' }
    )
    try {
      await p.session.waitFor('你: ')
      p.session.write(
        'Read probe.txt now using the read_file tool exactly once, then reply with its actual contents only. This is a real filesystem integration test; do not simulate a result or use other tools.\r'
      )
      await p.session.waitFor('已保存 r2')
      expect(p.session.output).toContain(token)
      const store = await LogStore.open(p.cwd)
      const [item] = await store.list()
      expect(item).toBeTruthy()
      const before = p.requests.length
      const from = p.session.output.length
      p.session.write('/log\r')
      await p.session.waitFor('查看运行日志', from)
      const back = p.session.output.length
      p.session.write('\x1b')
      await p.session.waitFor('等待输入', back)
      expect(p.requests.length).toBe(before)
      p.session.write('exit\r')
      expect(await p.session.waitExit()).toBe(0)
      const report = await store.read(item.id)
      expect(report.warnings).toEqual([])
      const tool = report.records.find(
        r => r.kind === 'tool' && r.event === 'completed' && r.toolName === 'read_file'
      )!
      expect(tool).toBeTruthy()
      expect(
        report.records.some(
          r =>
            r.kind === 'request' &&
            r.event === 'completed' &&
            r.requestId === tool.requestId &&
            r.stopReason === 'tool_use'
        )
      ).toBe(true)
      const toolCall = p.requests
        .flatMap(r => r.messages)
        .flatMap(m => (Array.isArray(m.content) ? m.content : []))
        .find(block => block.type === 'tool_use' && block.id === tool.toolCallId)
      expect(toolCall?.name).toBe('read_file')
      expect(
        report.records.some(
          r =>
            r.kind === 'request' &&
            r.event === 'completed' &&
            typeof r.inputTokens === 'number' &&
            typeof r.outputTokens === 'number'
        )
      ).toBe(true)
      const raw = await readFile(path.join(store.directory, item.id + '.jsonl'), 'utf8')
      expect(raw).not.toContain(token)
      expect(raw).not.toContain('probe.txt')
      expect(raw).not.toContain(process.env.ANTHROPIC_API_KEY!)
      const read = await runCli({
        cwd: p.cwd,
        env: { ...p.env, ANTHROPIC_API_KEY: undefined, ZERO2AGENT_SKIP_LOCAL_ENV: '1' },
        args: ['--log', item.id],
      })
      expect(read.code).toBe(0)
      expect(read.stdout).toContain(tool.toolCallId!)
      expect(p.requests.length).toBe(before)
      expect(await readFile(path.join(store.directory, item.id + '.jsonl'), 'utf8')).toBe(raw)
      if (process.env.E2E_EVIDENCE_DIR) {
        const evidence = JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            platform: process.platform,
            node: process.version,
            report,
            requests: p.requests,
            responses: p.responses,
            actualOutput: p.session.output,
            readonlyCliExit: read.code,
            viewerMadeNoRequests: true,
            tokenAbsentFromRunLog: true,
            rawJournal: raw,
          },
          null,
          2
        )
        if (evidence.includes(process.env.ANTHROPIC_API_KEY!))
          throw new Error('Credential appeared in evidence; refusing to save')
        await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        await writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'runtime-log-live.json.gz'),
          gzipSync(evidence)
        )
      }
    } finally {
      await p.close()
    }
  },
  120_000
)
