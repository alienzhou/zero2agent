import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export const MCP_IO_LIMITS = {
  messageBytes: 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  requestBytes: 256 * 1024,
}

export class McpRequestNotSentError extends Error {}

/** Standard newline-delimited stdio, with bounds enforced BEFORE JSON parsing. No shell/env inheritance. */
export class BoundedStdioTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  private child?: ChildProcessWithoutNullStreams
  private buffer = Buffer.alloc(0)
  private total = 0
  private ended = false
  private initializingId?: string | number
  private closing?: Promise<void>
  constructor(
    private config: { command: string; args: string[]; cwd: string; env: Record<string, string> }
  ) {}
  get pid(): number | undefined {
    return this.child?.pid
  }
  async start(): Promise<void> {
    if (this.child || this.ended) throw new Error('MCP transport cannot restart')
    this.child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: this.config.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    const child = this.child
    child.stderr.on('data', () => {}) // Drain; never forward server bytes to terminal/logs.
    child.stdin.on('error', error => this.fail(error))
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.ended) return
      this.total += chunk.length
      if (this.total > MCP_IO_LIMITS.totalBytes) {
        this.fail(new Error('MCP connection byte capacity exceeded'))
        return
      }
      this.buffer = Buffer.concat([this.buffer, chunk])
      while (this.buffer.length) {
        const end = this.buffer.indexOf(10)
        if ((end < 0 ? this.buffer.length : end) > MCP_IO_LIMITS.messageBytes) {
          this.fail(new Error('MCP message exceeds 1 MiB'))
          return
        }
        if (end < 0) break
        const line = this.buffer.subarray(0, end)
        this.buffer = this.buffer.subarray(end + 1)
        try {
          const message = JSONRPCMessageSchema.parse(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
          )
          if ('id' in message && !('method' in message) && message.id === this.initializingId)
            this.initializingId = undefined
          this.onmessage?.(message)
        } catch {
          this.fail(new Error('MCP invalid JSON-RPC message'))
          return
        }
      }
    })
    child.on('error', error => this.fail(error))
    child.on('exit', () => {
      this.finish()
      void this.close().catch(error => this.onerror?.(error as Error))
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  }
  setProtocolVersion(version: string): void {
    if (version !== '2025-11-25') throw new Error('MCP requires protocol 2025-11-25')
  }
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child || this.ended) throw new Error('MCP connection is closed')
    // 2025-11-25 forbids cancelling initialize: close its transport instead.
    if (
      'method' in message &&
      message.method === 'notifications/cancelled' &&
      message.params?.requestId === this.initializingId &&
      this.initializingId !== undefined
    ) {
      await this.close()
      return
    }
    if ('method' in message && message.method === 'initialize' && 'id' in message)
      this.initializingId = message.id
    const bytes = Buffer.from(JSON.stringify(message) + '\n')
    if (bytes.length > MCP_IO_LIMITS.requestBytes)
      throw new McpRequestNotSentError('MCP request exceeds 256 KiB; call was not sent')
    await new Promise<void>((resolve, reject) =>
      this.child!.stdin.write(bytes, error => (error ? reject(error) : resolve()))
    )
  }
  private fail(error: Error): void {
    this.onerror?.(error)
    this.finish()
    void this.close().catch(error => this.onerror?.(error as Error))
  }
  private finish(): void {
    if (this.ended) return
    this.ended = true
    this.buffer = Buffer.alloc(0)
    this.onclose?.()
  }
  close(): Promise<void> {
    return (this.closing ??= this.stop())
  }
  private async stop(): Promise<void> {
    this.finish()
    const child = this.child
    if (!child) return
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const wait = (ms: number): Promise<void> =>
      new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve()
          return
        }
        const timer = setTimeout(done, ms)
        function done(): void {
          clearTimeout(timer)
          child!.removeListener('exit', done)
          resolve()
        }
        child.once('exit', done)
      })
    kill('SIGTERM')
    await wait(250)
    kill('SIGKILL')
    await wait(250)
    if (child.pid && child.exitCode === null && child.signalCode === null)
      throw new Error('MCP process did not exit after SIGKILL')
  }
}
