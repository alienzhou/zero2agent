import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { extractTextContent, executeToolCalls, runLoop } from '../loop.js'
import type { Tool } from '../tools/types.js'

// ---- extractTextContent ----

describe('extractTextContent', () => {
  it('从 content 数组中提取文本', () => {
    const content: Anthropic.ContentBlock[] = [
      { type: 'text', text: 'Hello', citations: null },
      { type: 'text', text: 'World', citations: null },
    ]
    expect(extractTextContent(content)).toBe('Hello\nWorld')
  })

  it('跳过非文本 block', () => {
    const content: Anthropic.ContentBlock[] = [
      { type: 'text', text: 'answer', citations: null },
      { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} },
    ]
    expect(extractTextContent(content)).toBe('answer')
  })

  it('空数组返回空字符串', () => {
    expect(extractTextContent([])).toBe('')
  })
})

// ---- executeToolCalls ----

describe('executeToolCalls', () => {
  const mockTool: Tool = {
    name: 'echo',
    description: 'echo tool',
    input_schema: { type: 'object', properties: {} },
    execute: async (input) => `echoed: ${(input as { msg: string }).msg}`,
  }

  it('执行匹配的工具并返回结果', async () => {
    const content: Anthropic.ContentBlock[] = [
      { type: 'tool_use', id: 'call_1', name: 'echo', input: { msg: 'hi' } },
    ]
    const results = await executeToolCalls(content, [mockTool])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'echoed: hi',
    })
  })

  it('未知工具返回错误', async () => {
    const content: Anthropic.ContentBlock[] = [
      { type: 'tool_use', id: 'call_2', name: 'unknown', input: {} },
    ]
    const results = await executeToolCalls(content, [mockTool])
    expect(results[0].content).toMatch(/Unknown tool/)
  })

  it('工具抛出异常时捕获并返回错误', async () => {
    const failTool: Tool = {
      name: 'fail',
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => { throw new Error('boom') },
    }
    const content: Anthropic.ContentBlock[] = [
      { type: 'tool_use', id: 'call_3', name: 'fail', input: {} },
    ]
    const results = await executeToolCalls(content, [failTool])
    expect(results[0].content).toMatch(/Error:.*boom/)
  })

  it('跳过非 tool_use 类型的 block', async () => {
    const content: Anthropic.ContentBlock[] = [
      { type: 'text', text: 'thinking...', citations: null },
    ]
    const results = await executeToolCalls(content, [mockTool])
    expect(results).toHaveLength(0)
  })

  it('触发 events 回调', async () => {
    const onToolStart = vi.fn()
    const onToolEnd = vi.fn()
    const content: Anthropic.ContentBlock[] = [
      { type: 'tool_use', id: 'call_4', name: 'echo', input: { msg: 'hi' } },
    ]
    await executeToolCalls(content, [mockTool], { onToolStart, onToolEnd })
    expect(onToolStart).toHaveBeenCalledWith('echo', { msg: 'hi' })
    expect(onToolEnd).toHaveBeenCalledWith('echo', 'echoed: hi', expect.any(Number))
  })

  it('工具出错时触发 onToolError', async () => {
    const onToolError = vi.fn()
    const failTool: Tool = {
      name: 'fail',
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => { throw new Error('boom') },
    }
    const content: Anthropic.ContentBlock[] = [
      { type: 'tool_use', id: 'call_5', name: 'fail', input: {} },
    ]
    await executeToolCalls(content, [failTool], { onToolError })
    expect(onToolError).toHaveBeenCalledWith('fail', expect.stringContaining('boom'))
  })
})

// ---- runLoop ----

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: vi.fn(() => 'mock-model'),
}))

import { createAnthropicClient } from '../llm/index.js'
const mockCreate = vi.mocked(createAnthropicClient)

/**
 * 构建 mock 流对象，模拟 client.messages.stream() 的返回值
 */
function buildMockStream(response: Anthropic.Message) {
  return {
    on: vi.fn(function (this: unknown) { return this }),
    finalMessage: vi.fn(async () => response),
  }
}

function buildMockClient(responses: Anthropic.Message[]) {
  let callIdx = 0
  return {
    messages: {
      stream: vi.fn(() => {
        const resp = responses[callIdx]
        callIdx++
        return buildMockStream(resp)
      }),
    },
  } as unknown as Anthropic
}

function makeEndTurnResponse(text: string): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'mock-model',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
    content: [{ type: 'text', text, citations: null }],
  }
}

function makeToolUseResponse(toolName: string, toolInput: Record<string, unknown>): Anthropic.Message {
  return {
    id: 'msg_2',
    type: 'message',
    role: 'assistant',
    model: 'mock-model',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
    content: [
      { type: 'text', text: 'Let me check...', citations: null },
      { type: 'tool_use', id: 'toolu_1', name: toolName, input: toolInput },
    ],
  }
}

function makeMaxTokensResponse(text: string): Anthropic.Message {
  return {
    id: 'msg_3',
    type: 'message',
    role: 'assistant',
    model: 'mock-model',
    stop_reason: 'max_tokens',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 4096, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
    content: [{ type: 'text', text, citations: null }],
  }
}

describe('runLoop', () => {
  it('模型直接 end_turn 时返回文本', async () => {
    const client = buildMockClient([makeEndTurnResponse('done')])
    mockCreate.mockReturnValue(client)

    const result = await runLoop('hello', { tools: [] })
    expect(result).toBe('done')
  })

  it('模型先调用工具再 end_turn，完成两轮循环', async () => {
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      input_schema: { type: 'object', properties: {} },
      execute: async () => 'tool-output',
    }

    const client = buildMockClient([
      makeToolUseResponse('echo', {}),
      makeEndTurnResponse('final answer'),
    ])
    mockCreate.mockReturnValue(client)

    const result = await runLoop('do something', { tools: [echoTool] })
    expect(result).toBe('final answer')
    expect(client.messages.stream).toHaveBeenCalledTimes(2)
  })

  it('max_tokens 时返回已有文本', async () => {
    const client = buildMockClient([makeMaxTokensResponse('partial...')])
    mockCreate.mockReturnValue(client)

    const result = await runLoop('long question', { tools: [] })
    expect(result).toBe('partial...')
  })

  it('达到最大迭代次数时返回错误信息', async () => {
    const noop: Tool = {
      name: 'noop',
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => '',
    }

    const infiniteResponses = Array.from({ length: 21 }, () =>
      makeToolUseResponse('noop', {})
    )
    const client = buildMockClient(infiniteResponses)
    mockCreate.mockReturnValue(client)

    const result = await runLoop('loop forever', { tools: [noop] })
    expect(result).toMatch(/Maximum iterations/)
  })

  it('events.onText 通过 stream.on("text") 注册', async () => {
    const client = buildMockClient([makeEndTurnResponse('hello')])
    mockCreate.mockReturnValue(client)

    const onText = vi.fn()
    await runLoop('hi', { tools: [], events: { onText } })

    // 验证 stream.on('text', ...) 被调用
    const streamInstance = (client.messages.stream as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(streamInstance.on).toHaveBeenCalledWith('text', expect.any(Function))
  })
})
