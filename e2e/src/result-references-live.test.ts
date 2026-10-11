import { it, expect } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { isLiveEnabled, runCli, makeTempWorkspace, REPO_ROOT } from './helpers/cli.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'

it.skipIf(!isLiveEnabled())(
  'E04-S002 live model finds a random tail marker by reading a saved result reference',
  async () => {
    const marker = `RESULT-${randomUUID()}`
    const body = 'synthetic-log-entry '.repeat(16000) + `\nEVIDENCE=${marker}\n`
    const workspace = await makeTempWorkspace({ 'large.log': body })
    const env = {
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      PERMISSION_MODE: 'read-only',
      PERMISSION_RULES: '[]',
      CONTEXT_COUNTING: 'conservative',
      ZERO2AGENT_MAX_ITERATIONS: '5',
      ZERO2AGENT_MAX_TOOL_CALLS: '4',
      ZERO2AGENT_MAX_REQUESTS: '8',
      ZERO2AGENT_MAX_DURATION_MS: '180000',
      ZERO2AGENT_REQUEST_TIMEOUT_MS: '90000',
      ZERO2AGENT_SESSION_DIR: path.join(workspace.dir, 'sessions'),
      ZERO2AGENT_RESULT_DIR: path.join(workspace.dir, 'results'),
      ZERO2AGENT_LOG_DIR: path.join(workspace.dir, 'logs'),
      ZERO2AGENT_CHECKPOINT_DIR: path.join(workspace.dir, 'checkpoints'),
    }
    try {
      const result = await runCli({
        cwd: workspace.dir,
        env,
        args: [
          'This is a result-reference integration test. First call read_file once with path large.log and no line range. Its large output will be saved as a tool_result_reference. Then use read_tool_result to inspect its last 512 bytes (offset = bytes - 512). Do not read the source file again or use any other tools. Return the exact EVIDENCE value from the saved output. The value is unknown to you until you read it.',
        ],
      })
      const sessions = await SessionStore.open(workspace.dir, env.ZERO2AGENT_SESSION_DIR)
      const [item] = await sessions.list()
      const saved = await sessions.load(item.id)
      const calls = saved.state.messages.flatMap(message =>
        Array.isArray(message.content)
          ? message.content.filter(block => block.type === 'tool_use')
          : []
      )
      const results = saved.state.messages.flatMap(message =>
        Array.isArray(message.content)
          ? message.content.filter(block => block.type === 'tool_result')
          : []
      )
      const entry = saved.state.results?.entries[0]
      const evidence = JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          platform: process.platform,
          node: process.version,
          scope:
            'Real configured model service and production CLI; generated local log with a random marker absent from the prompt.',
          marker,
          result,
          calls,
          results,
          catalog: saved.state.results,
          sourceHashes: Object.fromEntries(
            await Promise.all(
              [
                'packages/core/src/result-store.ts',
                'packages/core/src/loop.ts',
                'packages/core/src/tools/read-tool-result.ts',
              ].map(async file => [
                file,
                createHash('sha256')
                  .update(await fs.readFile(path.join(REPO_ROOT, file)))
                  .digest('hex'),
              ])
            )
          ),
        },
        null,
        2
      )
      if (process.env.ANTHROPIC_API_KEY && evidence.includes(process.env.ANTHROPIC_API_KEY))
        throw Error('Credential in evidence; refusing to save')
      if (process.env.E2E_EVIDENCE_DIR) {
        await fs.mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        await fs.writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'result-references-live.json.gz'),
          gzipSync(evidence)
        )
      }
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(marker)
      expect(calls.filter(call => call.name === 'read_file')).toHaveLength(1)
      const reads = calls.filter(call => call.name === 'read_tool_result')
      expect(reads.length).toBeGreaterThanOrEqual(1)
      expect(reads[0].input).toMatchObject({ reference: entry!.reference })
      expect(results.filter(result => result.tool_use_id === reads[0].id)[0].content).toContain(
        marker
      )
      expect(saved.state.results!.entries).toHaveLength(1)
    } finally {
      await workspace.cleanup()
    }
  },
  210_000
)
