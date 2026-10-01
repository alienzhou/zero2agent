import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { ContextBudget, ContextBudgetError, type ContextRequest } from '../context-budget.js'

const model = 'claude-sonnet-4-20250514'
const request: ContextRequest = {
  model,
  max_tokens: 4096,
  messages: [{ role: 'user', content: '你好 🧪' }],
}

describe('ContextBudget validation and accounting', () => {
  it('reserves output and safety and exposes ordered thresholds', () => {
    const budget = new ContextBudget(model)
    expect(budget.inputLimit).toBe(200_000 - 4096 - 1024)
    expect(budget.targetLimit).toBeLessThan(budget.backgroundLimit)
    expect(budget.backgroundLimit).toBeLessThan(budget.foregroundLimit)
    expect(budget.foregroundLimit).toBeLessThan(budget.inputLimit)
  })

  it('requires a window for an unknown or loosely matched model', () => {
    expect(() => new ContextBudget('claude-sonnet-4-latest')).toThrow(/contextWindow/)
    expect(new ContextBudget('custom', { contextWindow: 8192 }).inputLimit).toBeGreaterThan(0)
  })

  it.each([
    { contextWindow: Infinity },
    { contextWindow: 100 },
    { maxInputTokens: 0 },
    { maxInputTokens: 200_000 },
    { maxOutputTokens: -1 },
    { safetyTokens: -1 },
    { targetRatio: 0 },
    { targetRatio: 0.7 },
    { backgroundRatio: 0.9 },
    { foregroundRatio: 1 },
    { foregroundRatio: NaN },
    { summaryTokens: 127 },
    { timeoutMs: Infinity },
    { timeoutMs: 2_147_483_648 },
  ])('rejects impossible or invalid options: %j', options => {
    expect(() => new ContextBudget(model, options)).toThrow(ContextBudgetError)
  })

  it('counts full UTF-8 JSON, schemas, system and all messages conservatively', async () => {
    const budget = new ContextBudget(model)
    const full = {
      ...request,
      system: 'system policy',
      tools: [
        {
          name: 'read',
          description: 'schema description',
          input_schema: { type: 'object' as const },
        },
      ],
      messages: [...request.messages, { role: 'assistant' as const, content: 'previous result' }],
    }
    expect(budget.estimate(full)).toBe(
      Buffer.byteLength(JSON.stringify(full), 'utf8') + 256 + 64 + 64
    )
    expect(budget.estimate(full)).toBeGreaterThan(budget.estimate(request))
    expect(await budget.count(full, {} as Anthropic)).toBe(budget.estimate(full))
  })

  it.each(['image', 'document'])('rejects unsupported %s even nested in tool results', type => {
    const messages = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type }] }] },
    ]
    expect(() =>
      new ContextBudget(model).estimate({
        ...request,
        messages: messages as Anthropic.MessageParam[],
      })
    ).toThrow(/does not support/)
  })
})

describe('provider counting and tightening', () => {
  it('uses countTokens without output fields, with timeout and no SDK retries', async () => {
    const countTokens = vi.fn().mockResolvedValue({ input_tokens: 73 })
    const client = { messages: { countTokens } } as unknown as Anthropic
    const budget = new ContextBudget(model, { counting: 'provider', timeoutMs: 100 })
    expect(await budget.count(request, client)).toBe(73)
    expect(countTokens).toHaveBeenCalledWith(
      { model, messages: request.messages },
      { maxRetries: 0, timeout: 100, signal: expect.any(AbortSignal) }
    )
  })

  it.each([NaN, Infinity, -1, 1.5, undefined])(
    'rejects invalid provider counts: %s',
    async input_tokens => {
      const client = {
        messages: { countTokens: vi.fn().mockResolvedValue({ input_tokens }) },
      } as unknown as Anthropic
      await expect(
        new ContextBudget(model, { counting: 'provider' }).count(request, client)
      ).rejects.toThrow(/unsafe fallback/)
    }
  )

  it('never falls back after provider failure and propagates cancellation', async () => {
    const countTokens = vi.fn().mockRejectedValue(new Error('unavailable'))
    const client = { messages: { countTokens } } as unknown as Anthropic
    const budget = new ContextBudget(model, { counting: 'provider' })
    await expect(budget.count(request, client)).rejects.toThrow(/unsafe fallback/)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(budget.count(request, client, controller.signal)).rejects.toThrow('cancelled')
    expect(countTokens).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight provider count with the parent signal', async () => {
    const controller = new AbortController()
    const countTokens = vi.fn(
      (_request, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        controller.abort(new Error('parent cancelled counting'))
      })
    )
    const client = { messages: { countTokens } } as unknown as Anthropic
    const budget = new ContextBudget(model, { counting: 'provider', timeoutMs: 100 })
    await expect(budget.count(request, client, controller.signal)).rejects.toThrow('parent cancelled counting')
    expect(countTokens).toHaveBeenCalledTimes(1)
  })

  it('cancels a provider count when its finite timeout expires', async () => {
    const countTokens = vi.fn(
      (_request, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          })
        })
    )
    const client = { messages: { countTokens } } as unknown as Anthropic
    const budget = new ContextBudget(model, { counting: 'provider', timeoutMs: 10 })
    await expect(budget.count(request, client)).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('tightens all thresholds and fails without mutation when capacity is exhausted', () => {
    const budget = new ContextBudget(model)
    const original = budget.inputLimit
    budget.tighten()
    expect(budget.inputLimit).toBe(Math.floor(original * 0.8))
    expect(budget.targetLimit).toBe(Math.floor(budget.inputLimit * 0.45))
    let previous = budget.inputLimit
    expect(() => {
      for (let i = 0; i < 100; i++) {
        previous = budget.inputLimit
        budget.tighten()
      }
    }).toThrow(/too small/)
    expect(budget.inputLimit).toBe(previous)
    expect(budget.foregroundLimit).toBeGreaterThan(0)
  })
})
