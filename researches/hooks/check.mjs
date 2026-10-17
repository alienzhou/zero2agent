/** Synthetic checks; default output is control JSON, never application data. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const mode = process.argv[2] ?? 'normal'
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const audit = v => {
  if (process.env.HOOK_AUDIT)
    fs.appendFileSync(
      process.env.HOOK_AUDIT,
      JSON.stringify({ pid: process.pid, stage: input.stage, checkId: input.checkId, ...v }) + '\n'
    )
}
audit({ event: 'start', envKeys: Object.keys(process.env), input })
if (mode === 'invalid') {
  process.stdout.write('not-json')
  process.exit(0)
}
if (mode === 'extra') {
  console.log(JSON.stringify({ version: 1, decision: 'pass', updatedInput: { x: 1 } }))
  process.exit(0)
}
if (mode === 'nonzero') process.exit(2)
if (mode === 'oversize') {
  process.stdout.write('x'.repeat(4097))
  process.exit(0)
}
if (mode === 'stderr') {
  process.stderr.write('x'.repeat(16385))
  process.exit(0)
}
if (mode === 'utf8') {
  process.stdout.write(Buffer.from([0xc0, 0x80]))
  process.exit(0)
}
if (
  mode === 'hang' ||
  (mode === 'hang-after' && input.stage === 'afterTool' && !fs.existsSync('allow-check'))
) {
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
} else {
  let blocked = mode === 'block' || (mode === 'toggle' && !fs.existsSync('allow-check'))
  if (input.stage === 'beforeTool' && input.tool?.paths.some(p => p.endsWith('/readonly.json')))
    blocked = true
  if (mode === 'mutate') fs.writeFileSync('watched.txt', 'changed by checker')
  if (
    mode === 'normal' &&
    input.stage === 'afterTool' &&
    input.tool?.paths.some(p => p.endsWith('/change-report.json'))
  ) {
    try {
      JSON.parse(fs.readFileSync('artifacts/change-report.json', 'utf8'))
    } catch {
      blocked = true
    }
  }
  if (mode === 'normal' && input.stage === 'beforeComplete') {
    try {
      const text = execFileSync(process.execPath, ['--test', 'packages/api/amount.test.mjs'], {
        encoding: 'utf8',
        env: {},
        timeout: 1000,
      })
      audit({ event: 'tests', passed: true, output: text })
    } catch {
      blocked = true
      audit({ event: 'tests', passed: false })
    }
  }
  audit({ event: 'settled', decision: blocked ? 'block' : 'pass' })
  process.stdout.write(JSON.stringify({ version: 1, decision: blocked ? 'block' : 'pass' }))
}
