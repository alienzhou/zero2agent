import { describe, it, expect } from 'vitest'
import { toAnthropicTool, type Tool } from '../types.js'

describe('toAnthropicTool', () => {
  it('正确转换 Tool 为 Anthropic API 格式（不包含 execute）', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      input_schema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
      },
      execute: async () => 'ok',
    }

    const result = toAnthropicTool(tool)

    expect(result).toEqual({
      name: 'test_tool',
      description: 'A test tool',
      input_schema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
      },
    })
    expect(result).not.toHaveProperty('execute')
  })
})
