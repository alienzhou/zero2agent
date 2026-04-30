import type { UserTaskOptions } from './types.js'

function buildRuntimeContext(options: Pick<UserTaskOptions, 'cwd' | 'date'>): string {
  const entries = [
    options.cwd ? `    <cwd>${options.cwd}</cwd>` : '',
    options.date ? `    <date>${options.date}</date>` : '',
  ].filter(Boolean)

  return entries.join('\n')
}

export function buildUserTaskMessage(options: UserTaskOptions): string {
  const runtimeContext = buildRuntimeContext(options)
  const runtimeContextContent = runtimeContext ? `\n${runtimeContext}\n  ` : '\n  '

  return `<user_task_context>
  <runtime_context>${runtimeContextContent}</runtime_context>
</user_task_context>

<user_task>
${options.rawUserMessage}
</user_task>`
}
