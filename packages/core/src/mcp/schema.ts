import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'

/** Deliberately bounded JSON Schema profile. Unsupported keywords fail discovery, never disappear. */
const keys = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'anyOf',
  'allOf',
  'oneOf',
  'not',
  'default',
])
export function compileMcpSchema(schema: Record<string, unknown>): ValidateFunction {
  if (Buffer.byteLength(JSON.stringify(schema)) > 16384)
    throw new Error('MCP schema exceeds 16 KiB')
  let nodes = 0
  function visit(s: unknown, depth = 0): void {
    if (++nodes > 256 || depth > 12) throw new Error('MCP schema complexity exceeded')
    if (typeof s === 'boolean') return
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Invalid MCP schema')
    for (const [key, value] of Object.entries(s)) {
      if (!keys.has(key)) throw new Error(`Unsupported MCP schema keyword: ${key}`)
      if (key === '$schema' && value !== 'https://json-schema.org/draft/2020-12/schema')
        throw new Error('Unsupported MCP schema dialect')
      if (key === 'properties') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid MCP schema properties')
        for (const v of Object.values(value)) visit(v, depth + 1)
      } else if (['items', 'additionalProperties', 'not'].includes(key)) visit(value, depth + 1)
      else if (['anyOf', 'oneOf', 'allOf'].includes(key)) {
        if (!Array.isArray(value)) throw new Error('Invalid MCP schema combinator')
        for (const v of value) visit(v, depth + 1)
      }
    }
  }
  visit(schema)
  if (schema.type !== 'object') throw new Error('MCP tool schema must describe an object')
  return new Ajv2020({ strict: true, strictTypes: false, allErrors: false }).compile(schema)
}
