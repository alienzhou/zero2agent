import { pathToFileURL } from 'node:url'
import path from 'node:path'
import CDP from 'chrome-remote-interface'
import type {
  BreakpointRecord,
  StackFrameEntry,
  VariableEntry,
} from '../types.js'

/** 最近一次暂停时的调用栈（由 CDP 提供） */
export interface CdpPausedState {
  reason: string
  callFrames: Array<{
    callFrameId: string
    functionName: string
    url: string
    location: { scriptId: string; lineNumber: number; columnNumber: number }
    scopeChain: Array<{
      type: string
      object: { objectId: string }
    }>
  }>
}

/**
 * 封装 chrome-remote-interface：连接、断点、恢复、变量、调用栈
 */
export class CdpDebugClient {
  private client: Awaited<ReturnType<typeof CDP>> | null = null

  private paused = false

  private lastPaused: CdpPausedState | null = null

  private nextBp = 1

  private breakpoints = new Map<string, BreakpointRecord>()

  /** 是否已成功连接 */
  get connected(): boolean {
    return this.client !== null
  }

  get isPaused(): boolean {
    return this.paused
  }

  get lastPauseState(): CdpPausedState | null {
    return this.lastPaused
  }

  get breakpointList(): BreakpointRecord[] {
    return [...this.breakpoints.values()]
  }

  /**
   * 连接到 Node --inspect 端口
   */
  async connect(inspectPort: number): Promise<void> {
    if (this.client) {
      await this.disconnect()
    }
    const client = await CDP({ port: inspectPort, host: '127.0.0.1' })
    this.client = client

    const { Debugger, Runtime } = client

    Debugger.paused((params) => {
      this.paused = true
      this.lastPaused = {
        reason: params.reason,
        callFrames: params.callFrames,
      }
    })

    Debugger.resumed(() => {
      this.paused = false
    })

    await Debugger.enable()
    await Runtime.enable()

    // --inspect-brk：Node 在等 runIfWaitingForDebugger 后才开始执行
    // 调用后 Node 立即命中第一行的断点，触发 Debugger.paused
    await Runtime.runIfWaitingForDebugger()

    // 让事件循环处理可能到达的 Debugger.paused 事件
    await new Promise((r) => setTimeout(r, 200))
  }

  /**
   * 等待直到命中断点暂停（轮询），超时返回 false
   */
  async waitForPause(timeoutMs = 10000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (this.paused) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
    this.paused = false
    this.lastPaused = null
    this.breakpoints.clear()
    this.nextBp = 1
  }

  /**
   * 在绝对路径文件上设置断点（line 为 1-based）
   */
  async setBreakpoint(absFile: string, lineOneBased: number): Promise<BreakpointRecord> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }
    const { Debugger } = this.client
    const url = pathToFileURL(path.resolve(absFile)).href
    const lineNumber = Math.max(0, lineOneBased - 1)

    const result = await Debugger.setBreakpointByUrl({
      url,
      lineNumber,
    })

    const id = `bp-${this.nextBp++}`
    const rec: BreakpointRecord = {
      id,
      cdpId: result.breakpointId,
      file: absFile,
      line: lineOneBased,
    }
    this.breakpoints.set(id, rec)
    return rec
  }

  async removeBreakpoint(id: string): Promise<void> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }
    const rec = this.breakpoints.get(id)
    if (!rec) {
      throw new Error(`Unknown breakpoint id: ${id}`)
    }
    await this.client.Debugger.removeBreakpoint({ breakpointId: rec.cdpId })
    this.breakpoints.delete(id)
  }

  async resume(): Promise<void> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }
    if (!this.paused) {
      return
    }
    await this.client.Debugger.resume()
    this.paused = false
  }

  async pause(): Promise<void> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }
    await this.client.Debugger.pause()
  }

  getCallStack(): StackFrameEntry[] {
    const frames = this.lastPaused?.callFrames ?? []
    return frames.map((f, index) => ({
      index,
      functionName: f.functionName || '(anonymous)',
      url: f.url,
      lineNumber: f.location.lineNumber + 1,
      columnNumber: f.location.columnNumber,
    }))
  }

  /**
   * 读取当前暂停帧的作用域变量（浅层展开）
   */
  async getVariables(depth: number): Promise<VariableEntry[]> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }
    if (!this.paused || !this.lastPaused?.callFrames.length) {
      throw new Error('Not paused at a breakpoint; cannot read variables')
    }

    const { Runtime } = this.client
    const frame = this.lastPaused.callFrames[0]
    const scopes = frame.scopeChain.slice(0, Math.max(1, depth))
    const out: VariableEntry[] = []

    for (const scope of scopes) {
      const props = await Runtime.getProperties({
        objectId: scope.object.objectId,
        ownProperties: true,
        generatePreview: true,
      })

      for (const p of props.result) {
        if (!p.enumerable && p.name !== 'this') {
          continue
        }
        const v = p.value
        let valueStr = ''
        let typeStr: string | undefined
        if (v) {
          typeStr = v.type
          if (v.value !== undefined) {
            valueStr = JSON.stringify(v.value)
          } else if (v.description) {
            valueStr = v.description
          } else {
            valueStr = v.type
          }
        }
        out.push({
          name: `${scope.type}.${p.name}`,
          value: valueStr,
          type: typeStr,
        })
      }
    }

    return out
  }

  /**
   * 求值：暂停时在当前栈帧上下文执行，否则在全局执行
   */
  async evaluate(expression: string): Promise<string> {
    if (!this.client) {
      throw new Error('CDP not connected')
    }

    let r: {
      result: { type: string; value?: unknown; description?: string; objectId?: string }
      exceptionDetails?: unknown
    }

    if (this.paused && this.lastPaused?.callFrames.length) {
      const frameId = this.lastPaused.callFrames[0].callFrameId
      r = await this.client.Debugger.evaluateOnCallFrame({
        callFrameId: frameId,
        expression,
        returnByValue: true,
      })
    } else {
      r = await this.client.Runtime.evaluate({
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    }

    if (r.exceptionDetails) {
      throw new Error(`Evaluate failed: ${JSON.stringify(r.exceptionDetails)}`)
    }
    const res = r.result
    if (res.value !== undefined) {
      return JSON.stringify(res.value)
    }
    if (res.description) {
      return res.description
    }
    return res.type
  }
}
