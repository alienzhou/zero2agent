// pnpm build && node researches/hooks/demo.mjs [--live]
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import {
  Agent,
  Hooks,
  allTools,
  buildSystemPrompt,
  getModelName,
  mcpToolName,
} from '../../packages/core/dist/index.js'
import * as cases from './cases.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url)),
  live = process.argv.includes('--live'),
  scopeBaseline = process.argv.includes('--scope-baseline')
if (process.argv.slice(2).some(a => !['--live', '--scope-baseline'].includes(a)))
  throw Error('Supported: --live, --scope-baseline')
if (live) {
  try {
    process.loadEnvFile(path.join(root, '.env.local'))
  } catch {}
  if (!process.env.ANTHROPIC_API_KEY) throw Error('Configure ANTHROPIC_API_KEY')
}
await fs.mkdir(path.join(root, 'tmp/e05-s004'), { recursive: true })
const output = await fs.mkdtemp(path.join(root, 'tmp/e05-s004', live ? 'live-' : 'offline-'))
const sha = b => createHash('sha256').update(b).digest('hex'),
  json = (f, v) => fs.writeFile(f, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 })
const report = {
  version: 1,
  fixtureVersion: cases.fixtureVersion,
  mode: live ? 'real-service' : 'deterministic-http',
  initialScopes: scopeBaseline ? [] : ['packages/api'],
  startedAt: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: { system: process.platform, architecture: process.arch, node: process.version },
  requestedModel: live ? getModelName({}) : 'deterministic-fixture',
  limits: cases.limits,
  sdkVersion: JSON.parse(
    await fs.readFile(
      path.join(root, 'packages/core/node_modules/@modelcontextprotocol/sdk/package.json'),
      'utf8'
    )
  ).version,
  frozenInputsSha256: sha(
    JSON.stringify({
      version: cases.fixtureVersion,
      limits: cases.limits,
      files: cases.files,
      normalTask: cases.normalTask,
      deniedTask: cases.deniedTask,
      contract: cases.contract,
    })
  ),
  frozenCasesSha256: sha(await fs.readFile(new URL('./cases.mjs', import.meta.url))),
  sourceHashes: {},
  runtimeHashes: {},
  cases: [],
  passed: false,
}
async function walk(dir) {
  const result = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory())
      result.push(...(await walk(path.join(dir, e.name))).map(n => e.name + '/' + n))
    else if (e.isFile()) result.push(e.name)
    else throw Error('Unexpected source entry')
  }
  return result.sort()
}
const sourceFiles = [
  'pnpm-lock.yaml',
  'researches/mcp/cases.mjs',
  'researches/hooks/cases.mjs',
  'researches/hooks/check.mjs',
  'researches/hooks/demo.mjs',
  'researches/mcp/demo.mjs',
  'researches/mcp/issue-server.mjs',
]
for (const pkg of ['core', 'tui', 'shared'])
  for (const part of ['src', 'dist'])
    for (const name of await walk(path.join(root, 'packages', pkg, part)))
      if (!name.includes('__tests__') && name.endsWith(part === 'src' ? '.ts' : '.js'))
        sourceFiles.push(`packages/${pkg}/${part}/${name}`)
