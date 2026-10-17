import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
import { runLoop } from '../loop.js'
import { Session } from '../session.js'
import { createAnthropicClient } from '../llm/index.js'
import { messageStream } from './helpers/message-stream.js'
import { writeFileTool } from '../tools/write-file.js'
import { readFileTool } from '../tools/read-file.js'
import type { ContextRequest } from '../context-budget.js'
import { Skills } from '../skills.js'
import { PermissionController } from '../permissions.js'

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'claude-sonnet-4-20250514',
}))
let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'z2a-skills-loop-')))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
async function file(path: string, content: string) {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), content)
}
function guide(body = 'GUIDE_VERSION_ONE', name = 'fix-with-tests') {
  return `---\nname: ${name}\ndescription: Repair amounts with tests.\n---\n${body}`
}
async function skill(body?: string, name = 'fix-with-tests') {
  const path = `.agents/skills/${name}/SKILL.md`
  await file(path, guide(body, name))
  return path
}
const tool = (
  id: string,
  name: string,
  input: Record<string, unknown>
): Anthropic.ToolUseBlock => ({ type: 'tool_use', id, name, input })
const reply = (...content: Anthropic.ToolUseBlock[]): Anthropic.Message =>
  ({ content, stop_reason: 'tool_use' }) as Anthropic.Message
const answer = (text = 'done'): Anthropic.Message =>
  ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) as Anthropic.Message
function provider(...responses: Array<Anthropic.Message | (() => Promise<Anthropic.Message>)>) {
  const requests: ContextRequest[] = []
  const stream = vi.fn((request: ContextRequest) => {
    requests.push(structuredClone(request))
    return messageStream(async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected request')
      return typeof next === 'function' ? next() : next
    })
  })
  const create = vi.fn(async () =>
    answer('The earlier task discussed a repair; current skill versions are supplied separately.')
  )
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { stream, create },
  } as unknown as Anthropic)
  return { requests, stream, create }
}
function agent(extra: ConstructorParameters<typeof Agent>[0] = {}) {
  return new Agent({
    cwd: root,
    tools: [writeFileTool, readFileTool],
    permissions: { mode: 'accept-edits' },
    ...extra,
  })
}
function paired(runner: Agent) {
  const history = runner.getHistory()
  for (const [index, message] of history.entries()) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const calls = message.content.filter(block => block.type === 'tool_use')
    if (calls.length)
      expect(
        (history[index + 1].content as Anthropic.ToolResultBlockParam[]).map(
          block => block.tool_use_id
        )
      ).toEqual(calls.map(call => call.id))
  }
}
const currentContext = (request: ContextRequest) => JSON.stringify(request.messages[0])

