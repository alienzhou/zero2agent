import type { SkillView } from '@zero2agent/core'

/** Metadata only: bodies/resources stay out of inspection notices and diagnostic logs. */
export function formatSkills(view: SkillView): string {
  return [
    `Skills: ${view.enabled ? '开启' : '关闭'}`,
    `工作目录 ${JSON.stringify(view.cwd)}`,
    '当前目录与激活状态；/skills refresh 重读，load 名称加载，unload 名称停用，off/on 全局开关。',
    ...view.roots.map(root => `来源根 ${JSON.stringify(root)}`),
    ...view.entries.map(entry =>
      [
        `${entry.status} ${entry.name ?? '(invalid)'} · ${entry.id}`,
        `  source ${JSON.stringify(entry.source)}`,
        ...(entry.description ? [`  ${JSON.stringify(entry.description)}`] : []),
        ...(entry.version ? [`  sha256 ${entry.version} · ${entry.bytes} bytes`] : []),
        ...(entry.previousVersion ? [`  previous ${entry.previousVersion}`] : []),
        ...entry.warnings.map(warning => `  warning ${JSON.stringify(warning)}`),
        ...(entry.error ? [`  error ${JSON.stringify(entry.error)}`] : []),
        ...(entry.resources ?? []).map(
          resource =>
            `  resource ${resource.status} ${JSON.stringify(resource.path)}` +
            (resource.version ? ` · sha256 ${resource.version}` : '') +
            (resource.error ? ` · ${JSON.stringify(resource.error)}` : '')
        ),
      ].join('\n')
    ),
    ...view.errors.map(error => `error ${JSON.stringify(error)}`),
    ...(view.lastRequest
      ? ['上次模型请求使用（刷新不等于模型已看到）：', JSON.stringify(view.lastRequest)]
      : ['尚无模型请求使用记录。']),
    '发现、加载或读参考文件不会运行脚本；allowed-tools 不授予权限。旧正文只作为历史，当前停用不会删除过去的真实工具结果。',
  ].join('\n')
}
