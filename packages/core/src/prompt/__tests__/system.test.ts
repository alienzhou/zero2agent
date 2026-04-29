import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../system.js'

describe('buildSystemPrompt', () => {
  it('返回包含 5 个 section 的非空字符串', () => {
    const prompt = buildSystemPrompt()
    const sectionHeadings = prompt.match(/^## /gm) ?? []

    expect(prompt.trim()).not.toBe('')
    expect(sectionHeadings).toHaveLength(5)
  })

  it('按固定顺序输出各 section', () => {
    const prompt = buildSystemPrompt({})
    const expectedSections = [
      '## Role / Identity',
      '## Scope / Capability',
      '## Tool Policy',
      '## Workflow',
      '## Output Contract',
    ]
    const indexes = expectedSections.map(section => prompt.indexOf(section))

    expect(indexes.every(index => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('各 section 内容符合预期', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain('只读文件 Agent Harness 演示')
    expect(prompt).toContain('读取文件内容')
    expect(prompt).toContain('列出目录结构')
    expect(prompt).toContain('搜索文件内容')
    expect(prompt).toContain('按模式查找文件')
    expect(prompt).toContain('查找文件名或路径时，优先使用 find_files')
    expect(prompt).toContain('查找文件内容时，使用 grep_search')
    expect(prompt).toContain('面对用户任务时的默认推进方式')
    expect(prompt).toContain('使用中文回答')
  })

  it('Tool Policy 不包含工具参数细节', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).not.toContain('start_line')
    expect(prompt).not.toContain('end_line')
    expect(prompt).not.toContain('pattern:')
  })
})
