#!/usr/bin/env node
/**
 * E02-S003 验收报告生成器
 * 运行 core + e2e 测试，输出单文件 HTML 报告（含 demo 录屏文字稿）
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_DIR = path.join(ROOT, 'reports')
const JSON_OUT = path.join(REPORT_DIR, 'vitest-results.json')
const HTML_OUT = path.join(REPORT_DIR, 'E02-S003-acceptance.html')
const DEMO_OUT = path.join(REPORT_DIR, 'E02-S003-demo-transcript.txt')

function run(cmd, args, cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', env: process.env })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return { loaded: false, hasKey: false }
  try {
    process.loadEnvFile(envPath)
    return { loaded: true, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) }
  } catch {
    return { loaded: false, hasKey: false }
  }
}

function recordDemoTranscript() {
  const lines = []
  const log = (s) => {
    lines.push(s)
  }

  log('# E02-S003 terminal demo transcript')
  log(`# generated: ${new Date().toISOString()}`)
  log('')

  const demos = [
    ['echo hello', '基础执行 + exit code'],
    ['exit 1', '非零退出（普通回执）'],
    ['for i in $(seq 1 5); do echo line_$i; done', '短输出（无落盘）'],
  ]

  for (const [cmd, title] of demos) {
    log(`## ${title}`)
    log(`$ terminal "${cmd}"`)
    const r = run('node', [
      '--input-type=module',
      '-e',
      `import { terminalTool } from './packages/core/dist/tools/terminal.js';
const r = await terminalTool.execute({ command: ${JSON.stringify(cmd)} }, { cwd: process.cwd() });
console.log(r);`,
    ])
    log(r.stdout.trim() || r.stderr.trim())
    log('')
  }

  fs.writeFileSync(DEMO_OUT, lines.join('\n'), 'utf-8')
  return lines.join('\n')
}

function mergeVitestJson(paths) {
  const suites = []
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const p of paths) {
    if (!fs.existsSync(p)) continue
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    for (const file of data.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        const status = assertion.status
        if (status === 'passed') passed++
        else if (status === 'failed') failed++
        else skipped++
        suites.push({
          file: file.name.replace(ROOT + '/', ''),
          name: assertion.fullName ?? assertion.title,
          status,
          duration: assertion.duration,
        })
      }
    }
  }

  return { passed, failed, skipped, suites }
}

function buildHtml({ env, stats, demo, gitSha }) {
  const rows = stats.suites
    .map(
      s => `<tr class="${s.status}">
        <td>${escapeHtml(s.status)}</td>
        <td><code>${escapeHtml(s.file)}</code></td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.duration ?? '-'}ms</td>
      </tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>E02-S003 terminal 验收报告</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 1100px; color: #1a1a1a; }
    h1 { border-bottom: 2px solid #333; padding-bottom: .5rem; }
    .meta { background: #f6f8fa; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    .pass { color: #1a7f37; } .fail { color: #cf222e; } .skipped { color: #9a6700; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; }
    tr.failed { background: #fff5f5; }
    pre { background: #0d1117; color: #c9d1d9; padding: 1rem; overflow: auto; border-radius: 8px; font-size: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
    .badge-ok { background: #dafbe1; color: #1a7f37; }
    .badge-warn { background: #fff8c5; color: #9a6700; }
  </style>
</head>
<body>
  <h1>E02-S003 terminal 验收报告</h1>
  <div class="meta">
    <p><strong>设计基线</strong>：<code>b43663e</code>（定稿 spec D01-D05）</p>
    <p><strong>实现提交</strong>：<code>${escapeHtml(gitSha)}</code></p>
    <p><strong>生成时间</strong>：${new Date().toISOString()}</p>
    <p><strong>.env.local</strong>：${env.loaded ? '已加载' : '未找到（仅跑契约层）'}
      ${env.hasKey ? '<span class="badge badge-ok">ANTHROPIC_API_KEY 已配置</span>' : '<span class="badge badge-warn">真实 E2E 待 API KEY</span>'}</p>
    <p><strong>统计</strong>：
      <span class="pass">通过 ${stats.passed}</span> /
      <span class="fail">失败 ${stats.failed}</span> /
      <span class="skipped">跳过 ${stats.skipped}</span>
    </p>
  </div>

  <h2>测试明细</h2>
  <table>
    <thead><tr><th>状态</th><th>文件</th><th>用例</th><th>耗时</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Demo 录屏文字稿（本地 terminal 执行实录）</h2>
  <p>未安装视频录制工具时，以命令回执实录代替；配置 API KEY 后可补跑 <code>E2E_LIVE=1</code> 真实层。</p>
  <pre>${escapeHtml(demo)}</pre>

  <h2>验收范围说明</h2>
  <ul>
    <li>单测：<code>terminal.test.ts</code> + <code>terminal-acceptance.test.ts</code>（对齐 checklist）</li>
    <li>E2E 契约：<code>terminal-contract.test.ts</code> + <code>cli-contract.test.ts</code></li>
    <li>E2E 真实层：<code>cli-live.test.ts</code> terminal 段（需 <code>E2E_LIVE=1</code> + API KEY）</li>
  </ul>
</body>
</html>`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true })

  const env = loadEnvLocal()

  console.log('→ pnpm build')
  const build = run('pnpm', ['build'])
  if (build.code !== 0) {
    console.error(build.stderr)
    process.exit(1)
  }

  const coreJson = path.join(REPORT_DIR, 'core-vitest.json')
  const e2eJson = path.join(REPORT_DIR, 'e2e-vitest.json')

  console.log('→ core tests (json reporter)')
  run('pnpm', ['--filter', '@zero2agent/core', 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${coreJson}`])

  console.log('→ e2e contract tests (json reporter)')
  run('pnpm', ['--filter', '@zero2agent/e2e', 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${e2eJson}`])

  const stats = mergeVitestJson([coreJson, e2eJson])
  const demo = recordDemoTranscript()

  const gitSha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()
  const html = buildHtml({ env, stats, demo, gitSha })
  fs.writeFileSync(HTML_OUT, html, 'utf-8')

  console.log(`\n✓ HTML report: ${HTML_OUT}`)
  console.log(`✓ Demo transcript: ${DEMO_OUT}`)
  console.log(`  passed=${stats.passed} failed=${stats.failed} skipped=${stats.skipped}`)

  if (stats.failed > 0) process.exit(1)
}

main()
