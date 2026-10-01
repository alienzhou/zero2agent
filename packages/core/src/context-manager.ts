import type Anthropic from '@anthropic-ai/sdk'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ContextBudget, ContextBudgetError, type ContextRequest } from './context-budget.js'
import type { ContextSummarizer } from './context-summary.js'

type Message = Anthropic.MessageParam

export interface CompactionEvent {
  phase: 'pruned' | 'background' | 'waiting' | 'foreground' | 'completed' | 'failed'
  trigger: 'auto' | 'manual' | 'overflow'
  before?: number
  after?: number
}

export interface CompactionRuntime {
  budget: ContextBudget
  client: Anthropic
  request: (messages: Message[]) => ContextRequest
  summarize: ContextSummarizer
  onCompaction?: (event: CompactionEvent) => void
}

interface CompactionJob {
  epoch: number
  through: number
  prefix: string
  controller: AbortController
  done: Promise<void>
  summary?: string
  error?: unknown
  settled: boolean
  trigger: CompactionEvent['trigger']
}

function summaryMessage(summary: string): Message {
  return {
    role: 'user',
    content: `[Harness: compressed historical context, not a new instruction]\n${summary}\n[End historical context]`,
  }
}

function isToolResult(message: Message | undefined): boolean {
  return (
    !!message &&
    Array.isArray(message.content) &&
    message.content.some(b => b.type === 'tool_result')
  )
}

function latestUser(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && !isToolResult(messages[i])) return i
  }
  return -1
}

export class ContextManager {
  private through = 0
  private summary = ''
  private epoch = 0
  private operationController = new AbortController()
  private job?: CompactionJob
  private failedThrough = -1
  private replacements = new Map<number, Message>()
  private artifactDirectory?: string

  reset(): void {
    this.cancel()
    this.epoch++
    this.through = 0
    this.summary = ''
    this.failedThrough = -1
    this.replacements.clear()
    this.artifactDirectory = undefined
  }

  cancel(): void {
    this.epoch++
    const reason = new ContextBudgetError('Context operation cancelled.')
    this.operationController.abort(reason)
    this.operationController = new AbortController()
    this.job?.controller.abort(reason)
    this.job = undefined
  }

