import {
  CheckpointStore,
  CHECKPOINT_SCOPE,
  type Checkpoint,
  type CheckpointUsage,
} from './checkpoint-store.js'
import { safeText } from './display-text.js'
const size = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1024 / 1024).toFixed(2)} MiB`
export function checkpointTitle(record: Checkpoint): string {
  return `${record.state === 'pending' ? '[未结算] ' : ''}${record.toolName} · ${record.changes.length} 文件 · ${record.changes.map(c => c.path).join(', ')}`
}
export function formatCheckpoints(records: Checkpoint[]): string {
  return safeText(
    [
      CHECKPOINT_SCOPE,
      ...(records.length
        ? records.map(r => `${r.id}  ${r.createdAt}  ${checkpointTitle(r)}`)
        : ['当前工作目录没有文件 Checkpoint。']),
    ].join('\n')
  )
}
export function formatCheckpointUsage(usage: CheckpointUsage): string {
  return `${usage.records} 条记录（${usage.pending} 条未结算） · ${usage.objects} 个去重块\n历史文件版本逻辑总量 ${size(usage.logicalBytes)} · 存储文件 ${size(usage.storedBytes)} · 分配占用 ${size(usage.allocatedBytes)}（不含目录自身）`
}
function lines(data: Buffer): string[] | undefined {
  if (data.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).split('\n')
  } catch {
    return undefined
  }
}
/** Bounded contiguous replacement hunk; no quadratic LCS and no external diff command. */
function diff(before: Buffer, after: Buffer): string[] {
  if (before.length + after.length > 128 * 1024)
    return ['[大文件：仅显示大小和哈希；完整字节仍可恢复]']
  const a = lines(before),
    b = lines(after)
  if (!a || !b) return ['[二进制或非 UTF-8：仅显示大小和哈希；完整字节仍可恢复]']
  let first = 0,
    last = 0
  while (first < a.length && first < b.length && a[first] === b[first]) first++
  while (
    last < a.length - first &&
    last < b.length - first &&
    a[a.length - 1 - last] === b[b.length - 1 - last]
  )
    last++
  if (first === a.length && first === b.length) return ['[内容相同；检查权限变化]']
  const start = Math.max(0, first - 3)
  const endA = Math.min(a.length, a.length - last + 3),
    endB = Math.min(b.length, b.length - last + 3)
  const result = [
    `@@ -${start + 1},${endA - start} +${start + 1},${endB - start} @@`,
    ...a.slice(start, first).map(l => ' ' + l),
    ...a.slice(first, a.length - last).map(l => '-' + l),
    ...b.slice(first, b.length - last).map(l => '+' + l),
    ...a.slice(a.length - last, endA).map(l => ' ' + l),
  ]
  return result.length > 300
    ? [...result.slice(0, 300), '[差异显示超过 300 行，已截断；回退不依赖展示文本]']
    : result
}
export async function formatCheckpointDiff(store: CheckpointStore, id: string): Promise<string> {
  const record = await store.read(id)
  const output = [
    `文件改动 · ${id}`,
    CHECKPOINT_SCOPE,
    `状态: ${record.state} · 调用: ${record.toolName} · 会话: ${record.sessionId ?? '临时'}`,
  ]
  if (record.state === 'pending')
    return safeText(
      [
        ...output,
        '结果未结算，不能把缺少 after 当成未改动。使用 /recover UUID 预览当前文件。',
        ...record.changes.map(c => c.path),
      ].join('\n')
    )
  for (const c of record.changes) {
    output.push(
      `\n--- ${c.before ? c.path : '/dev/null'}\n+++ ${c.after ? c.path : '/dev/null'}`,
      `${c.before?.size ?? 0} → ${c.after?.size ?? 0} bytes · mode ${c.before?.mode.toString(8) ?? '-'} → ${c.after?.mode.toString(8) ?? '-'}`,
      `SHA256 ${c.before?.hash ?? 'absent'} → ${c.after?.hash ?? 'absent'}`
    )
    if (output.join('\n').length > 96 * 1024) {
      output.push('[整体差异展示到达 96 KiB 上限；其余文件见 Checkpoint 清单]')
      break
    }
    if ((c.before?.size ?? 0) + (c.after?.size ?? 0) > 128 * 1024)
      output.push('[大文件：仅显示大小和哈希；完整字节仍可恢复]')
    else output.push(...diff(await store.content(c.before), await store.content(c.after!)))
  }
  return safeText(output.join('\n'))
}
