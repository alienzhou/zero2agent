export interface SystemPromptOptions {
  /** 预留扩展位，当前版本暂不插入 System Prompt */
  instructions?: string[]
  /** 预留扩展位，当前版本暂不实现 mode-specific 规则 */
  mode?: string
}

export interface UserTaskOptions {
  rawUserMessage: string
  cwd?: string
  date?: string
  platform?: string
  repoRoot?: string
}
