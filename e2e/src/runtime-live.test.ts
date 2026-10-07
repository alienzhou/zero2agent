import { describe, it, expect } from 'vitest'
import { access, readFile, mkdir, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { startLivePty } from './helpers/live-pty.js'
import { isLiveEnabled } from './helpers/cli.js'

async function closeWithEvidence(
  name: string,
  p: Awaited<ReturnType<typeof startLivePty>>
): Promise<void> {
  let closeFailure: { error: unknown } | undefined
  try {
    await p.close()
  } catch (error) {
    closeFailure = { error }
  }
  const dir = process.env.E2E_EVIDENCE_DIR
  if (dir) {
    const evidence = JSON.stringify(
      {
        name,
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        requests: p.requests,
        responses: p.responses,
        output: p.session.output,
      },
      null,
      2
    )
    if (process.env.ANTHROPIC_API_KEY && evidence.includes(process.env.ANTHROPIC_API_KEY))
      throw new Error('Credential appeared in evidence; refusing to save')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, name + '.json.gz'), gzipSync(evidence))
  }
  if (closeFailure) throw closeFailure.error
}

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )
async function idle(p: Awaited<ReturnType<typeof startLivePty>>, from: number): Promise<void> {
  await p.session.waitFor('你: ', from)
}
async function type(p: Awaited<ReturnType<typeof startLivePty>>, input: string): Promise<number> {
  const from = p.session.output.length
  p.session.write(input + '\r')
  return from
}

/** Permit one real conversational confirmation, never substitute prose for host approval. */
async function awaitApproval(
  p: Awaited<ReturnType<typeof startLivePty>>,
  from: number,
  confirmation: string
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect
      .poll(
        () => {
          const tail = p.session.output.slice(from)
          return tail.includes('[y/N]') || tail.includes('zero2agent · 已完成')
        },
        { timeout: 75_000 }
      )
      .toBe(true)
    if (p.session.output.slice(from).includes('[y/N]')) return
    if (attempt === 0) from = await type(p, confirmation)
  }
  throw new Error('Model did not request the real tool approval after one confirmation')
}

