import { isAlias, isNode, parseDocument, visit } from 'yaml'

export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string
  warnings: string[]
}

export class SkillFormatError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SkillFormatError'
  }
}

const FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
])
const CORE_TAGS = new Set(
  ['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(tag => `tag:yaml.org,2002:${tag}`)
)

function frontmatter(text: string): { header: string; body: string } {
  const content = text.startsWith('\uFEFF') ? text.slice(1) : text
  const opening = /^---(?:\r?\n|$)/.exec(content)
  if (!opening)
    throw new SkillFormatError(
      'missing-frontmatter',
      'SKILL.md must start with a --- delimiter line'
    )
  const delimiter = /^---(?:\r?\n|$)/gm
  delimiter.lastIndex = opening[0].length
  const closing = delimiter.exec(content)
  if (!closing)
    throw new SkillFormatError('unclosed-frontmatter', 'SKILL.md has no closing --- delimiter line')
  return {
    header: content.slice(opening[0].length, closing.index),
    body: content.slice(closing.index + closing[0].length).trim(),
  }
}

function readFields(header: string): Map<string, unknown> {
  try {
    const document = parseDocument(header, {
      version: '1.2',
      schema: 'core',
      resolveKnownTags: false,
      uniqueKeys: true,
      strict: true,
      merge: false,
      prettyErrors: false,
      logLevel: 'silent',
    })
    if (document.errors.length)
      throw new SkillFormatError(
        'invalid-yaml',
        `Invalid YAML frontmatter (${document.errors[0].code})`
      )
    visit(document, (_key, node) => {
      if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor))
        throw new SkillFormatError('unsupported-yaml', 'YAML anchors and aliases are unsupported')
      if (isNode(node) && node.tag && !CORE_TAGS.has(node.tag))
        throw new SkillFormatError(
          'unsupported-yaml',
          'Custom or non-core YAML tags are unsupported'
        )
    })
    if (document.warnings.length)
      throw new SkillFormatError(
        'unsupported-yaml',
        `Unsupported YAML frontmatter (${document.warnings[0].code})`
      )
    const fields: unknown = document.toJS({ mapAsMap: true, maxAliasCount: 0 })
    if (!(fields instanceof Map) || [...fields.keys()].some(key => typeof key !== 'string'))
      throw new SkillFormatError(
        'invalid-frontmatter',
        'Frontmatter must be a string-keyed YAML mapping'
      )
    for (const field of fields.keys())
      if (!FIELDS.has(field))
        throw new SkillFormatError('unsupported-field', `Unsupported frontmatter field: ${field}`)
    return fields
  } catch (error) {
    if (error instanceof SkillFormatError) throw error
    throw new SkillFormatError('invalid-yaml', 'Unable to parse YAML frontmatter')
  }
}

function stringField(
  fields: Map<string, unknown>,
  field: string,
  required = false
): string | undefined {
  if (!fields.has(field) && !required) return undefined
  const value = fields.get(field)
  if (typeof value !== 'string')
    throw new SkillFormatError(`invalid-${field}`, `Field '${field}' must be a string`)
  return value
}

function nonemptyLength(value: string, field: string, maximum: number): void {
  if (!value.trim() || [...value].length > maximum)
    throw new SkillFormatError(
      `invalid-${field}`,
      `Field '${field}' must contain 1-${maximum} characters and cannot be whitespace-only`
    )
}

function metadataFromHeader(header: string, directoryName: string): SkillMetadata {
  const fields = readFields(header)
  const name = stringField(fields, 'name', true)!.trim().normalize('NFKC')
  nonemptyLength(name, 'name', 64)
  if (
    name !== name.toLowerCase() ||
    !/^[\p{L}\p{N}-]+$/u.test(name) ||
    name.startsWith('-') ||
    name.endsWith('-') ||
    name.includes('--')
  )
    throw new SkillFormatError(
      'invalid-name',
      "Field 'name' must use lowercase Unicode letters, numbers and single hyphens"
    )
  if (name !== directoryName.normalize('NFKC'))
    throw new SkillFormatError('invalid-name', "Field 'name' must match the skill directory name")
  const description = stringField(fields, 'description', true)!
  nonemptyLength(description, 'description', 1024)
  const license = stringField(fields, 'license')
  const compatibility = stringField(fields, 'compatibility')
  if (compatibility !== undefined) nonemptyLength(compatibility, 'compatibility', 500)
  const allowedTools = stringField(fields, 'allowed-tools')
  let metadata: Record<string, string> | undefined
  if (fields.has('metadata')) {
    const entries = fields.get('metadata')
    if (
      !(entries instanceof Map) ||
      [...entries].some(([key, value]) => typeof key !== 'string' || typeof value !== 'string')
    )
      throw new SkillFormatError('invalid-metadata', "Field 'metadata' must map strings to strings")
    metadata = Object.fromEntries(entries)
  }
  return {
    name,
    description: description.trim(),
    ...(license !== undefined ? { license } : {}),
    ...(compatibility !== undefined ? { compatibility: compatibility.trim() } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
    warnings:
      allowedTools !== undefined
        ? [
            "Experimental 'allowed-tools' is informational only; current permissions remain in force",
          ]
        : [],
  }
}

/** Parse a complete, bounded frontmatter header, including both --- delimiter lines. */
export function parseSkillHeader(header: string, directoryName: string): SkillMetadata {
  return metadataFromHeader(frontmatter(header).header, directoryName)
}

export function parseSkillFile(
  text: string,
  directoryName: string
): { metadata: SkillMetadata; body: string } {
  const parsed = frontmatter(text)
  return { metadata: metadataFromHeader(parsed.header, directoryName), body: parsed.body }
}
