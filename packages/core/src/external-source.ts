/** Host-derived external provenance. Never contains commands, arguments, environment or approvals. */
export interface ExternalSource {
  server: string
  identity: string
  tool: string
}
export function validateExternalSources(value: unknown): ExternalSource[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new Error('Invalid external source catalog')
  return value.map(source => {
    if (
      !source ||
      typeof source.server !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(source.server) ||
      typeof source.identity !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.identity) ||
      typeof source.tool !== 'string' ||
      !/^[a-zA-Z0-9_.-]{1,128}$/.test(source.tool)
    )
      throw new Error('Invalid external source identity')
    return { server: source.server, identity: source.identity, tool: source.tool }
  })
}
