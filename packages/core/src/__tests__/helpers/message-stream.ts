import { vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

/** Complete fixtures emit the same completion evidence required of the actual SDK stream. */
export function messageStream(
  resolve: () => Promise<Anthropic.Message>,
  onText?: (listener: (text: string) => void) => void
) {
  let stopped: ((event: { type: 'message_stop' }) => void) | undefined
  const stream = {
    on: vi.fn((name: string, listener: unknown) => {
      if (name === 'streamEvent') stopped = listener as typeof stopped
      if (name === 'text') onText?.(listener as (text: string) => void)
      return stream
    }),
    finalMessage: vi.fn(async () => {
      const response = await resolve()
      stopped?.({ type: 'message_stop' })
      return response
    }),
  }
  return stream
}
