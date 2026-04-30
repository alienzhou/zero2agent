import { describe, expect, it } from 'vitest'
import { buildUserTaskMessage } from '../user-task.js'

describe('buildUserTaskMessage', () => {
  it('输出包含 user task context 和 user task 标签', () => {
    const message = buildUserTaskMessage({
      rawUserMessage: '请查看 README',
      cwd: '/tmp/project',
      date: '2026-04-29',
    })

    expect(message).toContain('<user_task_context>')
    expect(message).toContain('<runtime_context>')
    expect(message).toContain('<cwd>/tmp/project</cwd>')
    expect(message).toContain('<date>2026-04-29</date>')
    expect(message).toContain('<user_task>')
    expect(message).toContain('请查看 README')
    expect(message).toContain('</user_task>')
  })

  it('Runtime Context 字段可选', () => {
    const message = buildUserTaskMessage({
      rawUserMessage: 'hello',
    })

    expect(message).toContain('<runtime_context>')
    expect(message).not.toContain('<cwd>')
    expect(message).not.toContain('<date>')
    expect(message).toContain('<user_task>\nhello\n</user_task>')
  })

  it('支持只传入 cwd 或 date', () => {
    const cwdOnly = buildUserTaskMessage({
      rawUserMessage: 'cwd only',
      cwd: '/repo',
    })
    const dateOnly = buildUserTaskMessage({
      rawUserMessage: 'date only',
      date: '2026-04-29',
    })

    expect(cwdOnly).toContain('<cwd>/repo</cwd>')
    expect(cwdOnly).not.toContain('<date>')
    expect(dateOnly).toContain('<date>2026-04-29</date>')
    expect(dateOnly).not.toContain('<cwd>')
  })

  it('保留用户原始输入', () => {
    const rawUserMessage = '第一行\n<xml> & "quoted"\n最后一行'
    const message = buildUserTaskMessage({ rawUserMessage })

    expect(message).toContain(`<user_task>\n${rawUserMessage}\n</user_task>`)
  })

  it('用户输入为空字符串时正常输出', () => {
    const message = buildUserTaskMessage({ rawUserMessage: '' })

    expect(message).toContain('<user_task>\n\n</user_task>')
  })
})
