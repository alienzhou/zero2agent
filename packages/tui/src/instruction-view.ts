import type { ProjectInstructionView } from '@zero2agent/core'

/** Metadata only; Markdown bodies never become terminal control sequences or diagnostic logs. */
export function formatProjectInstructions(view: ProjectInstructionView): string {
  return [
    `项目指令 ${view.enabled ? '已开启' : '已关闭'} · AGENTS.md`,
    `发现根目录 ${JSON.stringify(view.root)}`,
    `启动目录 ${JSON.stringify(view.cwd)}`,
    '最近读取的规则（可能尚未发送）；/instructions refresh 重新读取，/instructions off 关闭，/instructions on 开启。',
    ...(view.entries.length
      ? view.entries.map(entry =>
          [
            `${entry.status} ${JSON.stringify(entry.path)}`,
            `  scope ${JSON.stringify(entry.scope)}`,
            ...(entry.version ? [`  sha256 ${entry.version} · ${entry.bytes} bytes`] : []),
            ...(entry.physicalPath && entry.physicalPath !== entry.path
              ? [`  source ${JSON.stringify(entry.physicalPath)}`]
              : []),
            ...(entry.error ? [`  error ${JSON.stringify(entry.error)}`] : []),
          ].join('\n')
        )
      : [view.enabled ? '尚未加载；首次任务或 refresh 时读取。' : '新请求不加载项目规则。']),
    ...(view.lastRequest
      ? [
          '上次模型请求使用：',
          ...(view.lastRequest.length
            ? view.lastRequest.map(entry => `  ${JSON.stringify(entry.path)} · ${entry.version}`)
            : ['  无项目规则']),
        ]
      : ['尚无模型请求使用记录。']),
    '仅更具体目录的规则覆盖同目录冲突约定；明确用户要求优先，工具权限仍由宿主执行。',
  ].join('\n')
}
