import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { allTools, getBaseShellEnv, terminalTool } from '../../index.js'
import type {
  HumanTerminalRequest,
  HumanTerminalResult,
  TerminalRuntimeHooks,
} from '../../index.js'
import { buildSpawnEnv, consumeShellEnvFailureNotice } from '../shell-env.js'
import { resetTerminalRuntimeHooksForTests, setTerminalRuntimeHooks } from '../terminal-runtime.js'

// Fail closed if the interactive branch accidentally reaches process creation.
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(() => {
    throw new Error('Unexpected process creation')
  }),
}))

vi.mock('../shell-env.js', () => ({
  getBaseShellEnv: vi.fn(() => ({})),
  buildSpawnEnv: vi.fn(() => ({})),
  consumeShellEnvFailureNotice: vi.fn(() => false),
}))

let cwd: string
const runInteractive = vi.fn<(request: HumanTerminalRequest) => Promise<HumanTerminalResult>>()
const command = 'human-only-command'

beforeEach(async () => {
  vi.clearAllMocks()
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-human-terminal-'))
  runInteractive.mockResolvedValue({ status: 'completed', exitCode: 0 })
  const hooks: TerminalRuntimeHooks = { isTTY: true, runInteractive }
  setTerminalRuntimeHooks(hooks)
})

afterEach(async () => {
  resetTerminalRuntimeHooksForTests()
  await fs.rm(cwd, { recursive: true, force: true })
  expect(spawn).not.toHaveBeenCalled()
  expect(buildSpawnEnv).not.toHaveBeenCalled()
  expect(consumeShellEnvFailureNotice).not.toHaveBeenCalled()
})

const execute = (extra: Record<string, unknown> = {}) =>
  terminalTool.execute({ command, interactive: true, ...extra }, { cwd })

describe('human-controlled terminal', () => {
  it('keeps eight tools and exposes the host environment helper', () => {
    expect(allTools).toHaveLength(8)
    expect(allTools.filter(tool => tool.name === 'terminal')).toEqual([terminalTool])
    expect(getBaseShellEnv).toBeTypeOf('function')
    expect(terminalTool.input_schema.properties).toHaveProperty('interactive.type', 'boolean')
  })

  it('passes only command and resolved cwd, returning metadata without interactive content', async () => {
    await fs.mkdir(path.join(cwd, 'subdir'))
    // Even if the host has extra runtime fields, none are serialized into the receipt.
    runInteractive.mockResolvedValue({
      status: 'completed',
      exitCode: 0,
      output: 'private transcript',
    } as HumanTerminalResult)
    expect(await execute({ workdir: 'subdir', text: 'private input' })).toBe(
      'Status: human-controlled completed\nExit code: 0\nInteractive content was not recorded or sent to the model.'
    )
    expect(runInteractive).toHaveBeenCalledExactlyOnceWith({
      command,
      cwd: await fs.realpath(path.join(cwd, 'subdir')),
    })
  })

  it('preserves nonzero exit codes without treating them as tool errors', async () => {
    runInteractive.mockResolvedValue({ status: 'completed', exitCode: 23 })
    expect(await execute()).toBe(
      'Status: human-controlled completed\nExit code: 23\nInteractive content was not recorded or sent to the model.'
    )
  })

  it('reports refusal without inventing successful execution or retrying', async () => {
    runInteractive.mockResolvedValue({ status: 'declined' })
    expect(await execute()).toBe(
      'Status: human-controlled declined\nUser declined execution. Do not automatically retry.\nInteractive content was not recorded or sent to the model.'
    )
    expect(runInteractive).toHaveBeenCalledTimes(1)
  })

  it('reports cancellation and its known signal, without inventing an exit code', async () => {
    runInteractive.mockResolvedValue({ status: 'cancelled', signal: 2 })
    expect(await execute()).toBe(
      'Status: human-controlled cancelled\nSignal: 2\nInteractive content was not recorded or sent to the model.'
    )
  })

  it('does not invent an exit code for completed sessions', async () => {
    runInteractive.mockResolvedValue({ status: 'completed' })
    expect(await execute()).not.toContain('Exit code:')
  })

  it('requires host support even when a TTY is present', async () => {
    setTerminalRuntimeHooks({ isTTY: true })
    expect(await execute()).toMatch(/^Error:.*interactive CLI\/TTY/)
    expect(runInteractive).not.toHaveBeenCalled()
  })

  it('requires a TTY even when a host hook exists', async () => {
    setTerminalRuntimeHooks({ isTTY: false, runInteractive })
    expect(await execute()).toMatch(/^Error:.*interactive CLI\/TTY/)
    expect(runInteractive).not.toHaveBeenCalled()
  })

  it('catches host exceptions without leaking their contents', async () => {
    runInteractive.mockRejectedValue(new Error(`private transcript ${command}`))
    const result = await execute()
    expect(result).toMatch(/^Error:/)
    expect(result).not.toContain('private transcript')
    expect(result).not.toContain(command)
  })

  it.each([null, 'true', 1, {}, []])('rejects non-boolean interactive: %j', async interactive => {
    expect(await execute({ interactive })).toBe('Error: interactive must be a boolean')
    expect(runInteractive).not.toHaveBeenCalled()
  })

  it('rejects workspace escape before invoking the host', async () => {
    expect(await execute({ workdir: '..' })).toMatch(/^Error:.*outside the workspace/)
    expect(runInteractive).not.toHaveBeenCalled()
  })

  it('rejects missing workdirs before invoking the host', async () => {
    expect(await execute({ workdir: 'missing' })).toMatch(/^Error: workdir not found/)
    expect(runInteractive).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 123])('retains command validation: %j', async invalidCommand => {
    expect(await execute({ command: invalidCommand })).toBe('Error: command must not be empty')
    expect(runInteractive).not.toHaveBeenCalled()
  })
})
