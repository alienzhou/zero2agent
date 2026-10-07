import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { terminalTool } from '../terminal.js'
import { resetTerminalRuntimeHooksForTests } from '../terminal-runtime.js'

afterEach(() => resetTerminalRuntimeHooksForTests())

describe('terminal turn cancellation', () => {
  it('stops the foreground process group and retains output and prior file changes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'z2a-turn-cancel-'))
    const controller = new AbortController()
    try {
      const pending = terminalTool.execute(
        { command: "printf 'saved' > evidence.txt; echo ready; sleep 30; echo wrong > later.txt" },
        { cwd, signal: controller.signal }
      )
      // Wait for observable side effects rather than guessing when bash starts.
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        try {
          if ((await readFile(join(cwd, 'evidence.txt'), 'utf8')) === 'saved') break
        } catch {
          /* starting */
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(await readFile(join(cwd, 'evidence.txt'), 'utf8')).toBe('saved')
      controller.abort()
      const output = await pending
      expect(output).toContain('Status: cancelled by user')
      expect(output).toContain('ready')
      expect(await readFile(join(cwd, 'evidence.txt'), 'utf8')).toBe('saved')
      await expect(readFile(join(cwd, 'later.txt'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      controller.abort()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 10000)
})