for (const name of sourceFiles) {
  const bytes = await fs.readFile(path.join(root, name))
  ;(name.includes('/dist/') ? report.runtimeHashes : report.sourceHashes)[name] = sha(bytes)
  const dest = path.join(output, 'source', name)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, bytes, { mode: 0o600 })
}
await json(path.join(output, 'frozen-run.json'), report)
const tool = (id, name, input = {}) => ({ type: 'tool_use', id, name, input })
const mcp = (id, name) => tool(id, mcpToolName('issues', name))
function sse(res, blocks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', {
    message: {
      id: 'mcp-demo',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'deterministic-fixture',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  blocks.forEach((block, index) => {
    const t = block.type === 'tool_use'
    event('content_block_start', {
      index,
      content_block: t ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta: t
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: {
      stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage: { output_tokens: 1 },
  })
  event('message_stop', {})
  res.end()
}
function paired(messages) {
  const pending = new Set()
  for (const m of messages)
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'tool_use') pending.add(b.id)
      if (b.type === 'tool_result')
        assert(pending.delete(b.tool_use_id), 'Unknown/doubled tool result')
    }
  assert.equal(pending.size, 0)
}
for (const name of ['normal', 'denied']) {
  const dir = path.join(output, name),
    cwd = path.join(dir, 'workspace'),
    audit = path.join(dir, 'protocol.jsonl')
  await fs.mkdir(cwd, { recursive: true })
  for (const [f, text] of Object.entries(cases.files)) {
    await fs.mkdir(path.dirname(path.join(cwd, f)), { recursive: true })
    await fs.writeFile(path.join(cwd, f), text)
  }
  const requests = [],
    events = [],
    diagnostics = [],
    metadata = []
  let serverFailure
  const server = createServer(async (req, res) => {
    const control = new AbortController()
    res.on('close', () => control.abort())
    try {
      let body = ''
      for await (const c of req) {
        body += c
        assert(Buffer.byteLength(body) <= 4 * 1024 * 1024)
      }
      const request = JSON.parse(body)
      paired(request.messages)
      requests.push(request)
      await fs.appendFile(path.join(dir, 'requests.jsonl'), body + '\n', { mode: 0o600 })
      if (live) {
        const headers = Object.fromEntries(
          ['content-type', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'authorization']
            .filter(k => typeof req.headers[k] === 'string')
            .map(k => [k, req.headers[k]])
        )
        const response = await fetch(
          (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '') +
            req.url,
          {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.any([
              control.signal,
              AbortSignal.timeout(cases.limits.maxDurationMs),
            ]),
          }
        )
        res.writeHead(response.status, {
          'content-type': response.headers.get('content-type') ?? 'application/json',
        })
        for await (const c of response.body ?? []) {
          await fs.appendFile(path.join(dir, 'responses.raw'), c, { mode: 0o600 })
          res.write(c)
        }
        res.end()
      } else {
        const history = JSON.stringify(request.messages)
        const receipt = request.messages
          .flatMap(m => (Array.isArray(m.content) ? m.content : []))
          .filter(b => b.type === 'tool_result')
          .map(b => {
            try {
              return JSON.parse(b.content)
            } catch {
              return null
            }
          })
          .find(v => v?.kind === 'tool_result_reference')
        const sequence = [
          [
            mcp('issue', 'get_issue'),
            mcp('logs', 'get_logs'),
            tool('resource', 'read_skill_resource', {
              skill: 'fix-with-tests',
              path: 'references/report.json',
            }),
          ],
          [tool('tail', 'read_tool_result', { reference: receipt?.reference, tail: true })],
          [
            tool('source', 'read_file', { path: 'packages/api/amount.mjs' }),
            tool('test', 'read_file', { path: 'packages/api/amount.test.mjs' }),
          ],
          [
            tool('fix', 'write_file', {
              path: 'packages/api/amount.mjs',
              content: cases.fixedAmount,
            }),
            tool('regression', 'write_file', {
              path: 'packages/api/amount.test.mjs',
              content: cases.fixedTest,
            }),
          ],
          [
            tool('test-run', 'terminal', {
              command: `${JSON.stringify(process.execPath)} --test packages/api/amount.test.mjs`,
              workdir: '.',
            }),
          ],
          [
            tool('report', 'write_file', {
              path: 'artifacts/change-report.json',
              content: JSON.stringify(cases.reportValue),
            }),
          ],
          [{ type: 'text', text: 'Fixed ISSUE-42; tests and report verified.' }],
        ]
        const results = request.messages
          .flatMap(m => (Array.isArray(m.content) ? m.content : []))
          .filter(b => b.type === 'tool_result')
        const settled = id =>
          results.some(
            b => (b.tool_use_id === id || b.tool_use_id === id + '-current') && !b.is_error
          )
        const phase = !settled('issue')
          ? 0
          : !settled('tail')
            ? 1
            : !settled('source')
              ? 2
              : !settled('fix')
                ? 3
                : !settled('test-run')
                  ? 4
                  : !settled('report')
                    ? 5
                    : 6
        // Replanned calls use distinct tool IDs, while settled effects are never repeated.
        if (phase === 2 && !JSON.stringify(request).includes('API_RULES_E05_FINAL'))
          sequence[2] = sequence[2].slice(0, 1)
        const next = sequence[phase]?.map(block =>
          block.type === 'tool_use' && results.some(r => r.tool_use_id === block.id)
            ? { ...block, id: block.id + '-current' }
            : block
        )
        const blocks =
          name === 'normal'
            ? next
            : requests.length === 1
              ? [
                  tool('blocked', 'write_file', {
                    path: 'blocked.txt',
                    content: 'ONE_EFFECT_E05_FINAL',
                  }),
                ]
              : undefined
        assert(blocks, 'Unexpected extra deterministic request')
        if (history.includes('UNUSED_SENTINEL')) throw Error('Unexpected context')
        sse(res, blocks)
      }
    } catch (e) {
      serverFailure = e.message
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const hookAudit = path.join(dir, 'hooks.jsonl')
  const hookConfig = {
    version: 1,
    hooks: (name === 'normal' ? ['beforeTool', 'afterTool', 'beforeComplete'] : ['afterTool']).map(
      stage => ({
        id: stage,
        stage,
        command: process.execPath,
        args: [
          path.join(root, 'researches/hooks/check.mjs'),
          name === 'normal' ? 'normal' : 'block',
        ],
        sources: [path.join(root, 'researches/hooks/check.mjs')],
        env: { HOOK_AUDIT: hookAudit },
      })
    ),
  }
  const views = await new Hooks(cwd, { config: hookConfig }).inspect()
  const agent = new Agent({
    cwd,
    hooks: { config: hookConfig, trust: views.map(v => `${v.id}:${v.identity}`) },
    skills: { selected: ['fix-with-tests'] },
    projectInstructions: { root: cwd, scopes: scopeBaseline ? [] : ['packages/api'] },
    tools: allTools.map(t =>
      t.name === 'terminal'
        ? {
            ...t,
            execute: async (input, ctx) =>
              t.execute(input, {
                ...ctx,
                onResultMetadata: m => {
                  metadata.push(m)
                  ctx.onResultMetadata?.(m)
                },
              }),
          }
        : t
    ),
    systemPrompt: buildSystemPrompt({ mcp: true }),
    limits: cases.limits,
    config: {
      apiKey: live ? process.env.ANTHROPIC_API_KEY : 'offline',
      baseURL: `http://127.0.0.1:${port}`,
    },
    context: { counting: 'conservative', maxOutputTokens: 4096 },
    permissions: {
      mode: 'accept-edits',
      rules: [
        { tool: mcpToolName('issues', 'get_issue'), action: 'allow' },
        { tool: mcpToolName('issues', 'get_logs'), action: 'allow' },
        { tool: mcpToolName('issues', 'record_action'), action: 'deny' },
        { tool: 'terminal', action: name === 'normal' ? 'allow' : 'deny' },
      ],
    },
    results: { directory: path.join(dir, 'results') },
    mcp: {
      servers: [
        {
          id: 'issues',
          enabled: true,
          command: process.execPath,
          args: [path.join(root, 'researches/mcp/issue-server.mjs'), 'normal', audit],
          env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin' },
        },
      ],
    },
    events: { onEvent: e => events.push(e) },
    diagnostics: e => diagnostics.push(e),
  })
  const item = { name, passed: false, requests: 0, tools: 0, reportedModels: [], checks: {} }
  const started = Date.now()
  try {
    if (name === 'normal') await agent.runWithContract(cases.normalTask, cases.contract)
    else {
      let failure
      try {
        await agent.run(cases.deniedTask)
      } catch (e) {
        failure = e
      }
      assert(
        failure?.name === 'HookError' && failure.stage === 'afterTool',
        'Expected afterTool failure with actual effect'
      )
    }
    assert(!serverFailure, serverFailure)
    paired(agent.getHistory())
    const calls = events.filter(e => e.type === 'tool-state' && e.status === 'pending')
    item.requests = requests.length
    item.tools = calls.length
    assert(item.requests <= 8 && item.tools <= 12)
    const protocol = (await fs.readFile(audit, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
    assert.equal(protocol.filter(e => e.event === 'effect').length, 0)
    assert(protocol.some(e => e.method === 'notifications/initialized'))
    const pid = protocol[0].pid
    assert.throws(() => process.kill(pid, 0))
    item.checks = { paired: true, noRecordEffects: true, nativeCleanup: true }
    if (name === 'normal') {
      assert(calls.some(c => c.toolName === mcpToolName('issues', 'get_issue')))
      assert(calls.some(c => c.toolName === mcpToolName('issues', 'get_logs')))
      assert(calls.some(c => c.toolName === 'read_tool_result'))
      assert(metadata.some(m => m.terminalOutcome === 'completed' && m.exitCode === 0))
      execFileSync(process.execPath, ['--test', 'packages/api/amount.test.mjs'], { cwd })
      const module = await import(path.join(cwd, 'packages/api/amount.mjs'))
      assert.equal(module.totalAmounts([0.1, 0.2]), 0.3)
      assert.equal(module.totalAmounts([]), 0)
      const artifact = JSON.parse(
        await fs.readFile(path.join(cwd, 'artifacts/change-report.json'), 'utf8')
      )
      assert.equal(artifact.issue, 'ISSUE-42')
      assert.equal(artifact.testsPassed, true)
      assert(typeof artifact.summary === 'string' && artifact.summary.trim().length > 10)
      assert.equal(
        await fs.readFile(path.join(cwd, 'packages/web/index.mjs'), 'utf8'),
        cases.files['packages/web/index.mjs']
      )
      item.checks = {
        ...item.checks,
        externalReads: true,
        tailRecall: true,
        actualTests: true,
        independentAmounts: true,
        jsonReport: true,
        webUnchanged: true,
      }
    } else {
      assert.equal(calls.length, 1)
      assert.equal(calls[0].toolName, 'write_file')
      assert.equal(await fs.readFile(path.join(cwd, 'blocked.txt'), 'utf8'), 'ONE_EFFECT_E05_FINAL')
      for (const [f, text] of Object.entries(cases.files))
        assert.equal(await fs.readFile(path.join(cwd, f), 'utf8'), text)
      assert(agent.needsRecovery)
      assert.equal(agent.snapshot().recovery.hooks.checks.at(-1).state, 'blocked')
      assert.equal(agent.snapshot().recovery.tools[0].state, 'settled')
      item.checks = {
        ...item.checks,
        oneRealWrite: true,
        originalReceipt: true,
        pendingHook: true,
        noExtraWork: true,
      }
    }
    const hookRecords = (await fs.readFile(hookAudit, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
    for (const pid of new Set(hookRecords.map(r => r.pid)))
      assert.throws(() => process.kill(pid, 0))
    if (name === 'normal') {
      const text = JSON.stringify(requests)
      for (const marker of [
        'ROOT_RULES_E05_FINAL',
        'API_RULES_E05_FINAL',
        'GUIDE_E05_FINAL',
        'RESOURCE_E05_FINAL',
      ])
        assert(text.includes(marker), marker)
      assert(!text.includes('UNUSED_SENTINEL'))
      for (const stage of ['beforeTool', 'afterTool', 'beforeComplete'])
        assert(
          events.some(e => e.type === 'hook-check' && e.stage === stage && e.status === 'passed')
        )
      assert(hookRecords.some(r => r.event === 'tests' && r.passed))
      for (const [f, text] of Object.entries(cases.files))
        if (!f.startsWith('packages/api/'))
          assert.equal(await fs.readFile(path.join(cwd, f), 'utf8'), text)
      item.checks = {
        ...item.checks,
        scopedRules: true,
        selectedSkill: true,
        resourceRead: true,
        allHookStages: true,
        hookRanActualTests: true,
      }
    }
    item.checks.hookCleanup = true
    item.passed = true
  } catch (e) {
    item.error = e.message
    process.exitCode = 1
  } finally {
    await agent.close()
    agent.cancelCompaction()
    server.closeAllConnections()
    await new Promise(r => server.close(r))
    item.requests = requests.length
    item.tools = events.filter(e => e.type === 'tool-state' && e.status === 'pending').length
    item.durationMs = Date.now() - started
    await json(path.join(dir, 'events.json'), events)
    await json(path.join(dir, 'diagnostics.json'), diagnostics)
    await json(path.join(dir, 'snapshot.json'), agent.snapshot())
    await json(path.join(dir, 'terminal-metadata.json'), metadata)
    try {
      const raw = await fs.readFile(path.join(dir, 'responses.raw'), 'utf8')
      item.reportedModels = [
        ...new Set([...raw.matchAll(/"model"\s*:\s*"([^"]+)"/g)].map(m => m[1])),
      ]
    } catch {}
    report.cases.push(item)
    await json(path.join(output, 'verification.json'), report)
  }
}
report.hashesStillCurrent = true
for (const table of [report.sourceHashes, report.runtimeHashes])
  for (const [name, hash] of Object.entries(table))
    if (sha(await fs.readFile(path.join(root, name))) !== hash) report.hashesStillCurrent = false
report.passed = report.cases.every(c => c.passed) && report.hashesStillCurrent
if (!report.passed) process.exitCode = 1
await json(path.join(output, 'verification.json'), report)
console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases }, null, 2))
