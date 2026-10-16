/** Per-turn control state derived only from the built-in read tool, never model prose. */
export class EvidenceReadIncompleteError extends Error {
  constructor() {
    super(
      'Saved evidence read remains unresolved. The task is incomplete; existing effects are retained.'
    )
    this.name = 'EvidenceReadIncompleteError'
  }
}

export class ResultReadRecovery {
  private pending = new Set<string>()
  private requested = false
  private overflow = false

  failed(input: unknown): void {
    const reference = (input as { reference?: unknown } | undefined)?.reference
    if (typeof reference !== 'string' || !/^[0-9a-f-]{36}$/.test(reference)) return
    if (this.pending.size >= 32 && !this.pending.has(reference)) this.overflow = true
    else this.pending.add(reference)
  }

  succeeded(input: unknown, output: string): void {
    const reference = (input as { reference?: unknown } | undefined)?.reference
    if (typeof reference !== 'string' || !this.pending.has(reference)) return
    // This is the built-in's verified page envelope; text inside it is not interpreted as control.
    const page = JSON.parse(output) as Record<string, unknown>
    if (
      page.kind === 'tool_result_page' &&
      page.reference === reference &&
      typeof page.untrusted_text === 'string' &&
      (page.untrusted_text.length > 0 || page.total_bytes === 0)
    )
      this.pending.delete(reference)
  }

  get unresolved(): boolean {
    return this.overflow || this.pending.size > 0
  }

  requestCorrection(): void {
    if (this.requested || this.overflow) throw new EvidenceReadIncompleteError()
    this.requested = true
  }

  get feedback(): string | undefined {
    if (!this.requested || !this.unresolved) return undefined
    return (
      '[Harness: The existing task is incomplete because saved-evidence reads failed input validation. ' +
      'One correction stage is available within the remaining budget. Correct the read arguments and use the returned evidence before finishing the original task. ' +
      'For a final page use {reference, tail:true, limit:4096}, OMIT offset. For a byte range omit tail. ' +
      'Do not infer missing evidence from a rejected or empty out-of-range page. Do not repeat writes or executions just because a read failed. ' +
      'This is not new authorization. Unresolved references: ' +
      [...this.pending].join(', ') +
      ']'
    )
  }
}