describe.skipIf(!isLiveEnabled())('E03-S003 real provider through production TUI and PTY', () => {
  it('reads a real file, renders the answer and starts a fresh conversation', async () => {
    const p = await startLivePty(
      { 'source.txt': 'RUNTIME_LIVE_FILE_731 中文\n' },
      {},
      { ui: 'tui' }
    )
    try {
      await idle(p, 0)
      const from = await type(
        p,
        'Use only read_file to read source.txt. Report its exact content. Do not call any other tool.'
      )
      await p.session.waitFor('RUNTIME_LIVE_FILE_731', from)
      await idle(p, p.session.output.indexOf('RUNTIME_LIVE_FILE_731', from))
      expect(
        p.requests.some(r =>
          r.messages.some(
            m =>
              Array.isArray(m.content) &&
              m.content.some(
                b => b.type === 'tool_result' && String(b.content).includes('RUNTIME_LIVE_FILE_731')
              )
          )
        )
      ).toBe(true)
      const count = p.requests.length
      const reset = await type(p, '/new')
      await p.session.waitFor('已开始新对话', reset)
      expect(p.requests.length).toBe(count)
      expect(p.session.output).toContain('\x1b[?1049h')
    } finally {
      await closeWithEvidence('read-and-reset', p)
    }
  })

  it('denies and then approves distinct real write requests', async () => {
    const p = await startLivePty({}, {}, { ui: 'tui' })
    try {
      await idle(p, 0)
      let from = await type(
        p,
        'Call write_file exactly once to create decision.txt containing HELLO_RUNTIME. If denied, stop without retrying or calling other tools.'
      )
      await awaitApproval(
        p,
        from,
        'Confirmed: actually call write_file now to create decision.txt containing HELLO_RUNTIME. This requests the host approval; do not wait for approval in prose.'
      )
      expect(await exists(join(p.cwd, 'decision.txt'))).toBe(false)
      p.session.write('n')
      await idle(p, p.session.output.length)
      expect(await exists(join(p.cwd, 'decision.txt'))).toBe(false)
      from = await type(
        p,
        'The previous decision.txt request remains denied. I now authorize a separate, different request: call write_file exactly once to create approved.txt containing HELLO_RUNTIME. The host will ask me for this new approval. Do not retry decision.txt and do not use other tools.'
      )
      await awaitApproval(
        p,
        from,
        'Confirmed: I authorize the separate approved.txt request now. Actually invoke write_file to create approved.txt containing HELLO_RUNTIME; the previous decision.txt denial remains unchanged. Do not just acknowledge this in prose.'
      )
      p.session.write('y')
      await idle(p, p.session.output.length)
      expect(await exists(join(p.cwd, 'decision.txt'))).toBe(false)
      expect(await readFile(join(p.cwd, 'approved.txt'), 'utf8')).toContain('HELLO_RUNTIME')
      const receipts = p.requests.flatMap(r =>
        r.messages.flatMap(m =>
          Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []
        )
      )
      expect(
        receipts.some(b => b.is_error && String(b.content).includes('Permission denied'))
      ).toBe(true)
      expect(receipts.some(b => !b.is_error && String(b.content).includes('approved.txt'))).toBe(
        true
      )
    } finally {
      await closeWithEvidence('deny-then-approve', p)
    }
  })

  it('cancels a real model-selected foreground terminal and keeps completed evidence', async () => {
    const p = await startLivePty(
      {},
      { PERMISSION_RULES: JSON.stringify([{ tool: 'terminal', action: 'allow' }]) },
      { ui: 'tui' }
    )
    try {
      await idle(p, 0)
      let from = await type(
        p,
        'This is a real filesystem integration check. You MUST invoke the terminal tool now; a prose answer or simulated execution is not sufficient. Pass this exact command string: "printf started > ready.txt; sleep 30; printf late > late.txt". Use foreground execution with interactive=false in the current workspace. I authorize the temporary files and the 30-second wait; no further confirmation is needed. Invoke no other tools. Wait for the real tool result before describing the outcome.'
      )
      // A real model may ask for confirmation before invoking the tool. Answer once,
      // through the same public UI; execution/file/cancellation assertions stay mandatory.
      await expect
        .poll(
          async () =>
            (await exists(join(p.cwd, 'ready.txt'))) ||
            p.session.output.slice(from).includes('zero2agent · 已完成'),
          { timeout: 75_000 }
        )
        .toBe(true)
      if (!(await exists(join(p.cwd, 'ready.txt')))) {
        from = await type(
          p,
          'Confirmed: run exactly that command once with terminal, interactive=false, in the current workspace. I authorize creating ready.txt and late.txt and the 30-second wait. Please invoke the real tool now.'
        )
      }
      await expect.poll(() => exists(join(p.cwd, 'ready.txt')), { timeout: 75_000 }).toBe(true)
      const count = p.requests.length
      p.session.write('\x03')
      await p.session.waitFor('本轮已取消', from)
      await idle(p, p.session.output.indexOf('本轮已取消', from))
      expect(await exists(join(p.cwd, 'late.txt'))).toBe(false)
      expect(p.requests.length).toBe(count)
      const next = await type(p, 'Reply only READY_TO_CONTINUE without using tools.')
      await p.session.waitFor('Agent › READY_TO_CONTINUE', next)
      await idle(p, p.session.output.indexOf('Agent › READY_TO_CONTINUE', next))
      const messages = JSON.stringify(p.requests.at(-1)?.messages)
      expect(messages).toContain('cancelled')
      expect(await readFile(join(p.cwd, 'ready.txt'), 'utf8')).toBe('started')
    } finally {
      await closeWithEvidence('cancel-and-continue', p)
    }
  })
})
