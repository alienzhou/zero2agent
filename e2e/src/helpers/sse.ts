import type { ServerResponse } from 'node:http'
export type SSEBlock = { type: string; [key: string]: unknown }
export function sendSSEReply(
  res: ServerResponse,
  blocks: SSEBlock[],
  stopReason = 'end_turn'
): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, value: object): boolean =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
  event('message_start', {
    type: 'message_start',
    message: {
      id: 'approval_contract',
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
