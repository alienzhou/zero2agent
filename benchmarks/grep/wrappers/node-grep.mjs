import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const caseInsensitive = args.includes('-i')
const positional = args.filter(a => a !== '-i')
const [pattern, dir] = positional
const re = new RegExp(pattern, caseInsensitive ? 'i' : '')

async function walk(d) {
  for (const ent of await readdir(d, { withFileTypes: true })) {
    const p = join(d, ent.name)
    if (ent.isDirectory()) { await walk(p); continue }
    const text = await readFile(p, 'utf8').catch(() => null)
    if (!text) continue
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) process.stdout.write(`${p}:${i + 1}:${line}\n`)
    })
  }
}
await walk(dir)
