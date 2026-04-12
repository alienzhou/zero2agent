import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  getSessionPath,
  readSessionFile,
  removeSessionFile,
  writeSessionFile,
} from '../session-file.js'
import type { CdpDebugSessionFile } from '../types.js'

describe('session-file', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdp-debug-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes and reads session file', async () => {
    const data: CdpDebugSessionFile = {
      pid: 1,
      serverPort: 7492,
      inspectPort: 9229,
      cwd: dir,
      targetEntry: 'dist/cli.js',
      startedAt: new Date().toISOString(),
    }
    await writeSessionFile(dir, data)
    expect(await readSessionFile(dir)).toEqual(data)
    expect(getSessionPath(dir)).toBe(path.join(dir, '.cdp-debug.json'))
    await removeSessionFile(dir)
    await expect(readSessionFile(dir)).rejects.toThrow()
  })
})
