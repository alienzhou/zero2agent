import { describe, it, expect } from 'vitest'
import {
  buildOutputSection,
  buildRoleSection,
  buildScopeSection,
  buildSystemPrompt,
  buildToolPolicySection,
  buildWorkflowSection,
} from '../system.js'

describe('system prompt builder', () => {
  it('无参数调用时返回包含 5 个 section 的字符串', () => {
    const result = buildSystemPrompt()
    const expectedSections = [
      buildRoleSection(),
      buildScopeSection(),
      buildToolPolicySection(),
      buildWorkflowSection(),
      buildOutputSection(),
    ]

    expect(result).toBeTypeOf('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toBe(expectedSections.join('\n\n'))
  })

  it('空配置调用时保持默认 section 顺序', () => {
    const result = buildSystemPrompt({})

    const roleIndex = result.indexOf('你是 Zero2Agent')
    const scopeIndex = result.indexOf('你可以：')
    const toolPolicyIndex = result.indexOf('工具使用策略：')
    const workflowIndex = result.indexOf('面对用户任务时的默认推进方式：')
    const outputIndex = result.indexOf('回答要求：')

    expect(roleIndex).toBeGreaterThanOrEqual(0)
    expect(scopeIndex).toBeGreaterThan(roleIndex)
    expect(toolPolicyIndex).toBeGreaterThan(scopeIndex)
    expect(workflowIndex).toBeGreaterThan(toolPolicyIndex)
    expect(outputIndex).toBeGreaterThan(workflowIndex)
  })

  it('各 section 内容符合默认 System Prompt 约定', () => {
    expect(buildRoleSection()).toContain('只读文件 Agent Harness 演示')
    expect(buildScopeSection()).toContain('- 读取文件内容')
    expect(buildScopeSection()).toContain('- 执行 shell 命令')
    expect(buildToolPolicySection()).toContain('优先使用 find_files')
    expect(buildWorkflowSection()).toContain('1. 先理解用户想要什么')
    expect(buildOutputSection()).toContain('- 使用中文回答')
  })

  it('Tool Policy 只描述工具选择策略，不重复参数说明', () => {
    const result = buildToolPolicySection()

    expect(result).not.toContain('input_schema')
    expect(result).not.toContain('参数')
    expect(result).not.toContain('description')
  })
})
