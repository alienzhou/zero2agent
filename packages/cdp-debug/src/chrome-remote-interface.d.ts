/**
 * chrome-remote-interface 无官方类型，最小声明供 TS 编译通过
 */
declare module 'chrome-remote-interface' {
  interface CDPConnectOptions {
    port?: number
    host?: string
    target?: string
    local?: boolean
  }

  interface CDPClient {
    close(): Promise<void>
    Debugger: {
      enable(): Promise<void>
      setBreakpointByUrl(params: {
        lineNumber: number
        url?: string
        urlRegex?: string
        columnNumber?: number
        condition?: string
      }): Promise<{ breakpointId: string }>
      removeBreakpoint(params: { breakpointId: string }): Promise<void>
      resume(): Promise<void>
      pause(): Promise<void>
      paused(
        cb: (params: {
          callFrames: CdpCallFrame[]
          reason: string
          hitBreakpoints?: string[]
        }) => void
      ): void
      resumed(cb: () => void): void
    }
    Runtime: {
      enable(): Promise<void>
      getProperties(params: {
        objectId: string
        ownProperties?: boolean
        generatePreview?: boolean
      }): Promise<{
        result: Array<{
          name: string
          value?: { type: string; value?: unknown; description?: string; objectId?: string }
          enumerable?: boolean
        }>
      }>
      evaluate(params: {
        expression: string
        awaitPromise?: boolean
        returnByValue?: boolean
      }): Promise<{
        result: { type: string; value?: unknown; description?: string; objectId?: string }
        exceptionDetails?: unknown
      }>
    }
  }

  interface CdpCallFrame {
    functionName: string
    url: string
    lineNumber: number
    columnNumber: number
    scopeChain: Array<{
      type: string
      object: { objectId: string }
    }>
  }

  function CDP(options?: CDPConnectOptions): Promise<CDPClient>
  export default CDP
}
