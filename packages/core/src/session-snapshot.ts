import type Anthropic from '@anthropic-ai/sdk'

/** Durable data only. Pending jobs, budgets and temporary pruning artifacts are rebuilt. */
export interface SessionSnapshot {
  messages: Anthropic.MessageParam[]
  context: { through: number; summary: string }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(): never {
  throw new Error(
    'Invalid session snapshot: unsupported content, broken tool pairing or summary boundary.'
  )
}

/** Validate the full candidate before replacing any live state. No tools are executed here. */
export function validateSessionSnapshot(value: unknown): SessionSnapshot {
  if (!object(value) || !Array.isArray(value.messages) || !object(value.context)) fail()
  const { through, summary } = value.context
  if (
    !Number.isSafeInteger(through) ||
    typeof through !== 'number' ||
    through < 0 ||
    through > value.messages.length ||
    typeof summary !== 'string' ||
    (through === 0 ? summary !== '' : !summary.trim())
  )
    fail()
  const pending = new Set<string>()
  for (let i = 0; i < value.messages.length; i++) {
    if (i === through && pending.size) fail()
    const message: unknown = value.messages[i]
    if (!object(message) || !['user', 'assistant'].includes(String(message.role))) fail()
    if (typeof message.content === 'string') {
      if (!message.content.trim() || pending.size) fail()
      continue
    }
    if (!Array.isArray(message.content) || !message.content.length) fail()
    const expecting = new Set(pending)
    if (expecting.size && message.role !== 'user') fail()
    for (const block of message.content) {
      if (!object(block)) fail()
      switch (block.type) {
        case 'text':
          if (typeof block.text !== 'string') fail()
          break
        case 'thinking':
          if (
            message.role !== 'assistant' ||
            typeof block.thinking !== 'string' ||
            typeof block.signature !== 'string'
          )
            fail()
          break
        case 'redacted_thinking':
          if (message.role !== 'assistant' || typeof block.data !== 'string') fail()
          break
        case 'tool_use':
          if (
            message.role !== 'assistant' ||
            typeof block.id !== 'string' ||
            !block.id ||
            pending.has(block.id) ||
            typeof block.name !== 'string' ||
            !block.name ||
            !object(block.input)
          )
            fail()
          pending.add(block.id)
          break
        case 'tool_result':
          if (
            message.role !== 'user' ||
            typeof block.tool_use_id !== 'string' ||
            !pending.delete(block.tool_use_id) ||
            !expecting.has(block.tool_use_id)
          )
            fail()
          if (block.is_error !== undefined && typeof block.is_error !== 'boolean') fail()
          if (
            typeof block.content !== 'string' &&
            !(
              Array.isArray(block.content) &&
              block.content.every(b => object(b) && b.type === 'text' && typeof b.text === 'string')
            )
          )
            fail()
          break
        default:
          fail()
      }
    }
    if (expecting.size && pending.size) fail()
  }
  if (pending.size) fail()
  return structuredClone({
    messages: value.messages,
    context: { through, summary },
  }) as SessionSnapshot
}
