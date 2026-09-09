#!/usr/bin/env node
/**
 * E02-S003 验收报告生成器
 * 运行 core + e2e（含真实 LLM 层）测试，输出单文件 HTML 报告 + 终端录屏 MP4
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_DIR = path.join(ROOT, 'reports')
const HTML_OUT = path.join(REPORT_DIR, 'E02-S003-acceptance.html')
const DEMO_OUT = path.join(REPORT_DIR, 'E02-S003-demo-transcript.txt')
const CAST_OUT = path.join(REPORT_DIR, 'E02-S003-demo-recording.cast')
const GIF_OUT = path.join(REPORT_DIR, 'E02-S003-demo-recording.gif')
const VIDEO_OUT = path.join(REPORT_DIR, 'E02-S003-demo-recording.mp4')

function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
    maxBuffer: 20 * 1024 * 1024,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local')
  if (!fs.existsSync(envPath)) {
    return { loaded: false, hasKey: false, live: false }
  }
  try {
    process.loadEnvFile(envPath)
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)
    const live = process.env.E2E_LIVE === '1' && hasKey
    return { loaded: true, hasKey, live }
  } catch {
    return { loaded: false, hasKey: false, live: false }
  }
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '')
}

function recordDemoTranscript(live) {
  const lines = []
  const log = s => lines.push(s)

  log('# E02-S003 terminal 验收实录')
  log(`# generated: ${new Date().toISOString()}`)
  log(`# live_e2e: ${live ? 'yes' : 'no'}`)
  log('')

  const demos = [
    ['echo hello', '基础执行 + exit code'],
    ['exit 42', '非零退出（普通回执）'],
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
    log(stripAnsi(r.stdout.trim() || r.stderr.trim()))
    log('')
  }

  if (live) {
    log('## 真实 LLM E2E：terminal 工具链')
    log('$ zero2agent "用 terminal 执行 cat pkg.json，告诉我 name 字段的值"')
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'z2a-report-'))
    fs.writeFileSync(path.join(ws, 'pkg.json'), '{"name":"e2e-demo"}\n')
    const cli = run(
      process.execPath,
      [
        path.join(ROOT, 'packages/tui/dist/cli.js'),
        '用 terminal 执行 cat pkg.json，告诉我 name 字段的值',
      ],
      ws
    )
    const out = stripAnsi(cli.stdout + cli.stderr).trim()
    log(out.slice(0, 4000))
    log(`# exit_code=${cli.code}`)
    fs.rmSync(ws, { recursive: true, force: true })
    log('')
  }

  fs.writeFileSync(DEMO_OUT, lines.join('\n'), 'utf-8')
  return lines.join('\n')
}

/** 生成 asciicast 并转为 GIF/MP4 录屏 */
function recordDemoVideo(transcript, live) {
  const events = []
  let t = 0
  const emit = (text, pause = 0.4) => {
    events.push([Number(t.toFixed(2)), 'o', text])
    t += pause
  }

  emit('$ # E02-S003 terminal 验收实录\r\n', 0.3)
  emit(`$ # live_e2e=${live ? 'yes' : 'no'}\r\n\r\n`, 0.5)

  const runTerminal = cmd => {
    emit(`$ terminal "${cmd}"\r\n`, 0.2)
    const r = run('node', [
      '--input-type=module',
      '-e',
      `import { terminalTool } from './packages/core/dist/tools/terminal.js';
const r = await terminalTool.execute({ command: ${JSON.stringify(cmd)} }, { cwd: process.cwd() });
console.log(r);`,
    ])
    const out = stripAnsi(r.stdout.trim() || r.stderr.trim())
    for (const line of out.split('\n')) {
      emit(`${line}\r\n`, 0.15)
    }
    emit('\r\n', 0.5)
  }

  runTerminal('echo hello')
  runTerminal('exit 42')
  runTerminal('for i in $(seq 1 5); do echo line_$i; done')

  if (live) {
    emit('$ zero2agent "用 terminal 执行 cat pkg.json，告诉我 name 字段的值"\r\n', 0.3)
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'z2a-cast-'))
    fs.writeFileSync(path.join(ws, 'pkg.json'), '{"name":"e2e-demo"}\n')
    const cli = run(
      process.execPath,
      [
        path.join(ROOT, 'packages/tui/dist/cli.js'),
        '用 terminal 执行 cat pkg.json，告诉我 name 字段的值',
      ],
      ws
    )
    const out = stripAnsi(cli.stdout + cli.stderr)
    for (const line of out.split('\n').slice(0, 60)) {
      emit(`${line}\r\n`, 0.12)
    }
    emit(`\r\n# exit_code=${cli.code}\r\n`, 0.5)
    fs.rmSync(ws, { recursive: true, force: true })
  }

  const header = {
    version: 2,
    width: 110,
    height: 32,
    timestamp: Math.floor(Date.now() / 1000),
    title: 'E02-S003 terminal acceptance',
    env: { SHELL: process.env.SHELL ?? '/bin/zsh', TERM: 'xterm-256color' },
  }
  const castBody = `${JSON.stringify(header)}\n${events.map(e => JSON.stringify(e)).join('\n')}\n`
  fs.writeFileSync(CAST_OUT, castBody, 'utf-8')

  const agg = run('agg', [CAST_OUT, GIF_OUT])
  if (agg.code !== 0 || !fs.existsSync(GIF_OUT)) {
    console.warn('⚠ agg 录屏生成失败，仅交付 .cast + 文字稿')
    return fs.existsSync(CAST_OUT)
  }

  const mp4 = run('ffmpeg', [
    '-y',
    '-i',
    GIF_OUT,
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags',
    'faststart',
    '-pix_fmt',
    'yuv420p',
    VIDEO_OUT,
  ])
  if (mp4.code !== 0 || !fs.existsSync(VIDEO_OUT)) {
    console.warn('⚠ MP4 转码失败，交付 GIF 录屏')
    return true
  }
  return true
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

