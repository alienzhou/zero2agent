import { createServer } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CdpDebugClient } from './cdp-client.js'
import { handleRoute } from './routes.js'
import { writeSessionFile, removeSessionFile } from '../session-file.js'
import type { CdpDebugSessionFile } from '../types.js'

export interface StartServerOptions {
  /** 工作目录（写入 session 文件、解析相对路径） */
  cwd: string
  /** HTTP API 端口 */
  serverPort: number
  /** Node --inspect 端口 */
  inspectPort: number
  /** start 模式：入口脚本及参数 */
  entry?: string
  entryArgs?: string[]
  /** connect 模式：不 spawn 子进程 */
  connectOnly: boolean
}

/**
 * 轮询等待 Node inspector HTTP 就绪
 */
export async function waitForInspector(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${port}/json/list`,
          { method: 'GET', timeout: 2000 },
          (res) => {
            res.resume()
            if (res.statusCode === 200) {
              resolve()
            } else {
              reject(new Error(`HTTP ${res.statusCode}`))
            }
          }
        )
        req.on('error', reject)
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('timeout'))
        })
        req.end()
      })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('Inspector did not become ready in time')
}

export interface RunningDebugServer {
  shutdown: () => Promise<void>
}

/**
 * 启动 HTTP Server + CDP；可选 spawn 子进程
 */
export async function startDebugServer(options: StartServerOptions): Promise<RunningDebugServer> {
  const cdp = new CdpDebugClient()
  let child: ChildProcess | undefined

  if (!options.connectOnly) {
    if (!options.entry) {
      throw new Error('entry is required when connectOnly is false')
    }
    child = spawn(
      process.execPath,
      [`--inspect=${options.inspectPort}`, options.entry, ...(options.entryArgs ?? [])],
      {
        cwd: options.cwd,
        stdio: 'inherit',
        env: { ...process.env },
      }
    )
  }

  try {
    await waitForInspector(options.inspectPort)
  } catch (e) {
    if (child) {
      child.kill('SIGTERM')
    }
    throw e
  }

  await cdp.connect(options.inspectPort)

  const ctx = {
    projectCwd: options.cwd,
    cdp,
    inspectPort: options.inspectPort,
    childPid: child?.pid,
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain')
      res.end('ok')
      return
    }

    if (req.method === 'POST' && req.url === '/stop') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      setImmediate(() => {
        void shutdown().then(() => process.exit(0))
      })
      return
    }

    const handled = await handleRoute(req, res, ctx)
    if (!handled) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.serverPort, '127.0.0.1', () => resolve())
  })

  const session: CdpDebugSessionFile = {
    pid: process.pid,
    serverPort: options.serverPort,
    inspectPort: options.inspectPort,
    cwd: options.cwd,
    targetEntry: options.entry,
    startedAt: new Date().toISOString(),
    connectOnly: options.connectOnly,
  }
  await writeSessionFile(options.cwd, session)

  async function shutdown(): Promise<void> {
    await removeSessionFile(options.cwd).catch(() => {})
    await cdp.disconnect().catch(() => {})
    if (child && !child.killed) {
      child.kill('SIGTERM')
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { shutdown }
}
