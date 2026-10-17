import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { validateMcpOptions, type McpOptions } from '@zero2agent/core'

/** Reading a user-selected file is inert. Only --mcp-enable IDs grant process startup trust. */
export async function readMcpConfig(
  file: string | undefined,
  enabled: string[]
): Promise<McpOptions | false> {
  if (!file) {
    if (enabled.length) throw new Error('--mcp-enable requires --mcp-config')
    return false
  }
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  let data: unknown
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 32768)
      throw new Error('MCP config must be a regular file of at most 32 KiB')
    const buffer = Buffer.alloc(32769)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 32768) throw new Error('MCP config exceeds 32 KiB')
    data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await handle.close()
  }
  const raw = data as McpOptions
  if (!raw || !Array.isArray(raw.servers) || raw.servers.some(s => Object.hasOwn(s, 'enabled')))
    throw new Error('MCP file cannot grant startup trust; omit enabled and use --mcp-enable ID')
  const config = validateMcpOptions(raw)
  if (
    new Set(enabled).size !== enabled.length ||
    enabled.some(id => !config.servers.some(s => s.id === id))
  )
    throw new Error('Unknown or duplicate --mcp-enable ID')
  return {
    ...config,
    servers: config.servers.map(s => ({ ...s, enabled: enabled.includes(s.id) })),
  }
}
