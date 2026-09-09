#!/usr/bin/env node
/**
 * 运行 terminal 五个特殊设计点 — 按文件拆分的 live E2E，收集 vitest 报告
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'reports', 'terminal-special-live')
const JSON_OUT = path.join(OUT_DIR, 'vitest-results.json')
const TXT_OUT = path.join(OUT_DIR, 'E02-S003-special-live-transcript.txt')
const MD_OUT = path.join(OUT_DIR, 'E02-S003-special-live-summary.md')
const MANIFEST = path.join(OUT_DIR, 'live-test-files.json')

const LIVE_FILES = [
  'e2e/src/terminal-live/d01-tool-baseline.live.test.ts',
  'e2e/src/terminal-live/d02-no-truncate.live.test.ts',
  'e2e/src/terminal-live/d03-no-kill.live.test.ts',
  'e2e/src/terminal-live/d04-lifecycle.live.test.ts',
  'e2e/src/terminal-live/d05-exec-env.live.test.ts',
]

function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local')
  if (fs.existsSync(p)) process.loadEnvFile(p)
}

function main() {
  loadEnvLocal()
  if (process.env.E2E_LIVE !== '1' || !process.env.ANTHROPIC_API_KEY) {
    console.error('需要 .env.local: E2E_LIVE=1 + ANTHROPIC_API_KEY')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(MANIFEST, JSON.stringify({ files: LIVE_FILES }, null, 2))

  console.log('→ pnpm build')
  const build = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf-8' })
  if (build.status !== 0) {
    console.error(build.stderr)
    process.exit(1)
  }

  console.log('→ terminal-live/*.live.test.ts (5 files)')
  const run = spawnSync(
    'pnpm',
    [
      '--filter',
      '@zero2agent/e2e',
      'exec',
      'vitest',
      'run',
      'src/terminal-live/',
      '--reporter=verbose',
      '--reporter=json',
      `--outputFile=${JSON_OUT}`,
    ],
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, env: process.env }
  )

  const combined = [run.stdout, run.stderr].filter(Boolean).join('\n')
  fs.writeFileSync(TXT_OUT, combined, 'utf-8')

  let passed = 0
  let failed = 0
  const byFile = []
  const cases = []
  if (fs.existsSync(JSON_OUT)) {
    const data = JSON.parse(fs.readFileSync(JSON_OUT, 'utf-8'))
    for (const file of data.testResults ?? []) {
      const rel = file.name.replace(ROOT + '/', '')
      let fp = 0
      let ff = 0
      for (const a of file.assertionResults ?? []) {
        if (a.status === 'passed') {
          passed++
          fp++
        } else if (a.status === 'failed') {
          failed++
          ff++
        }
        cases.push({ file: rel, name: a.fullName ?? a.title, status: a.status, duration: a.duration })
      }
      byFile.push({ file: rel, passed: fp, failed: ff, total: fp + ff })
    }
  }

  const md = `# E02-S003 五个特殊设计点 — Live E2E 摘要（按设计点拆分）

- 生成：${new Date().toISOString()}
- 设计基线：\`b43663e\` / specs/E02-S003-terminal/README.md
- 目录：\`e2e/src/terminal-live/\`（5 个文件，每议题 1 文件 × 3 条）
- 结果：**${passed} passed / ${failed} failed**（共 ${cases.length} 条）

## 按文件

| 文件 | 通过 | 失败 | 合计 |
|------|------|------|------|
${byFile.map(f => `| \`${f.file}\` | ${f.passed} | ${f.failed} | ${f.total} |`).join('\n')}

## 用例明细

| 文件 | 状态 | 用例 | 耗时 |
|------|------|------|------|
${cases.map(c => `| \`${path.basename(c.file)}\` | ${c.status} | ${c.name.replace(/\|/g, '\\|')} | ${c.duration ?? '-'}ms |`).join('\n')}

## 说明

- 每条均为 \`node packages/tui/dist/cli.js\` + 真实 LLM（.env.local，密钥未入库）
- 契约层缺口已补：\`terminal-contract.test.ts\` 新增 exit 7 / stderr 合流 2 条（无 LLM）
- Ctrl-X / Ctrl-S / watcher（防线② SIGKILL）等人机边界由 core PTY 单测覆盖
- 本报告未自行宣判通过
`
  fs.writeFileSync(MD_OUT, md, 'utf-8')

  console.log(`\n✓ ${MD_OUT}`)
  console.log(`✓ ${TXT_OUT}`)
  console.log(`  passed=${passed} failed=${failed}`)
  process.exit(run.status ?? 1)
}

main()
