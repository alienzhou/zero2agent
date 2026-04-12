#!/usr/bin/env node
import { Command } from 'commander'
import http from 'node:http'
import { readSessionFile, removeSessionFile, getSessionPath } from '../session-file.js'
import { startDebugServer } from '../server/index.js'

/** CLI 标准输出（避免 no-console） */
function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

const program = new Command()

program.name('cdp-debug').description('CDP debugger HTTP server + CLI for Node.js').version('0.0.0')

program
  .command('start')
  .description('Start target with --inspect, HTTP API server, and write session file')
  .argument('<entry>', 'Entry script (e.g. dist/cli.js)')
  .argument('[extra...]', 'Arguments forwarded to the target script')
  .option('--cwd <dir>', 'Project root (session file + path resolve)', process.cwd())
  .option('--inspect-port <n>', 'Node inspector port', (v) => Number(v), 9229)
  .option('--server-port <n>', 'HTTP API port', (v) => Number(v), 7492)
  .action(
    async (
      entry: string,
      extra: string[],
      opts: { cwd: string; inspectPort: number; serverPort: number }
    ) => {
      const entryArgs = extra ?? []
      const { shutdown } = await startDebugServer({
        cwd: opts.cwd,
        serverPort: opts.serverPort,
        inspectPort: opts.inspectPort,
        entry,
        entryArgs,
        connectOnly: false,
      })
      const onStop = async (): Promise<void> => {
        await shutdown().catch(() => {})
        process.exit(0)
      }
      process.on('SIGINT', () => void onStop())
      process.on('SIGTERM', () => void onStop())
      await new Promise<void>(() => {})
    }
  )

program
  .command('connect')
  .description('Connect CDP to an existing --inspect process (no child spawn)')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .option('--inspect-port <n>', 'Existing inspector port', (v) => Number(v), 9229)
  .option('--server-port <n>', 'HTTP API port', (v) => Number(v), 7492)
  .action(async (opts: { cwd: string; inspectPort: number; serverPort: number }) => {
    const { shutdown } = await startDebugServer({
      cwd: opts.cwd,
      serverPort: opts.serverPort,
      inspectPort: opts.inspectPort,
      connectOnly: true,
    })
    const onStop = async (): Promise<void> => {
      await shutdown().catch(() => {})
      process.exit(0)
    }
    process.on('SIGINT', () => void onStop())
    process.on('SIGTERM', () => void onStop())
    await new Promise<void>(() => {})
  })

async function apiRequest(
  cwd: string,
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  let session
  try {
    session = await readSessionFile(cwd)
  } catch {
    console.error(
      `No active debug session. Expected ${getSessionPath(cwd)} — run "cdp-debug start" or "cdp-debug connect" first.`
    )
    process.exit(1)
  }
  const payload = body !== undefined ? JSON.stringify(body) : undefined
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: session.serverPort,
        path,
        method,
        headers:
          payload !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : undefined,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            const data = text ? JSON.parse(text) : {}
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error((data as { error?: string }).error ?? text))
            } else {
              resolve(data)
            }
          } catch {
            reject(new Error(text))
          }
        })
      }
    )
    req.on('error', reject)
    if (payload !== undefined) {
      req.write(payload)
    }
    req.end()
  })
}

program
  .command('status')
  .description('Show CDP / pause status')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const data = (await apiRequest(opts.cwd, 'GET', '/status')) as Record<string, unknown>
    printJson(data)
  })

const bp = program.command('bp').description('Breakpoint commands')

bp.command('set')
  .argument('<fileLine>', 'file:line (line is 1-based)')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (fileLine: string, opts: { cwd: string }) => {
    const idx = fileLine.lastIndexOf(':')
    if (idx <= 0) {
      console.error('Expected file:line')
      process.exit(1)
    }
    const file = fileLine.slice(0, idx)
    const line = Number(fileLine.slice(idx + 1))
    if (!Number.isFinite(line)) {
      console.error('Invalid line number')
      process.exit(1)
    }
    const data = await apiRequest(opts.cwd, 'POST', '/breakpoint', { file, line })
    printJson(data)
  })

bp.command('list')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const data = (await apiRequest(opts.cwd, 'GET', '/breakpoints')) as { breakpoints: unknown[] }
    printJson(data.breakpoints)
  })

bp.command('remove')
  .argument('<id>', 'Breakpoint id e.g. bp-1')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (id: string, opts: { cwd: string }) => {
    const data = await apiRequest(opts.cwd, 'DELETE', `/breakpoint/${encodeURIComponent(id)}`)
    printJson(data)
  })

program
  .command('resume')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const data = await apiRequest(opts.cwd, 'POST', '/resume')
    printJson(data)
  })

program
  .command('pause')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const data = await apiRequest(opts.cwd, 'POST', '/pause')
    printJson(data)
  })

program
  .command('vars')
  .description('Print scope variables when paused')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .option('--depth <n>', 'Scope depth', (v) => Number(v), 1)
  .action(async (opts: { cwd: string; depth: number }) => {
    const data = await apiRequest(opts.cwd, 'GET', `/variables?depth=${encodeURIComponent(String(opts.depth))}`)
    printJson(data)
  })

program
  .command('stack')
  .description('Print call stack when paused')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    const data = await apiRequest(opts.cwd, 'GET', '/callstack')
    printJson(data)
  })

program
  .command('eval')
  .argument('<expression>', 'Expression to evaluate in paused context')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (expression: string, opts: { cwd: string }) => {
    const data = await apiRequest(opts.cwd, 'POST', '/evaluate', { expression })
    printJson(data)
  })

program
  .command('stop')
  .description('Stop debug server, disconnect CDP, remove session file')
  .option('--cwd <dir>', 'Project root', process.cwd())
  .action(async (opts: { cwd: string }) => {
    try {
      await apiRequest(opts.cwd, 'POST', '/stop')
    } catch {
      await removeSessionFile(opts.cwd).catch(() => {})
    }
  })

async function main(): Promise<void> {
  await program.parseAsync(process.argv)
}

void main()
