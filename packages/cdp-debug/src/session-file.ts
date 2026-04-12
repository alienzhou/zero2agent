import fs from 'node:fs/promises'
import path from 'node:path'
import type { CdpDebugSessionFile } from './types.js'

export const SESSION_FILENAME = '.cdp-debug.json'

export function getSessionPath(cwd: string): string {
  return path.join(cwd, SESSION_FILENAME)
}

export async function readSessionFile(cwd: string): Promise<CdpDebugSessionFile> {
  const p = getSessionPath(cwd)
  const raw = await fs.readFile(p, 'utf8')
  return JSON.parse(raw) as CdpDebugSessionFile
}

export async function writeSessionFile(cwd: string, data: CdpDebugSessionFile): Promise<void> {
  const p = getSessionPath(cwd)
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8')
}

export async function removeSessionFile(cwd: string): Promise<void> {
  const p = getSessionPath(cwd)
  await fs.rm(p, { force: true })
}
