export interface SystemPromptOptions {
  instructions?: string[]
  mode?: string
}

export interface UserTaskOptions {
  rawUserMessage: string
  cwd?: string
  date?: string
  platform?: string
  repoRoot?: string
}
