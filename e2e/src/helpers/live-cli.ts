import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runCli, type RunCliOptions, type CliResult } from './cli.js'
import { startLivePty, type LivePtySession, type LiveBlock } from './live-pty.js'

/** Explicit host configuration for older non-TTY live regression tasks. */
export function liveCliEnv(access: 'read' | 'edit' | 'terminal'): Record<string, string> {
  return {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    CONTEXT_WINDOW: process.env.CONTEXT_WINDOW ?? '30000',
    MAX_INPUT_TOKENS: process.env.MAX_INPUT_TOKENS ?? '24000',
    MAX_OUTPUT_TOKENS: process.env.MAX_OUTPUT_TOKENS ?? '2048',
    CONTEXT_COUNTING: 'conservative',
    ...(process.env.MODEL_NAME ? { MODEL_NAME: process.env.MODEL_NAME } : {}),
    PERMISSION_MODE: access === 'edit' ? 'accept-edits' : 'default',
    PERMISSION_RULES: JSON.stringify(
      access === 'terminal' ? [{ tool: 'terminal', action: 'allow' }] : []
    ),
  }
}

export interface LiveCliResult extends CliResult {
  requests: LivePtySession['requests']
  responses: LivePtySession['responses']
  toolCalls: LiveBlock[]
  toolResults: LiveBlock[]
}

/** Observe real provider traffic so assertions use actual receipts, not model paraphrases. */
export async function runLiveCli(options: RunCliOptions): Promise<LiveCliResult> {
  const hostEnv = Object.fromEntries(
    Object.entries(options.env ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  const p = await startLivePty({}, hostEnv)
  try {
    const raw = await runCli({
      ...options,
      env: {
        ...p.env,
        ...options.env,
        // Keep generated spill files in this test's temporary workspace.
        TMPDIR: options.cwd,
        ANTHROPIC_API_KEY: p.env.ANTHROPIC_API_KEY,
        ANTHROPIC_BASE_URL: p.env.ANTHROPIC_BASE_URL,
        ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      },
    })
    const blocks = p.requests.flatMap(r =>
      r.messages.flatMap(m => (Array.isArray(m.content) ? m.content : []))
    )
    const result: LiveCliResult = {
      ...raw,
      requests: p.requests,
      responses: p.responses,
      toolCalls: [
        ...new Map(blocks.filter(b => b.type === 'tool_use').map(b => [b.id, b])).values(),
      ],
      toolResults: [
        ...new Map(
          blocks.filter(b => b.type === 'tool_result').map(b => [b.tool_use_id, b])
        ).values(),
      ],
    }
    if (process.env.E2E_EVIDENCE_DIR) {
      const text = JSON.stringify(
        { args: options.args, platform: process.platform, ...result },
        null,
        2
      )
      if (process.env.ANTHROPIC_API_KEY && text.includes(process.env.ANTHROPIC_API_KEY))
        throw new Error('Credential appeared in evidence; refusing to save')
      await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
      await writeFile(join(process.env.E2E_EVIDENCE_DIR, 'cli-' + randomUUID() + '.json'), text)
    }
    return result
  } finally {
    await p.close()
  }
}

export function liveToolReceipts(result: LiveCliResult, name: string): string[] {
  const ids = new Set(result.toolCalls.filter(b => b.name === name).map(b => b.id))
  return result.toolResults.filter(b => ids.has(b.tool_use_id)).map(b => String(b.content ?? ''))
}
