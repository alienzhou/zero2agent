/**
 * Live E2E 公共开关（真实 LLM）
 */
export function isLiveEnabled(): boolean {
  return process.env.E2E_LIVE === '1' && Boolean(process.env.ANTHROPIC_API_KEY)
}

export function liveSkipReason(): string {
  if (!process.env.ANTHROPIC_API_KEY) return '缺少 ANTHROPIC_API_KEY'
  if (process.env.E2E_LIVE !== '1') return '未设置 E2E_LIVE=1'
  return ''
}

export const live = isLiveEnabled()

if (!live) {
  // eslint-disable-next-line no-console
  console.log(`[e2e] 跳过 terminal live 用例：${liveSkipReason()}`)
}
