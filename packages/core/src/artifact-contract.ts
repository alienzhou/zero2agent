/** A caller-owned structural contract, explicitly supplied for one turn only. */
export type ArtifactValue = string | number | boolean | null
export type ArtifactRule = (
  | { kind: 'object'; fields: Record<string, ArtifactRule>; allowAdditional: boolean }
  | { kind: 'value'; type?: 'string' | 'number' | 'boolean'; choices?: ArtifactValue[] }
) & {
  /** Caller-defined meaning for the model; never treated as a machine-verified semantic rule. */
  description?: string
}
export interface ArtifactContract {
  version: 1
  artifacts: { path: string; format: 'json'; schema: ArtifactRule }[]
}
export interface ArtifactIssue {
  artifact: number
  path: string
  code:
    | 'missing-key'
    | 'expected-object'
    | 'unexpected-keys'
    | 'wrong-type'
    | 'outside-enum'
    | 'missing-file'
    | 'invalid-json'
}
export const ARTIFACT_LIMITS = Object.freeze({
  files: 4,
  bytes: 65536,
  contractBytes: 16384,
  issues: 32,
  feedbackBytes: 4096,
})
const HEADER =
  '[Caller-declared artifact contract (JSON structure only). This is not permission to perform additional actions and does not certify facts or sources.]\n'
const FEEDBACK =
  '[Harness artifact validation for the existing task; this is not new authorization. Fix only the reported structural issues using permitted tools, keeping the original facts and source evidence. Do not repeat completed or denied effects. Re-read evidence for uncertain facts. One repair stage remains.]\n'
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const primitive = (value: unknown): value is ArtifactValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))
const invalid = (): never => {
  throw new TypeError('Invalid or unbounded artifact contract.')
}

/** Copy JSON data without invoking accessors/toJSON; retain property order for request parity. */
export function validateArtifactContract(value: unknown): ArtifactContract {
  let entries = 0
  const active = new Set<object>()
  const copy = (v: unknown, depth: number): unknown => {
    if (++entries > 4096 || depth > 32) return invalid()
    if (primitive(v)) return v
    if (!v || typeof v !== 'object' || active.has(v)) return invalid()
    if (
      Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype) &&
      Object.getPrototypeOf(v) !== null
    )
      return invalid()
    active.add(v)
    const out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {}
    const keys = Reflect.ownKeys(v)
    if (keys.length > 2048) return invalid()
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue
      if (typeof key !== 'string') return invalid()
      const d = Object.getOwnPropertyDescriptor(v, key)!
      if (!d.enumerable || !('value' in d)) return invalid()
      if (Array.isArray(v) && !/^(?:0|[1-9]\d*)$/.test(key)) return invalid()
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true })
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length) return invalid()
    active.delete(v)
    return Object.freeze(out)
  }
  const contract = copy(value, 0)
  if (Buffer.byteLength(JSON.stringify(contract)) > ARTIFACT_LIMITS.contractBytes) return invalid()
  const keysOnly = (v: Record<string, unknown>, keys: string[]): boolean =>
    Object.keys(v).every(k => keys.includes(k))
  if (
    !object(contract) ||
    !keysOnly(contract, ['version', 'artifacts']) ||
    contract.version !== 1 ||
    !Array.isArray(contract.artifacts) ||
    !contract.artifacts.length ||
    contract.artifacts.length > ARTIFACT_LIMITS.files
  )
    return invalid()
  let nodes = 0
  const rule = (r: unknown, depth: number): void => {
    if (!object(r) || depth > 12 || ++nodes > 512) return invalid()
    if (
      r.description !== undefined &&
      (typeof r.description !== 'string' || Buffer.byteLength(r.description) > 1024)
    )
      return invalid()
    if (r.kind === 'object') {
      if (
        !keysOnly(r, ['kind', 'fields', 'allowAdditional', 'description']) ||
        !object(r.fields) ||
        typeof r.allowAdditional !== 'boolean'
      )
        return invalid()
      for (const [key, child] of Object.entries(r.fields)) {
        if (Buffer.byteLength(key) > 256) return invalid()
        rule(child, depth + 1)
      }
    } else {
      if (r.kind !== 'value' || !keysOnly(r, ['kind', 'type', 'choices', 'description']))
        return invalid()
      if (r.type !== undefined && !['string', 'number', 'boolean'].includes(r.type as string))
        return invalid()
      if (
        r.choices !== undefined &&
        (!Array.isArray(r.choices) ||
          !r.choices.length ||
          r.choices.length > 32 ||
          !r.choices.every(primitive))
      )
        return invalid()
    }
  }
  const paths = new Set<string>()
  for (const a of contract.artifacts) {
    if (
      !object(a) ||
      !keysOnly(a, ['path', 'format', 'schema']) ||
      a.format !== 'json' ||
      typeof a.path !== 'string' ||
      Buffer.byteLength(a.path) > 1024 ||
      /[\\:]/.test(a.path) ||
      [...a.path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      a.path.split('/').some(part => !part || part === '.' || part === '..') ||
      paths.has(a.path)
    )
      return invalid()
    paths.add(a.path)
    rule(a.schema, 0)
  }
  return contract as unknown as ArtifactContract
}
export function formatArtifactTask(message: string, contract: ArtifactContract): string {
  return HEADER + JSON.stringify(validateArtifactContract(contract)) + '\n\n' + message
}

/** Issues include caller-declared locations, never artifact values or unexpected key names. */
export class ArtifactIssues {
  private issues: ArtifactIssue[] = []
  count = 0
  add(issue: ArtifactIssue): void {
    this.count++
    if (this.issues.length === ARTIFACT_LIMITS.issues) return
    const next = [...this.issues, issue]
    if (
      Buffer.byteLength(FEEDBACK + JSON.stringify({ issues: next, omitted: 999999 })) <=
      ARTIFACT_LIMITS.feedbackBytes
    )
      this.issues = next
  }
  feedback(): string {
    return (
      FEEDBACK + JSON.stringify({ issues: this.issues, omitted: this.count - this.issues.length })
    )
  }
}
export function checkArtifactValue(
  actual: unknown,
  rule: ArtifactRule,
  artifact: number,
  issues: ArtifactIssues,
  pointer = ''
): void {
  const issue = (code: ArtifactIssue['code'], path = pointer): void =>
    issues.add({ artifact, path, code })
  if (rule.kind === 'object') {
    if (!object(actual)) {
      issue('expected-object')
      return
    }
    for (const [key, child] of Object.entries(rule.fields)) {
      const childPath = pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')
      if (!Object.hasOwn(actual, key)) issue('missing-key', childPath)
      else checkArtifactValue(actual[key], child, artifact, issues, childPath)
    }
    if (!rule.allowAdditional && Object.keys(actual).some(key => !Object.hasOwn(rule.fields, key)))
      issue('unexpected-keys')
  } else {
    if (
      rule.type &&
      (typeof actual !== rule.type || (rule.type === 'number' && !Number.isFinite(actual)))
    )
      issue('wrong-type')
    if (rule.choices && !rule.choices.some(choice => choice === actual)) issue('outside-enum')
  }
}