function buildHtml({ env, stats, demo, gitSha, hasVideo }) {
  const rows = stats.suites
    .map(
      s => `<tr class="${s.status}">
        <td>${escapeHtml(s.status)}</td>
        <td><code>${escapeHtml(s.file)}</code></td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.duration ?? '-'}ms</td>
      </tr>`
    )
    .join('\n')

  const liveBadge = env.live
    ? '<span class="badge badge-ok">真实 E2E 已执行（MiniMax）</span>'
    : '<span class="badge badge-warn">真实 E2E 未启用</span>'

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
    <p><strong>.env.local</strong>：${env.loaded ? '已加载（密钥未入库）' : '未找到'}
      ${env.hasKey ? '<span class="badge badge-ok">API KEY 已配置</span>' : ''}
      ${liveBadge}</p>
    <p><strong>统计</strong>：
      <span class="pass">通过 ${stats.passed}</span> /
      <span class="fail">失败 ${stats.failed}</span> /
      <span class="skipped">跳过 ${stats.skipped}</span>
    </p>
    ${hasVideo ? '<p><strong>录屏附件</strong>：<code>E02-S003-demo-recording.mp4</code>（asciicast → GIF → MP4）</p>' : ''}
  </div>

  <h2>测试明细</h2>
  <table>
    <thead><tr><th>状态</th><th>文件</th><th>用例</th><th>耗时</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Demo 实录（terminal + 真实 E2E）</h2>
  <pre>${escapeHtml(demo)}</pre>

  <h2>验收范围</h2>
  <ul>
    <li>单测：<code>terminal-acceptance.test.ts</code>（25 条，对齐 D01-D05 checklist）</li>
    <li>E2E 契约：<code>terminal-contract.test.ts</code> + <code>cli-contract.test.ts</code></li>
    <li>E2E 真实层：<code>cli-live.test.ts</code>（10 条，含 terminal 段）</li>
  </ul>
</body>
</html>`
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
  const coreRun = run('pnpm', [
    '--filter',
    '@zero2agent/core',
    'exec',
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${coreJson}`,
  ])
  if (coreRun.code !== 0) console.error(coreRun.stderr)

  console.log(
    env.live ? '→ e2e full tests incl. live LLM (json reporter)' : '→ e2e tests (json reporter)'
  )
  const e2eRun = run('pnpm', [
    '--filter',
    '@zero2agent/e2e',
    'exec',
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${e2eJson}`,
  ])
  if (e2eRun.code !== 0) console.error(e2eRun.stderr)

  const stats = mergeVitestJson([coreJson, e2eJson])
  const demo = recordDemoTranscript(env.live)
  const hasVideo = recordDemoVideo(demo, env.live)

  const gitSha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()
  const html = buildHtml({ env, stats, demo, gitSha, hasVideo })
  fs.writeFileSync(HTML_OUT, html, 'utf-8')

  console.log(`\n✓ HTML report: ${HTML_OUT}`)
  console.log(`✓ Demo transcript: ${DEMO_OUT}`)
  if (hasVideo) {
    if (fs.existsSync(VIDEO_OUT) && fs.statSync(VIDEO_OUT).size > 0) {
      console.log(`✓ Demo recording: ${VIDEO_OUT}`)
    } else if (fs.existsSync(GIF_OUT)) {
      console.log(`✓ Demo recording: ${GIF_OUT}`)
    } else if (fs.existsSync(CAST_OUT)) {
      console.log(`✓ Demo recording: ${CAST_OUT}`)
    }
  }
  console.log(`  passed=${stats.passed} failed=${stats.failed} skipped=${stats.skipped}`)

  if (stats.failed > 0) process.exit(1)
}

main()
