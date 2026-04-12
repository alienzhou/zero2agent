import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import path from 'node:path'
import type { CdpDebugClient } from './cdp-client.js'
import type {
  BreakpointSetRequest,
  EvaluateRequest,
  StatusResponse,
} from '../types.js'

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export interface RouteContext {
  /** 项目根目录，用于解析相对路径断点 */
  projectCwd: string
  cdp: CdpDebugClient
  inspectPort: number
  childPid?: number
}

/**
 * 处理 HTTP 请求，返回是否已处理（否则 404）
 */
export async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname

  try {
    if (req.method === 'GET' && pathname === '/status') {
      const body: StatusResponse = {
        connected: ctx.cdp.connected,
        paused: ctx.cdp.isPaused,
        reason: ctx.cdp.lastPauseState?.reason,
        inspectPort: ctx.inspectPort,
        childPid: ctx.childPid,
      }
      json(res, 200, body)
      return true
    }

    if (req.method === 'POST' && pathname === '/breakpoint') {
      const raw = await readBody(req)
      const data = JSON.parse(raw || '{}') as BreakpointSetRequest
      if (!data.file || !data.line) {
        json(res, 400, { error: 'Missing file or line' })
        return true
      }
      const abs = path.isAbsolute(data.file)
        ? data.file
        : path.resolve(ctx.projectCwd, data.file)
      const rec = await ctx.cdp.setBreakpoint(abs, data.line)
      json(res, 200, rec)
      return true
    }

    if (req.method === 'GET' && pathname === '/breakpoints') {
      json(res, 200, { breakpoints: ctx.cdp.breakpointList })
      return true
    }

    if (req.method === 'DELETE' && pathname.startsWith('/breakpoint/')) {
      const id = decodeURIComponent(pathname.replace('/breakpoint/', ''))
      if (!id) {
        json(res, 400, { error: 'Missing breakpoint id' })
        return true
      }
      await ctx.cdp.removeBreakpoint(id)
      json(res, 200, { ok: true })
      return true
    }

    if (req.method === 'POST' && pathname === '/resume') {
      await ctx.cdp.resume()
      json(res, 200, { ok: true })
      return true
    }

    if (req.method === 'POST' && pathname === '/pause') {
      await ctx.cdp.pause()
      json(res, 200, { ok: true })
      return true
    }

    if (req.method === 'GET' && pathname === '/variables') {
      const depth = Number(url.searchParams.get('depth') ?? '1')
      const vars = await ctx.cdp.getVariables(Number.isFinite(depth) ? depth : 1)
      json(res, 200, { variables: vars })
      return true
    }

    if (req.method === 'GET' && pathname === '/callstack') {
      const stack = ctx.cdp.getCallStack()
      json(res, 200, { frames: stack })
      return true
    }

    if (req.method === 'POST' && pathname === '/evaluate') {
      const raw = await readBody(req)
      const data = JSON.parse(raw || '{}') as EvaluateRequest
      if (!data.expression) {
        json(res, 400, { error: 'Missing expression' })
        return true
      }
      const result = await ctx.cdp.evaluate(data.expression)
      json(res, 200, { result })
      return true
    }

    if (req.method === 'DELETE' && pathname === '/breakpoint') {
      json(res, 400, { error: 'Use DELETE /breakpoint/:id' })
      return true
    }

    return false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    json(res, 500, { error: msg })
    return true
  }
}
