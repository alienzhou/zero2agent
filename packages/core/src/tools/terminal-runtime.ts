import type { BackgroundProcessEntry } from './process-registry.js'

export interface TerminalInterruptController {
  signalCancel: () => void
  signalSkip: () => void
}

export interface TerminalRuntimeHooks {
  isTTY: boolean
  onStatus?: (line: string) => void
  attachInterrupts?: (controller: TerminalInterruptController) => () => void
  promptBackgroundCleanup?: (entries: BackgroundProcessEntry[]) => Promise<boolean>
}

const defaultHooks: TerminalRuntimeHooks = {
  isTTY: false,
}

let hooks: TerminalRuntimeHooks = defaultHooks

export function setTerminalRuntimeHooks(next: TerminalRuntimeHooks): void {
  hooks = next
}

export function getTerminalRuntimeHooks(): TerminalRuntimeHooks {
  return hooks
}

export function resetTerminalRuntimeHooksForTests(): void {
  hooks = defaultHooks
}