describe('Skills through actual loop, snapshots and context accounting', () => {
  it.each([false, undefined])(
    'keeps empty/disabled workspaces request-compatible (%s)',
    async skills => {
      if (skills === false) await skill('MUST_NOT_LOAD')
      const { requests } = provider(answer())
      await agent({ skills, systemPrompt: 'original system' }).run('task')
      expect(requests[0].system).toBe('original system')
      expect(requests[0].messages).toEqual([{ role: 'user', content: 'task' }])
      expect(requests[0].tools?.some(t => t.name === 'load_skill')).toBe(false)
    }
  )

  it('keeps no-skill Session reuse and legacy Agent restore request-compatible', async () => {
    const { requests } = provider(answer('one'), answer('two'), answer('three'))
    const session = new Session()
    await runLoop('first', { cwd: root, tools: [], session })
    await runLoop('second', { cwd: root, tools: [], session })
    expect(requests[1].messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'one' }] },
      { role: 'user', content: 'second' },
    ])
    const restored = agent()
    restored.restore(session.snapshot())
    await restored.run('third')
    expect(requests[2].messages).toEqual([
      ...session.getHistory(),
      { role: 'user', content: 'third' },
    ])
    expect(requests[2].tools?.some(t => t.name === 'load_skill')).toBe(false)
  })

  it('honors a current explicit selection on restore and does not revive it after unload', async () => {
    await skill()
    const { requests } = provider(answer(), answer())
    const legacy = { messages: [], context: { through: 0, summary: '' } }
    const restored = agent({ skills: { selected: ['fix-with-tests'] } })
    restored.restore(legacy)
    await restored.run('first')
    expect(currentContext(requests[0])).toContain('GUIDE_VERSION_ONE')
    restored.deactivateSkill('fix-with-tests')
    restored.restore(legacy)
    await restored.run('second')
    expect(currentContext(requests[1])).not.toContain('GUIDE_VERSION_ONE')
    expect(restored.snapshot().skills).toBeUndefined()
  })

  it('retains an inactive historical notice after a used skill is unloaded and removed', async () => {
    await skill()
    const { requests } = provider(
      reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })),
      answer(),
      answer()
    )
    const original = agent()
    await original.run('use guide')
    original.deactivateSkill('fix-with-tests')
    const snapshot = original.snapshot()
    expect(snapshot.skills).toBeUndefined()
    await rm(join(root, '.agents'), { recursive: true })
    const restored = agent()
    restored.restore(snapshot)
    await restored.run('continue without guide')
    expect(currentContext(requests[2])).toContain('skill')
    expect(currentContext(requests[2])).not.toContain('GUIDE_VERSION_ONE')
    expect(restored.getSkills().entries.some(entry => entry.status === 'loaded')).toBe(false)
    paired(restored)
  })

  it('clears previous activation when an existing Agent restores an ordinary conversation', async () => {
    await skill()
    const runner = agent()
    await runner.activateSkill('fix-with-tests')
    runner.restore({ messages: [], context: { through: 0, summary: '' } })
    const { requests } = provider(answer())
    await runner.run('ordinary')
    expect(currentContext(requests[0])).not.toContain('GUIDE_VERSION_ONE')
    expect(runner.snapshot().skills).toBeUndefined()
  })

  it('sends catalogue, guide and requested reference in separate stages with exact pairing', async () => {
    await skill()
    await skill('UNRELATED_BODY_SENTINEL', 'unrelated')
    await file('.agents/skills/fix-with-tests/references/report.txt', 'REPORT_REFERENCE_SENTINEL')
    const { requests } = provider(
      reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })),
      reply(
        tool('resource', 'read_skill_resource', {
          skill: 'fix-with-tests',
          path: 'references/report.txt',
        })
      ),
      reply(tool('write', 'write_file', { path: 'report.txt', content: 'actual report' })),
      answer()
    )
    const runner = agent()
    await runner.run('repair')
    expect(JSON.stringify(requests[0])).toContain('fix-with-tests')
    expect(JSON.stringify(requests[0])).not.toContain('GUIDE_VERSION_ONE')
    expect(currentContext(requests[1])).toContain('GUIDE_VERSION_ONE')
    expect(JSON.stringify(requests[1])).not.toContain('REPORT_REFERENCE_SENTINEL')
    expect(JSON.stringify(requests[2])).toContain('REPORT_REFERENCE_SENTINEL')
    expect(JSON.stringify(requests)).not.toContain('UNRELATED_BODY_SENTINEL')
    const results = runner.getHistory()[2].content as Anthropic.ToolResultBlockParam[]
    expect(JSON.stringify(results)).not.toContain('GUIDE_VERSION_ONE')
    expect(await readFile(join(root, 'report.txt'), 'utf8')).toBe('actual report')
    expect(runner.snapshot().skills?.selected).toHaveLength(1)
    expect(JSON.stringify(runner.snapshot())).not.toContain('GUIDE_VERSION_ONE')
    paired(runner)
  })

  it('rejects the entire mixed loading/write batch before any effect, then permits replanning', async () => {
    await skill()
    const write = vi.spyOn(writeFileTool, 'execute')
    const { requests } = provider(
      reply(
        tool('mixed-load', 'load_skill', { skill: 'fix-with-tests' }),
        tool('mixed-write', 'write_file', { path: 'effect.txt', content: 'wrong' })
      ),
      reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })),
      reply(tool('write', 'write_file', { path: 'effect.txt', content: 'after guide' })),
      answer()
    )
    const runner = agent()
    await runner.run('repair')
    expect(write).toHaveBeenCalledOnce()
    expect(JSON.stringify(requests[1])).toContain('entire batch was not executed')
    expect(JSON.stringify(requests[1])).not.toContain('GUIDE_VERSION_ONE')
    expect(currentContext(requests[2])).toContain('GUIDE_VERSION_ONE')
    expect(await readFile(join(root, 'effect.txt'), 'utf8')).toBe('after guide')
    paired(runner)
  })

  it.each([2, 3, 4])(
    'bounds repeated mixed-batch replanning at three (%i batches)',
    async count => {
      await skill()
      const mixed = (_: unknown, index: number) =>
        reply(
          tool('load-' + index, 'load_skill', { skill: 'fix-with-tests' }),
          tool('write-' + index, 'write_file', { path: 'effect.txt', content: 'bad' })
        )
      provider(...Array.from({ length: count }, mixed), answer())
      const runner = agent()
      if (count > 3) await expect(runner.run('repair')).rejects.toThrow('replanning limit')
      else await runner.run('repair')
      await expect(readFile(join(root, 'effect.txt'))).rejects.toThrow()
      paired(runner)
    }
  )

  it('rechecks selected versions changed while the model responded before executing a batch', async () => {
    const path = await skill()
    const write = vi.spyOn(writeFileTool, 'execute')
    const { requests } = provider(
      async () => {
        await file(path, guide('GUIDE_VERSION_TWO'))
        return reply(tool('stale', 'write_file', { path: 'effect.txt', content: 'stale' }))
      },
      reply(tool('fresh', 'write_file', { path: 'effect.txt', content: 'fresh' })),
      answer()
    )
    const runner = agent({ skills: { selected: ['fix-with-tests'] } })
    await runner.run('repair')
    expect(currentContext(requests[0])).toContain('GUIDE_VERSION_ONE')
    expect(currentContext(requests[1])).toContain('GUIDE_VERSION_TWO')
    expect(currentContext(requests[1])).not.toContain('GUIDE_VERSION_ONE')
    expect(write).toHaveBeenCalledOnce()
    expect(await readFile(join(root, 'effect.txt'), 'utf8')).toBe('fresh')
    paired(runner)
  })

  it('retains the first real effect and stops the remaining batch when a guide is modified', async () => {
    const path = await skill()
    provider(
      reply(
        tool('guide', 'write_file', { path, content: guide('GUIDE_VERSION_TWO') }),
        tool('second', 'write_file', { path: 'second.txt', content: 'never' })
      )
    )
    const runner = agent({ skills: { selected: ['fix-with-tests'] } })
    await expect(runner.run('change')).rejects.toThrow('Skills changed before execution')
    expect(await readFile(join(root, path), 'utf8')).toContain('GUIDE_VERSION_TWO')
    await expect(readFile(join(root, 'second.txt'))).rejects.toThrow()
    const result = (runner.getHistory()[2].content as Anthropic.ToolResultBlockParam[])[0]
    expect(result.is_error).not.toBe(true)
    expect(result.content).toContain('bytes written')
    paired(runner)
  })

  it('checks a guide again after write approval and preserves zero effects on change', async () => {
    const path = await skill()
    provider(reply(tool('write', 'write_file', { path: 'effect.txt', content: 'never' })))
    const requestApproval = vi.fn(async (request: { id: string }) => {
      await file(path, guide('CHANGED_DURING_APPROVAL'))
      return { requestId: request.id, decision: 'allow' as const }
    })
    const runner = agent({
      skills: { selected: ['fix-with-tests'] },
      permissions: { requestApproval },
    })
    await expect(runner.run('repair')).rejects.toThrow('Skills changed before execution')
    expect(requestApproval).toHaveBeenCalledOnce()
    await expect(readFile(join(root, 'effect.txt'))).rejects.toThrow()
    paired(runner)
  })

  it('rebuilds selected current versions after compact/restore without saving body or approvals', async () => {
    const path = await skill()
    const { requests, create } = provider(answer('old discussion '.repeat(500)), answer())
    const runner = agent({ skills: { selected: ['fix-with-tests'] } })
    await runner.run('original')
    const history = runner.getHistory()
    expect(await runner.compact()).toBe(true)
    expect(create).toHaveBeenCalled()
    expect(runner.getHistory()).toEqual(history)
    const snapshot = runner.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain('GUIDE_VERSION_ONE')
    await file(path, guide('GUIDE_VERSION_TWO'))
    const resumed = agent()
    resumed.restore(snapshot)
    await resumed.run('continue')
    expect(currentContext(requests[1])).toContain('GUIDE_VERSION_TWO')
    expect(currentContext(requests[1])).not.toContain('GUIDE_VERSION_ONE')
    const denied = agent({ permissions: { rules: [{ tool: 'read_file', action: 'deny' }] } })
    denied.restore(snapshot)
    await expect(denied.run('continue')).rejects.toThrow()
    expect(requests).toHaveLength(2)
  })

  it('does not restore activation into disabled configuration or after explicit unload', async () => {
    await skill()
    const runner = agent()
    await runner.activateSkill('fix-with-tests')
    const snapshot = runner.snapshot()
    const { requests } = provider(answer(), answer())
    const disabled = agent({ skills: false })
    disabled.restore(snapshot)
    await disabled.run('continue')
    expect(JSON.stringify(requests[0])).not.toContain('GUIDE_VERSION_ONE')
    runner.deactivateSkill('fix-with-tests')
    expect(runner.snapshot().skills?.selected ?? []).toEqual([])
    await runner.run('continue')
    expect(currentContext(requests[1])).not.toContain('GUIDE_VERSION_ONE')
  })

  it('validates restored skill selection before replacing any conversation state', async () => {
    const runner = agent()
    provider(answer())
    await runner.run('existing')
    const old = runner.snapshot()
    expect(() => runner.restore({ ...old, skills: { version: 9, selected: [] } })).toThrow()
    expect(runner.snapshot()).toEqual(old)
  })

  it('persists selected identities at real execution boundaries, without guide bytes', async () => {
    await skill()
    const boundaries: unknown[] = []
    provider(reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })), answer())
    const runner = agent({
      executionPersistence: async snapshot => {
        boundaries.push(structuredClone(snapshot))
      },
    })
    await runner.run('repair')
    expect(JSON.stringify(boundaries)).not.toContain('GUIDE_VERSION_ONE')
    expect(
      boundaries.some(
        value => (value as { skills?: { selected: unknown[] } }).skills?.selected.length === 1
      )
    ).toBe(true)
    paired(runner)
  })

  it('counts active guide bytes and refuses an oversized request before transport', async () => {
    await skill('ACTIVE_ONLY_SENTINEL ' + 'x'.repeat(16000))
    const { requests } = provider()
    const runner = agent({
      skills: { selected: ['fix-with-tests'] },
      context: { maxInputTokens: 8000, summaryTokens: 256 },
    })
    await expect(runner.run('repair')).rejects.toThrow()
    expect(requests).toHaveLength(0)
    const loader = new Skills(root, { selected: ['fix-with-tests'] })
    await loader.refresh(new PermissionController({ mode: 'accept-edits' }))
    expect(
      JSON.stringify(
        loader.overlay({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 512,
          messages: [{ role: 'user', content: 'repair' }],
        })
      )
    ).toContain('ACTIVE_ONLY_SENTINEL')
  })

  it('charges loading and resource reads against the same turn tool budget', async () => {
    await skill()
    await file('.agents/skills/fix-with-tests/references/report.txt', 'bounded evidence')
    const { requests } = provider(
      reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })),
      reply(
        tool('read', 'read_skill_resource', {
          skill: 'fix-with-tests',
          path: 'references/report.txt',
        })
      )
    )
    const runner = agent({ limits: { maxToolCalls: 1 } })
    await expect(runner.run('repair')).rejects.toThrow()
    expect(requests).toHaveLength(2)
    expect(
      runner.getSkills().entries.find(e => e.name === 'fix-with-tests')?.resources ?? []
    ).toEqual([])
    paired(runner)
  })

  it('keeps scoped project instructions and selected skills together through a nested replan', async () => {
    await skill()
    await file('AGENTS.md', 'ROOT_RULE_SENTINEL')
    await file('api/AGENTS.md', 'API_RULE_SENTINEL')
    const { requests } = provider(
      reply(tool('load', 'load_skill', { skill: 'fix-with-tests' })),
      reply(
        tool('nested-before-rules', 'write_file', { path: 'api/effect.txt', content: 'unexecuted' })
      ),
      reply(
        tool('nested-after-rules', 'write_file', {
          path: 'api/effect.txt',
          content: 'with both contexts',
        })
      ),
      answer()
    )
    const write = vi.spyOn(writeFileTool, 'execute')
    const runner = agent()
    await runner.run('repair')
    expect(JSON.stringify(requests[2])).toContain('GUIDE_VERSION_ONE')
    expect(JSON.stringify(requests[2])).toContain('API_RULE_SENTINEL')
    expect(JSON.stringify(requests[2])).toContain('ROOT_RULE_SENTINEL')
    expect(write).toHaveBeenCalledOnce()
    expect(await readFile(join(root, 'api/effect.txt'), 'utf8')).toBe('with both contexts')
    paired(runner)
  })

  it('retains trusted external read paths when an escaped result is spooled and restored', async () => {
    const external = await realpath(await mkdtemp(join(tmpdir(), 'z2a-skills-source-')))
    try {
      const source = join(external, 'reference.txt')
      await writeFile(source, 'external bytes')
      const execute = vi.fn(async () => 'x'.repeat(30_000))
      const original = agent({
        permissions: { mode: 'bypass' },
        results: { directory: join(root, 'result-bodies') },
        tools: [
          {
            name: 'read_fixture',
            description: 'Read a registered fixture',
            permission: { effect: 'read' },
            readPaths: async () => [source],
            input_schema: { type: 'object', properties: {} },
            execute,
          },
        ],
      })
      provider(reply(tool('source', 'read_fixture', {})), answer())
      await original.run('read')
      const snapshot = original.snapshot()
      const entry = snapshot.results!.entries[0]
      expect(entry.source.paths).toContain(source)
      const { requests } = provider(
        reply(
          tool('recall', 'read_tool_result', { reference: entry.reference, offset: 0, limit: 32 })
        ),
        answer()
      )
      const restored = agent({
        permissions: { mode: 'read-only' },
        results: { directory: join(root, 'result-bodies') },
      })
      restored.restore(snapshot)
      await restored.run('recall')
      const content = JSON.stringify(requests[1].messages.at(-1))
      expect(content).toContain('Read-only mode permits only workspace reads')
      expect(content).not.toContain('xxxxxxxx')
      expect(execute).toHaveBeenCalledOnce()
      paired(restored)
    } finally {
      await rm(external, { recursive: true, force: true })
    }
  })
})
