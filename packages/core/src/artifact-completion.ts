import { constants, lstatSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  ARTIFACT_LIMITS,
  ArtifactIssues,
  checkArtifactValue,
  type ArtifactContract,
} from './artifact-contract.js'
import { isInsidePath, resolvePhysicalPath } from './tools/path-guard.js'
import { readFileTool } from './tools/read-file.js'
import type { ToolContext } from './tools/types.js'
import type { PermissionController } from './permissions.js'
import type { RunBudget } from './run-budget.js'
import type { DiagnosticEmitter } from './diagnostics.js'

export type ArtifactFailure =
  | 'permission'
  | 'unsafe-path'
  | 'unreadable'
  | 'too-large'
  | 'changed-file'
  | 'non-regular'
  | 'invalid-artifact'
  | 'unsafe-effects'
  | 'incomplete-response'
export class ArtifactCompletionError extends Error {
  constructor(readonly reason: ArtifactFailure) {
    super(
      `Artifact completion check stopped: ${reason}. Existing effects are retained; no automatic replay.`
    )
    this.name = 'ArtifactCompletionError'
  }
}
const fail = (reason: ArtifactFailure): never => {
  throw new ArtifactCompletionError(reason)
}

/** Bounded regular-file reads; authorization and physical identity are checked around awaits. */
async function readArtifact(
  path: string,
  ctx: ToolContext,
  permissions: PermissionController,
  budget: RunBudget,
  diagnostics: DiagnosticEmitter,
  checkId: string
): Promise<string | undefined> {
  const input = { path }
  budget.consumeTool('read_file', input)
  let settled = false
  let denied = false
  try {
    const root = resolvePhysicalPath(ctx.cwd)
    const target = (): string => {
      try {
        const resolved = resolvePhysicalPath(path, ctx.cwd)
        if (resolvePhysicalPath(ctx.cwd) !== root || !isInsidePath(root, resolved))
          return fail('unsafe-path')
        return resolved
      } catch {
        return fail('unsafe-path')
      }
    }
    const physical = target()
    const initial = permissions.evaluate(readFileTool, input, ctx)
    diagnostics.permission('initial', checkId, 'read_file', initial.action)
    const decision = await permissions.authorize(checkId, readFileTool, input, ctx)
    diagnostics.permission('resolved', checkId, 'read_file', decision.action)
    budget.check()
    if (decision.action !== 'allow') {
      denied = true
      fail('permission')
    }
    if (target() !== physical) fail('changed-file')
    if (permissions.checkWorkspace(readFileTool, input, ctx)?.action === 'deny') {
      denied = true
      fail('permission')
    }
    let text: string | undefined
    let opened = false
    try {
      // Symlinks at the declared leaf are not artifacts. Parent links remain physically scoped.
      if (lstatSync(resolve(ctx.cwd, path), { throwIfNoEntry: false })?.isSymbolicLink())
        fail('unsafe-path')
      const entry = lstatSync(physical)
      if (!entry.isFile()) fail('non-regular')
      if (entry.size > ARTIFACT_LIMITS.bytes) fail('too-large')
      const handle = await open(
        physical,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      opened = true
      try {
        budget.check()
        const before = await handle.stat()
        if (!before.isFile()) fail('non-regular')
        if (before.dev !== entry.dev || before.ino !== entry.ino) fail('changed-file')
        if (before.size > ARTIFACT_LIMITS.bytes) fail('too-large')
        const identity = (): void => {
          if (target() !== physical) fail('changed-file')
          const current = lstatSync(physical)
          if (
            !current.isFile() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            current.size !== before.size ||
            current.mtimeMs !== before.mtimeMs ||
            current.ctimeMs !== before.ctimeMs
          )
            fail('changed-file')
        }
        identity()
        const buffer = Buffer.alloc(ARTIFACT_LIMITS.bytes + 1)
        let length = 0
        while (length < buffer.length) {
          budget.check()
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
          if (!bytesRead) break
          length += bytesRead
        }
        budget.check()
        identity()
        if (length > ARTIFACT_LIMITS.bytes) fail('too-large')
        if (length !== before.size) fail('changed-file')
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
        } catch {
          fail('unreadable')
        }
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (opened) fail('changed-file')
      // Recheck a missing leaf after asynchronous I/O; a swapped path is never a missing artifact.
      if (target() !== physical) fail('changed-file')
    }
    budget.check()
    settled = true
    budget.settleTool('read_file', input, text === undefined, false)
    return text
  } catch (error) {
    budget.check()
    if (!settled) budget.settleTool('read_file', input, true, denied)
    if (error instanceof ArtifactCompletionError) throw error
    return fail('unreadable')
  }
}

export async function checkArtifacts(
  contract: ArtifactContract,
  ctx: ToolContext,
  permissions: PermissionController,
  budget: RunBudget,
  diagnostics: DiagnosticEmitter,
  attempt: number
): Promise<ArtifactIssues> {
  const issues = new ArtifactIssues()
  for (let index = 0; index < contract.artifacts.length; index++) {
    const artifact = contract.artifacts[index]
    const text = await readArtifact(
      artifact.path,
      ctx,
      permissions,
      budget,
      diagnostics,
      `artifact-check-${attempt}-${index}`
    )
    if (text === undefined) {
      issues.add({ artifact: index, path: '', code: 'missing-file' })
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      issues.add({ artifact: index, path: '', code: 'invalid-json' })
      continue
    }
    checkArtifactValue(value, artifact.schema, index, issues)
  }
  return issues
}