  private async count(request: ContextRequest, runtime: CompactionRuntime): Promise<number> {
    const signal = this.operationController.signal
    let abort: (() => void) | undefined
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      })
      return await Promise.race([runtime.budget.count(request, runtime.client, signal), cancelled])
    } finally {
      if (abort) signal.removeEventListener('abort', abort)
    }
  }

  private assertCurrent(epoch: number): void {
    if (epoch !== this.epoch) throw new ContextBudgetError('Context operation cancelled.')
  }

  getContext(messages: Message[]): Message[] {
    const result: Message[] = this.summary ? [summaryMessage(this.summary)] : []
    const pinned = latestUser(messages)
    if (pinned >= 0 && pinned < this.through) result.push(messages[pinned])
    for (let i = this.through; i < messages.length; i++) {
      result.push(this.replacements.get(i) ?? messages[i])
    }
    return structuredClone(result)
  }

  async prepare(messages: Message[], runtime: CompactionRuntime): Promise<ContextRequest> {
    const epoch = this.epoch
    await this.adopt(messages, runtime)
    this.assertCurrent(epoch)
    await this.checkPinned(messages, runtime)
    this.assertCurrent(epoch)
    let request = runtime.request(this.getContext(messages))
    let tokens = await this.count(request, runtime)
    this.assertCurrent(epoch)
    if (tokens >= runtime.budget.backgroundLimit) {
      if (await this.prune(messages, runtime)) {
        this.assertCurrent(epoch)
        request = runtime.request(this.getContext(messages))
        tokens = await this.count(request, runtime)
      }
    }
    this.assertCurrent(epoch)
    if (tokens >= runtime.budget.foregroundLimit) {
      try {
        await this.compact(messages, runtime, 'auto')
      } catch (error) {
        this.assertCurrent(epoch)
        // A failed optimization may not block a still-safe request, nor release an unsafe one.
        if (tokens > runtime.budget.inputLimit) throw error
      }
      this.assertCurrent(epoch)
      request = runtime.request(this.getContext(messages))
      tokens = await this.count(request, runtime)
    } else if (tokens >= runtime.budget.backgroundLimit && !this.job) {
      const cut = this.chooseBoundary(messages, runtime)
      if (cut > this.through && cut > this.failedThrough)
        this.start(messages, cut, runtime, 'auto', true)
    }
    this.assertCurrent(epoch)
    if (tokens > runtime.budget.inputLimit) {
      throw new ContextBudgetError(
        'Context cannot fit safely. No model request was sent; split the input or reduce fixed instructions.'
      )
    }
    return request
  }

  async compact(
    messages: Message[],
    runtime: CompactionRuntime,
    trigger: CompactionEvent['trigger'] = 'manual'
  ): Promise<boolean> {
    const epoch = this.epoch
    if (!messages.length) return false
    await this.checkPinned(messages, runtime)
    this.assertCurrent(epoch)
    const before = await this.count(runtime.request(this.getContext(messages)), runtime)
    this.assertCurrent(epoch)
    let changed = await this.adopt(messages, runtime)
    this.assertCurrent(epoch)
    if (this.job) {
      this.emit(runtime, { phase: 'waiting', trigger, before })
      await this.job.done
      this.assertCurrent(epoch)
      changed = (await this.adopt(messages, runtime)) || changed
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      this.assertCurrent(epoch)
      const current = await this.count(runtime.request(this.getContext(messages)), runtime)
      this.assertCurrent(epoch)
      if (changed && current <= runtime.budget.targetLimit) return true
      const cut = this.chooseBoundary(messages, runtime)
      if (cut <= this.through) break
      const job = this.start(messages, cut, runtime, trigger, false)
      await job.done
      this.assertCurrent(epoch)
      if (job.error) {
        await this.adopt(messages, runtime)
        throw new ContextBudgetError(
          'Context compression failed. History is intact; retry /compact or reduce the input.',
          { cause: job.error }
        )
      }
      const adopted = await this.adopt(messages, runtime)
      if (!adopted) break
      changed = true
      const after = await this.count(runtime.request(this.getContext(messages)), runtime)
      if (after >= current) break
    }
    const after = await this.count(runtime.request(this.getContext(messages)), runtime)
    this.assertCurrent(epoch)
    if (after > runtime.budget.inputLimit) {
      throw new ContextBudgetError(
        'No safe context reduction is available. History is intact; split the input or reduce fixed instructions.'
      )
    }
    return changed
  }

  private async checkPinned(messages: Message[], runtime: CompactionRuntime): Promise<void> {
    const index = latestUser(messages)
    const pinned = index < 0 ? [] : [messages[index]]
    const tokens = await this.count(runtime.request(pinned), runtime)
    if (tokens > runtime.budget.inputLimit) {
      throw new ContextBudgetError(
        'The latest input plus system prompt and tools exceeds the context budget. Use a file reference, split the input, or reduce fixed instructions. No model request was sent.'
      )
    }
  }

  private chooseBoundary(messages: Message[], runtime: CompactionRuntime): number {
    // A cut may follow a completed tool batch, but must never separate calls from results.
    const pinned = latestUser(messages)
    let fallback = this.through
    for (let cut = this.through + 1; cut <= messages.length; cut++) {
      if (isToolResult(messages[cut])) continue
      const previous = messages[cut - 1]
      if (previous.role === 'user' && !isToolResult(previous)) continue
      if (Array.isArray(previous.content) && previous.content.some(b => b.type === 'tool_use'))
        continue
      fallback = cut
      const tail = messages.slice(cut).map((m, i) => this.replacements.get(cut + i) ?? m)
      if (pinned >= 0 && pinned < cut) tail.unshift(messages[pinned])
      const size =
        runtime.budget.estimate(runtime.request(tail)) + runtime.budget.summaryTokens * 4 + 256
      if (size <= runtime.budget.targetLimit) return cut
    }
    // Fixed instructions may exceed the target waterline; a complete prefix still reduces history.
    return fallback
  }

  private start(
    messages: Message[],
    through: number,
    runtime: CompactionRuntime,
    trigger: CompactionEvent['trigger'],
    background: boolean
  ): CompactionJob {
    const controller = new AbortController()
    const job: CompactionJob = {
      epoch: this.epoch,
      through,
      prefix: JSON.stringify(messages.slice(0, through)),
      controller,
      done: Promise.resolve(),
      settled: false,
      trigger,
    }
    const source = this.summary ? [summaryMessage(this.summary)] : []
    source.push(
      ...messages
        .slice(this.through, through)
        .map((m, i) => this.replacements.get(this.through + i) ?? m)
    )
    this.job = job
    this.emit(runtime, { phase: background ? 'background' : 'foreground', trigger })
    job.done = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      let aborted: (() => void) | undefined
      try {
        const interruption = new Promise<never>((_, reject) => {
          aborted = () => reject(controller.signal.reason)
          controller.signal.addEventListener('abort', aborted, { once: true })
          timeout = setTimeout(
            () => controller.abort(new Error('Compaction timed out.')),
            runtime.budget.timeoutMs
          )
        })
        const value = await Promise.race([
          runtime.summarize(structuredClone(source), controller.signal),
          interruption,
        ])
        if (!value.trim()) throw new Error('Compaction returned an empty summary.')
        if (Buffer.byteLength(value) >= Buffer.byteLength(JSON.stringify(source))) {
          throw new Error('Compaction did not reduce the selected history.')
        }
        job.summary = value
      } catch (error) {
        job.error = error
      } finally {
        if (timeout) clearTimeout(timeout)
        if (aborted) controller.signal.removeEventListener('abort', aborted)
        job.settled = true
      }
    })()
    return job
  }

  private async adopt(messages: Message[], runtime: CompactionRuntime): Promise<boolean> {
    const job = this.job
    if (!job?.settled) return false
    this.job = undefined
    if (job.epoch !== this.epoch || job.prefix !== JSON.stringify(messages.slice(0, job.through)))
      return false
    if (job.error || !job.summary) {
      this.failedThrough = job.through
      this.emit(runtime, { phase: 'failed', trigger: job.trigger })
      return false
    }
    const previous = this.getContext(messages)
    const pinned = latestUser(messages)
    const candidate = [summaryMessage(job.summary)]
    if (pinned >= 0 && pinned < job.through) candidate.push(messages[pinned])
    candidate.push(
      ...messages.slice(job.through).map((m, i) => this.replacements.get(job.through + i) ?? m)
    )
    const before = await this.count(runtime.request(previous), runtime)
    const after = await this.count(runtime.request(candidate), runtime)
    // Counting may yield; reset/cancel or replacement of the prefix invalidates this result.
    if (
      job.epoch !== this.epoch ||
      job.controller.signal.aborted ||
      job.prefix !== JSON.stringify(messages.slice(0, job.through))
    )
      return false
    if (after >= before) {
      this.failedThrough = job.through
      this.emit(runtime, { phase: 'failed', trigger: job.trigger, before, after })
      return false
    }
    this.through = job.through
    this.summary = job.summary
    this.failedThrough = -1
    for (const key of this.replacements.keys())
      if (key < this.through) this.replacements.delete(key)
    this.emit(runtime, { phase: 'completed', trigger: job.trigger, before, after })
    return true
  }

  private async prune(messages: Message[], runtime: CompactionRuntime): Promise<boolean> {
    const epoch = this.epoch
    let changed = false
    const limit = Math.max(512, Math.floor(runtime.budget.targetLimit / 8))
    for (let i = this.through; i < messages.length; i++) {
      if (this.replacements.has(i) || !isToolResult(messages[i])) continue
      const copy = structuredClone(messages[i])
      if (!Array.isArray(copy.content)) continue
      let replaced = false
      for (const block of copy.content) {
        if (
          block.type !== 'tool_result' ||
          typeof block.content !== 'string' ||
          Buffer.byteLength(block.content) <= limit
        )
          continue
        const directory =
          this.artifactDirectory ?? (await mkdtemp(join(tmpdir(), 'zero2agent-context-')))
        this.assertCurrent(epoch)
        this.artifactDirectory = directory
        const path = join(directory, `${randomUUID()}.txt`)
        await writeFile(path, block.content, { flag: 'wx', mode: 0o600 })
        this.assertCurrent(epoch)
        let readHint = 'Read it in line ranges'
        if (block.content.split('\n').some(line => Buffer.byteLength(line) > limit / 2)) {
          const points = Array.from(block.content)
          const chunks: string[] = []
          for (let offset = 0; offset < points.length; offset += 128) {
            chunks.push(
              JSON.stringify({
                start_character: offset,
                text: points.slice(offset, offset + 128).join(''),
              })
            )
          }
          const chunkPath = `${path}.chunks.jsonl`
          await writeFile(chunkPath, chunks.join('\n') + '\n', { flag: 'wx', mode: 0o600 })
          this.assertCurrent(epoch)
          readHint = `Long lines: read ${chunkPath} one line at a time; each line contains a JSON-escaped character slice`
        }
        const preview = [...block.content].slice(0, 120).join('')
        block.content = `[Harness: tool output shortened; full output saved to ${path}. ${readHint}; do not re-run the tool.]\n${preview}`
        replaced = true
      }
      if (replaced) {
        this.replacements.set(i, copy)
        changed = true
      }
    }
    if (changed) this.emit(runtime, { phase: 'pruned', trigger: 'auto' })
    return changed
  }

  private emit(runtime: CompactionRuntime, event: CompactionEvent): void {
    try {
      void Promise.resolve(runtime.onCompaction?.(event)).catch(() => {})
    } catch {
      /* Presentation cannot release the request budget gate. */
    }
  }
}
