import { afterEach, describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import { terminalTool } from '../terminal.js'
import { resetTerminalRuntimeHooksForTests, setTerminalRuntimeHooks } from '../terminal-runtime.js'

afterEach(() => resetTerminalRuntimeHooksForTests())

describe.skipIf(process.platform === 'win32')('terminal default routing', () => {
  it.each([undefined, false])(
    'keeps interactive=%s on the non-interactive path',
    async interactive => {
      const runInteractive = vi.fn()
      setTerminalRuntimeHooks({ isTTY: true, runInteractive })
      const result = await terminalTool.execute(
        { command: 'printf NONINTERACTIVE', interactive },
        { cwd: os.tmpdir() }
      )
      expect(result).toContain('Exit code: 0')
      expect(result).toContain('NONINTERACTIVE')
      expect(result).toContain('<untrusted_command_output')
      expect(runInteractive).not.toHaveBeenCalled()
    }
  )
})
