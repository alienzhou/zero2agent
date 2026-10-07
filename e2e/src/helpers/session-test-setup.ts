import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Isolate automatically saved CLI conversations from the developer's real home. */
export default async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-test-sessions-'))
  process.env.ZERO2AGENT_SESSION_DIR = root
  return async () => {
    await fs.rm(root, { recursive: true, force: true })
  }
}
