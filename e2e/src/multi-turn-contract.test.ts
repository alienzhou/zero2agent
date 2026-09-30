import { createServer, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { CLI_ENTRY, makeTempWorkspace } from './helpers/cli.js'

type Block = { type: string; [key: string]: unknown }
type Message = { role: string; content: string | Block[] }
type Request = { messages: Message[] }

/** A real SSE transport, not an imported Agent mock: exercises the SDK and built CLI. */
function sendReply(res: ServerResponse, blocks: Block[], stopReason = 'end_turn') {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_contract',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'contract-model',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  blocks.forEach((block, index) => {
    const isTool = block.type === 'tool_use'
    event('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: isTool ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: isTool
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { type: 'content_block_stop', index })
  })
  event('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event('message_stop', { type: 'message_stop' })
  res.end()
}

async function exercise(inputs: string[], respond: (res: ServerResponse, index: number) => void) {
  const workspace = await makeTempWorkspace()
  const requests: Request[] = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push(JSON.parse(body) as Request)
      respond(res, requests.length - 1)
    } catch {
      res.writeHead(500).end('Invalid test request')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server port')
  const child = spawn(process.execPath, [CLI_ENTRY], {
    cwd: workspace.dir,
    env: {
      ...process.env,
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      ANTHROPIC_API_KEY: 'contract-placeholder',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      MODEL_NAME: 'contract-model',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let sent = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`CLI did not finish: ${stdout}\n${stderr}`))
      }, 20_000)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        // Send one line only after the next prompt; bulk piped input can be consumed during a turn.
        const prompts = stdout.split('你: ').length - 1
        if (sent < prompts && sent < inputs.length) {
          child.stdin.write(inputs[sent++] + '\n')
          if (sent === inputs.length) child.stdin.end()
        }
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`CLI exit ${code}: ${stderr}`))
      })
    })
    const file = await readFile(`${workspace.dir}/draft.txt`, 'utf8').catch(() => null)
    return { requests, stdout, stderr, file, sent }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
      child.kill('SIGKILL')
      await closed
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await workspace.cleanup()
  }
}

const writeFile = {
  type: 'tool_use',
  id: 'write_1',
  name: 'write_file',
  input: { path: 'draft.txt', content: 'persisted tool effect' },
}

describe('CLI multi-turn contract (local SSE, no live model)', () => {
  it('carries tool history, handles /new locally, and does not undo files', async () => {
    const result = await exercise(
      ['write draft', 'follow up', '/new', 'fresh question', 'exit'],
      (res, index) => {
        if (index === 0) sendReply(res, [writeFile], 'tool_use')
        else sendReply(res, [{ type: 'text', text: `answer-${index}` }])
      }
    )
    expect(result.sent).toBe(5)
    expect(result.requests).toHaveLength(4)
    const followUp = result.requests[2].messages
    expect(followUp).toHaveLength(5)
    expect(followUp[0]).toEqual({ role: 'user', content: 'write draft' })
    expect(followUp[1].content).toEqual([writeFile])
    expect(followUp[2].content).toEqual([
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'write_1' }),
    ])
    expect(followUp[3].content).toEqual([
      expect.objectContaining({ type: 'text', text: 'answer-1' }),
    ])
    expect(followUp[4]).toEqual({ role: 'user', content: 'follow up' })
    expect(result.requests[3].messages).toEqual([{ role: 'user', content: 'fresh question' }])
    expect(result.stdout).toContain('已开始新对话')
    expect(result.file).toBe('persisted tool effect')
    expect(result.stderr).toBe('')
  })

  it('keeps tool evidence after a transport failure and accepts another user turn', async () => {
    const result = await exercise(['write draft', 'recover', 'exit'], (res, index) => {
      if (index === 0) sendReply(res, [writeFile], 'tool_use')
      else if (index === 1) {
        // A non-retryable API error proves the next user prompt, not an SDK retry, resumes the session.
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'contract failure' },
          })
        )
      } else sendReply(res, [{ type: 'text', text: 'recovered' }])
    })
    expect(result.requests).toHaveLength(3)
    const history = result.requests[2].messages
    expect(history).toHaveLength(5)
    expect(history[2].content).toEqual([expect.objectContaining({ tool_use_id: 'write_1' })])
    expect(history[3].content).toContain('[Harness] This turn was interrupted')
    expect(history[4].content).toBe('recover')
    expect(result.file).toBe('persisted tool effect')
    expect(result.stderr).toContain('contract failure')
    expect(result.stdout).toContain('recovered')
  })

  it('allows /new on an empty session without issuing a model request', async () => {
    const result = await exercise(['/new', '/new', 'exit'], res => sendReply(res, []))
    expect(result.requests).toHaveLength(0)
    expect(result.stdout.split('已开始新对话')).toHaveLength(3)
  })
})
