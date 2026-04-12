/**
 * 会话文件（.cdp-debug.json）内容
 */
export interface CdpDebugSessionFile {
  /** HTTP Server 进程 PID */
  pid: number
  /** HTTP API 端口 */
  serverPort: number
  /** Node --inspect 调试端口 */
  inspectPort: number
  /** 工作目录（绝对路径） */
  cwd: string
  /** start 模式下的入口脚本，connect 模式可为空 */
  targetEntry?: string
  /** ISO 8601 */
  startedAt: string
  /** connect 模式为 true 时未 spawn 子进程 */
  connectOnly?: boolean
}

/**
 * 断点记录（内存 + 对外 id）
 */
export interface BreakpointRecord {
  /** 对外暴露的 id，如 bp-1 */
  id: string
  /** CDP 返回的 breakpointId */
  cdpId: string
  file: string
  line: number
}

export interface BreakpointSetRequest {
  file: string
  /** 1-based line number（与用户输入一致） */
  line: number
}

export interface EvaluateRequest {
  expression: string
}

export interface ConnectRequest {
  /** 已有 inspect 进程端口 */
  port: number
}

export interface StatusResponse {
  connected: boolean
  paused: boolean
  reason?: string
  inspectPort: number
  childPid?: number
}

export interface VariableEntry {
  name: string
  value: string
  type?: string
}

export interface StackFrameEntry {
  index: number
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
