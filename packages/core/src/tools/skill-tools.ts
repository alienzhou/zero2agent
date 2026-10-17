import { PermissionController } from '../permissions.js'
import { SKILL_LIMITS, Skills, SkillError } from '../skills.js'
import type { Tool } from './types.js'

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value)
    throw new SkillError('SKILL_INVALID_INPUT', `${name} must be a nonempty string.`)
  return value
}

/** Controller ownership and permissions come from the host, never from tool input. */
export function createSkillTools(skills: Skills, permissions: PermissionController): Tool[] {
  const load: Tool = {
    name: 'load_skill',
    permission: { effect: 'read' },
    description:
      'Select a current skill by exact catalog id or unique name. Returns a receipt; its current guide is attached to the next request. Call only load_skill in this batch. Loading never executes scripts or grants permissions.',
    input_schema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Exact current catalog id or unambiguous skill name.',
        },
      },
      required: ['skill'],
    },
    execute: async (input, ctx) => {
      const entry = await skills.activate(
        string(input.skill, 'skill'),
        permissions,
        ctx.signal,
        'model'
      )
      return JSON.stringify({
        kind: 'skill_loaded',
        id: entry.id,
        name: entry.name,
        source: entry.source,
        version: entry.version,
        bytes: entry.bytes,
        warnings: entry.warnings,
        note: 'The current guide is attached to the next request. No script was executed; existing tool permissions remain in force.',
      })
    },
  }
  const read: Tool = {
    name: 'read_skill_resource',
    permission: { effect: 'read' },
    readPaths: async input =>
      skills.resourcePaths(string(input.skill, 'skill'), string(input.path, 'path')),
    description:
      'Read a bounded UTF-8 page from a loaded skill resource. Paths are relative to that skill root; traversal and external links are rejected. Current read permissions apply. Reading never executes scripts.',
    input_schema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Current loaded skill id or unique name.' },
        path: { type: 'string', description: 'Resource path relative to the selected skill root.' },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'UTF-8 byte offset, default 0; continue with next_offset.',
        },
        limit: {
          type: 'integer',
          minimum: 4,
          maximum: SKILL_LIMITS.pageBytes,
          description: 'Maximum page bytes, default 4096.',
        },
      },
      required: ['skill', 'path'],
    },
    execute: (input, ctx) =>
      skills.readResource(
        string(input.skill, 'skill'),
        string(input.path, 'path'),
        input.offset ?? 0,
        input.limit ?? SKILL_LIMITS.pageBytes,
        permissions,
        ctx.signal
      ),
  }
  return [load, read]
}
