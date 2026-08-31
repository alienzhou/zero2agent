/**
 * 后台进程登记表：只登记被 Ctrl-S 跳过的进程。
 */

export interface BackgroundProcessEntry {
  pid: number
  command: string
  logPath: string | null
  startAt: number
  skippedAt: number
}

const registry = new Map<number, BackgroundProcessEntry>()
const completionNotices: string[] = []

export function registerBackgroundProcess(entry: BackgroundProcessEntry): void {
  registry.set(entry.pid, entry)
}

export function unregisterBackgroundProcess(pid: number): void {
  registry.delete(pid)
}

export function listBackgroundProcesses(): BackgroundProcessEntry[] {
  return [...registry.values()]
}

export function queueCompletionNotice(command: string, pid: number): void {
  completionNotices.push(`Background command finished (pid ${pid}): ${command}`)
}

export function drainCompletionNotices(): string[] {
  if (completionNotices.length === 0) return []
  const notices = [...completionNotices]
  completionNotices.length = 0
  return notices
}

export function clearProcessRegistryForTests(): void {
  registry.clear()
  completionNotices.length = 0
}
