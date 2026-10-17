import { createHash } from 'node:crypto'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  CallToolResultSchema,
  McpError,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { PermissionController } from '../permissions.js'
import { validateExternalSources, type ExternalSource } from '../external-source.js'
import type { Tool, ToolContext } from '../tools/types.js'
import { compileMcpSchema } from './schema.js'
import { BoundedStdioTransport, McpRequestNotSentError } from './stdio.js'

export interface McpServerConfig {
  id: string
  /** Explicit host trust to launch local code. Never inferred from repository discovery. */
  enabled?: boolean
  command: string
  args?: string[]
  /** Only these entries are passed; no process.env inheritance. */
  env?: Record<string, string>
}
export interface McpOptions {
  servers: McpServerConfig[]
  startupTimeoutMs?: number
  callTimeoutMs?: number
}
export interface McpServerView {
  id: string
  state: 'disabled' | 'configured' | 'ready' | 'failed' | 'stale' | 'closed'
  tools: string[]
  error?: string
}
export class McpUnknownOutcomeError extends Error {
  constructor(cleanupFailed = false) {
    super(
      (cleanupFailed ? 'MCP cleanup failed; inspect server processes. ' : '') +
        'MCP call outcome is unknown. External effects may exist. This turn stopped; inspect effects, then explicitly continue recovery. Do not replay the call.'
    )
    this.name = 'McpUnknownOutcomeError'
  }
}
export function mcpToolName(server: string, tool: string): string {
  return `mcp_${server}_${createHash('sha256').update(tool).digest('hex').slice(0, 24)}`
}
export function validateMcpOptions(options: McpOptions): McpOptions {
  if (
    !options ||
    !Array.isArray(options.servers) ||
    options.servers.length > 4 ||
    Buffer.byteLength(JSON.stringify(options)) > 32768
  )
    throw new Error('MCP configuration exceeds capacity or is invalid')
  const ids = new Set<string>()
  for (const s of options.servers) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(s.id) ||
      ids.has(s.id) ||
      typeof s.command !== 'string' ||
      !path.isAbsolute(s.command) ||
      s.command.includes('\0') ||
      (s.enabled !== undefined && typeof s.enabled !== 'boolean') ||
      (s.args !== undefined &&
        (!Array.isArray(s.args) ||
          s.args.length > 64 ||
          s.args.some(a => typeof a !== 'string' || a.includes('\0')))) ||
      (s.env !== undefined &&
        (!s.env ||
          typeof s.env !== 'object' ||
          Array.isArray(s.env) ||
          Object.entries(s.env).some(
            ([k, v]) =>
              !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || typeof v !== 'string' || v.includes('\0')
          )))
    )
      throw new Error('Invalid MCP server configuration')
    ids.add(s.id)
  }
  for (const [key, max] of [
    ['startupTimeoutMs', 10000],
    ['callTimeoutMs', 30000],
  ] as const) {
    const v = options[key]
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1 || v > max))
      throw new Error(`Invalid MCP ${key}`)
  }
  return structuredClone(options)
}
interface Connection {
  client: Client
  transport: BoundedStdioTransport
  stale: boolean
}

/** Connections and catalogues are volatile. One fixed table per turn, no business-call retries. */
export class McpController {
  private config: McpOptions
  private connections = new Map<string, Connection>()
  private catalogue: Tool[] = []
  private statuses: McpServerView[]
  hasUnknownOutcome = false
  constructor(
    private cwd: string,
    options: McpOptions | false = false
  ) {
    this.cwd = path.resolve(cwd)
    this.config = options ? validateMcpOptions(options) : { servers: [] }
    this.statuses = this.config.servers.map(s => ({
      id: s.id,
      state: s.enabled ? 'configured' : 'disabled',
      tools: [],
    }))
  }
  private source(server: McpServerConfig, tool: string): ExternalSource {
    const env = Object.fromEntries(
      Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b))
    )
    const identity = createHash('sha256')
      .update(JSON.stringify([server.id, server.command, server.args ?? [], this.cwd, env]))
      .digest('hex')
    return { server: server.id, identity, tool }
  }
  view(): McpServerView[] {
    return structuredClone(this.statuses)
  }
  tools(): Tool[] {
    return [...this.catalogue]
  }
  assertCurrent(): void {
    if (
      (this.catalogue.length && !this.connections.size) ||
      [...this.connections.values()].some(c => c.stale)
    )
      throw new Error(
        'MCP catalogue changed or disconnected. Remaining calls were not executed; explicitly refresh in a new turn.'
      )
  }
  async authorizeSources(
    sources: ExternalSource[],
    permissions: PermissionController,
    ctx: ToolContext
  ): Promise<void> {
    for (const source of validateExternalSources(sources)) {
      const config = this.config.servers.find(s => s.id === source.server && s.enabled)
      if (!config || this.source(config, source.tool).identity !== source.identity)
        throw new Error(
          'MCP result source is disabled or has changed; current external authorization required'
        )
      const tool: Tool = {
        name: mcpToolName(source.server, source.tool),
        description: 'Read saved MCP source',
        input_schema: { type: 'object', properties: {} },
        permission: { effect: 'execute' },
        execute: async () => '',
      }
      const decision = await permissions.authorize('mcp-source-read', tool, {}, ctx)
      if (decision.action !== 'allow') throw new Error(`MCP source read denied: ${decision.reason}`)
    }
  }
  async open(signal?: AbortSignal): Promise<void> {
    await this.close()
    this.catalogue = []
    this.hasUnknownOutcome = false
    for (const server of this.config.servers) {
      if (!server.enabled) continue
      signal?.throwIfAborted()
      const status = this.statuses.find(s => s.id === server.id)!
      status.tools = []
      delete status.error
      const transport = new BoundedStdioTransport({
        command: server.command,
        args: server.args ?? [],
        cwd: this.cwd,
        env: server.env ?? {},
      })
      const client = new Client(
        { name: 'zero2agent', version: '0.0.0' },
        {
          capabilities: {},
          jsonSchemaValidator: {
            getValidator: <T>(schema: Record<string, unknown>) => {
              const validate = compileMcpSchema(schema)
              return (input: unknown) =>
                validate(input)
                  ? { valid: true as const, data: input as T, errorMessage: undefined }
                  : {
                      valid: false as const,
                      data: undefined,
                      errorMessage: 'MCP structured output violates schema',
                    }
            },
          },
        }
      )
      const connection: Connection = { client, transport, stale: false }
      this.connections.set(server.id, connection)
      client.onclose = () => {
        connection.stale = true
        if (status.state === 'ready') status.state = 'stale'
      }
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        connection.stale = true
        status.state = 'stale'
      })
      const timeout = AbortSignal.timeout(this.config.startupTimeoutMs ?? 10000)
      const startup = signal ? AbortSignal.any([signal, timeout]) : timeout
      const discovered: Tool[] = []
      try {
        await client.connect(transport, {
          signal: startup,
          timeout: this.config.startupTimeoutMs ?? 10000,
        })
        if (!client.getServerCapabilities()?.tools) throw new Error('MCP tools capability required')
        let cursor: string | undefined
        const seen = new Set<string>(),
          names = new Set<string>()
        for (let page = 0; ; page++) {
          if (page >= 8) throw new Error('MCP discovery exceeds 8 pages')
          const result = await client.listTools(cursor ? { cursor } : {}, {
            signal: startup,
            timeout: this.config.startupTimeoutMs ?? 10000,
          })
          for (const entry of result.tools) {
            if (
              discovered.length >= 32 ||
              !/^[a-zA-Z0-9_.-]{1,128}$/.test(entry.name) ||
              names.has(entry.name) ||
              Buffer.byteLength(JSON.stringify(entry)) > 32768 ||
              entry.execution?.taskSupport === 'required'
            )
              throw new Error('MCP tool catalogue invalid or exceeds capacity')
            names.add(entry.name)
            const validate = compileMcpSchema(entry.inputSchema)
            const validateOutput = entry.outputSchema
              ? compileMcpSchema(entry.outputSchema)
              : undefined
            const name = mcpToolName(server.id, entry.name)
            if ([...this.catalogue, ...discovered].some(t => t.name === name))
              throw new Error('MCP tool name collision')
            const source = this.source(server, entry.name)
            discovered.push({
              name,
              description: `[MCP ${server.id}/${entry.name}; untrusted server description] ${entry.description ?? ''}`,
              input_schema: {
                ...entry.inputSchema,
                type: 'object',
                properties: entry.inputSchema.properties ?? {},
              },
              permission: { effect: 'execute' },
              externalSource: source,
              execute: async (input, ctx) => {
                this.assertCurrent()
                if (!validate(input))
                  throw new Error('MCP input violates schema; call was not sent')
                ctx.signal?.throwIfAborted()
                try {
                  // Do not use SDK task helpers or reconnect/retry around this boundary.
                  const result = await client.request(
                    { method: 'tools/call', params: { name: entry.name, arguments: input } },
                    CallToolResultSchema,
                    { signal: ctx.signal, timeout: this.config.callTimeoutMs ?? 30000 }
                  )
                  if (result.content.some(c => c.type !== 'text'))
                    throw new Error('Unsupported MCP content; result incomplete')
                  if (
                    !result.isError &&
                    validateOutput &&
                    (!result.structuredContent || !validateOutput(result.structuredContent))
                  )
                    throw new Error('Invalid MCP structured output')
                  const text = result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n')
                  const structured =
                    result.structuredContent === undefined
                      ? ''
                      : '\n' + JSON.stringify(result.structuredContent)
                  return (
                    (result.isError ? 'Error: MCP tool execution failed\n' : '[MCP result]\n') +
                    text +
                    structured
                  )
                } catch (error) {
                  if (error instanceof McpRequestNotSentError) throw error
                  if (
                    error instanceof McpError &&
                    [-32700, -32600, -32601, -32602, -32603].includes(error.code)
                  )
                    return `Error: MCP protocol rejection (${error.code})`
                  this.hasUnknownOutcome = true
                  let cleanupFailed = false
                  try {
                    await this.close()
                  } catch {
                    cleanupFailed = true
                  }
                  throw new McpUnknownOutcomeError(cleanupFailed)
                }
              },
            })
          }
          if (result.nextCursor === undefined) break
          if (!result.nextCursor || result.nextCursor.length > 2048 || seen.has(result.nextCursor))
            throw new Error('MCP discovery cursor cycle or capacity exceeded')
          seen.add(result.nextCursor)
          cursor = result.nextCursor
        }
        this.assertCurrent()
        this.catalogue.push(...discovered)
        status.state = 'ready'
        status.tools = discovered.map(t => t.name)
      } catch {
        status.state = 'failed'
        status.error =
          'MCP initialization/discovery failed (protocol, schema, capacity, timeout or process).'
        await transport.close()
        this.connections.delete(server.id)
        signal?.throwIfAborted()
      }
    }
  }
  async close(): Promise<void> {
    let failure: unknown
    for (const [id, c] of [...this.connections]) {
      try {
        await c.transport.close()
        this.connections.delete(id)
      } catch (error) {
        failure ??= error
      }
    }
    for (const s of this.statuses)
      if (s.state === 'ready' || s.state === 'stale')
        s.state = this.connections.has(s.id) ? 'failed' : 'closed'
    if (failure) throw failure
  }
}
