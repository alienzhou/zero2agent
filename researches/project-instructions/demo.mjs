// Run from the repository: pnpm build && node researches/project-instructions/demo.mjs [--live]
// Raw requests/responses and failures stay in ignored tmp/e05-s001. No automatic task reruns.
import fs from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { Agent, allTools, buildSystemPrompt, getModelName } from '../../packages/core/dist/index.js'
import {
  files,
  fixedAmount,
  fixedTest,
  limits,
  normalTask,
  deniedTask,
  maliciousRule,
  contract,
} from './cases.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const live = process.argv.includes('--live')
if (process.argv.slice(2).some(a => a !== '--live')) throw new Error('Only --live is supported.')
if (live) {
  try {
    process.loadEnvFile(path.join(root, '.env.local'))
  } catch {}
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configure ANTHROPIC_API_KEY for --live.')
}
const outputRoot = path.join(root, 'tmp/e05-s001')
await fs.mkdir(outputRoot, { recursive: true })
const output = await fs.mkdtemp(path.join(outputRoot, live ? 'live-' : 'offline-'))
const sha = text => createHash('sha256').update(text).digest('hex')
const report = {
  mode: live ? 'real-service' : 'deterministic-http',
  startedAt: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  requestedModel: live ? getModelName({}) : 'deterministic-fixture',
  limits,
  cases: [],
  passed: false,
}
const sourceFiles = [
  'packages/core/src/project-instructions.ts',
  'packages/core/src/loop.ts',
  'packages/core/src/agent.ts',
  'researches/project-instructions/cases.mjs',
  'researches/project-instructions/demo.mjs',
]
report.sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async name => [name, sha(await fs.readFile(path.join(root, name)))])
  )
)
report.runtimeHashes = Object.fromEntries(
  await Promise.all(
    [
      'packages/core/dist/project-instructions.js',
      'packages/core/dist/loop.js',
      'packages/core/dist/agent.js',
    ].map(async name => [name, sha(await fs.readFile(path.join(root, name)))])
  )
)
const write = (file, text) => fs.writeFile(file, text, { mode: 0o600 })
const tool = (name, input, id) => ({ type: 'tool_use', name, input, id })
function sse(res, blocks, model = 'deterministic-fixture') {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, extra) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`)
  event('message_start', {
    message: {
      id: 'instruction-demo',
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  blocks.forEach((b, index) => {
    event('content_block_start', {
      index,
      content_block: b.type === 'tool_use' ? { ...b, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta:
        b.type === 'tool_use'
          ? { type: 'input_json_delta', partial_json: JSON.stringify(b.input) }
          : { type: 'text_delta', text: b.text },
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

for (const name of ['normal', 'denied']) {
  const dir = path.join(output, name),
    cwd = path.join(dir, 'workspace')
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 })
  for (const [file, body] of Object.entries(files)) {
    const target = path.join(cwd, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await write(target, body)
  }
  if (name === 'denied') await write(path.join(cwd, 'AGENTS.md'), maliciousRule)
  const requests = [],
    events = [],
    effects = [],
    terminalResults = []
  let deniedCount = 0,
    serverFailure
  const server = createServer(async (req, res) => {
    const control = new AbortController()
    res.on('close', () => control.abort())
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const request = JSON.parse(body)
      requests.push(request)
      await fs.appendFile(path.join(dir, 'requests.jsonl'), body + '\n', { mode: 0o600 })
      const n = requests.length
      if (live) {
        // Forward credentials only to the configured service; never record request headers.
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
            signal: AbortSignal.any([control.signal, AbortSignal.timeout(limits.maxDurationMs)]),
          }
        )
        res.writeHead(response.status, {
          'content-type': response.headers.get('content-type') ?? 'application/json',
        })
        for await (const chunk of response.body ?? []) {
          await fs.appendFile(path.join(dir, 'responses.raw'), chunk, { mode: 0o600 })
          res.write(chunk)
        }
        res.end()
      } else if (name === 'denied') {
        sse(
          res,
          n === 1
            ? [tool('write_file', { path: '../forbidden.txt', content: 'forbidden' }, 'deny-once')]
            : [{ type: 'text', text: 'The host denied the write; stopped without retry.' }]
        )
      } else {
        const sequence = [
          [
            tool('read_file', { path: 'packages/api/amount.ts' }, 'read-before-scope'),
            tool('read_file', { path: 'packages/api/amount.test.ts' }, 'read-test-before-scope'),
          ],
          [
            tool('read_file', { path: 'packages/api/amount.ts' }, 'read-source'),
            tool('read_file', { path: 'packages/api/amount.test.ts' }, 'read-test'),
          ],
          [
            tool('write_file', { path: 'packages/api/amount.ts', content: fixedAmount }, 'fix'),
            tool(
              'write_file',
              { path: 'packages/api/amount.test.ts', content: fixedTest },
              'regression'
            ),
          ],
          [
            tool(
              'terminal',
              {
                command: 'node --experimental-strip-types --test amount.test.ts',
                workdir: 'packages/api',
              },
              'test'
            ),
          ],
          [
            tool(
              'write_file',
              {
                path: 'artifacts/change-report.json',
                content: JSON.stringify({
                  package: 'api',
                  testsPassed: true,
                  summary: 'Converted prices to cents and added decimal/zero regressions.',
                }),
              },
              'report'
            ),
          ],
          [{ type: 'text', text: 'Tests passed and change report saved.' }],
        ]
        sse(res, sequence[n - 1] ?? [{ type: 'text', text: 'Unexpected extra request.' }])
      }
    } catch (error) {
      if (!control.signal.aborted) serverFailure = error.message
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const tools = allTools.map(t =>
    ['read_tool_result', 'read_history'].includes(t.name)
      ? t
      : {
          ...t,
          execute: async (input, ctx) => {
            const result = await t.execute(input, ctx)
            if (t.permission?.effect === 'write' && !result.startsWith('Error:'))
              effects.push({ tool: t.name, path: input.path })
            if (t.name === 'terminal') terminalResults.push(result)
            return result
          },
        }
  )
  const agent = new Agent({
    cwd,
    tools,
    systemPrompt: buildSystemPrompt(),
    config: {
      apiKey: live ? process.env.ANTHROPIC_API_KEY : 'offline-fixture',
      baseURL: `http://127.0.0.1:${server.address().port}`,
    },
    limits,
    context: {
      contextWindow: 200000,
      maxInputTokens: 120000,
      maxOutputTokens: 4096,
      counting: 'conservative',
    },
    results: { directory: path.join(dir, 'results') },
    permissions:
      name === 'normal'
        ? {
            mode: 'accept-edits',
            rules: [
              {
                tool: 'terminal',
                action: 'allow',
                input: {
                  command: 'node --experimental-strip-types --test amount.test.ts',
                  workdir: 'packages/api',
                },
              },
            ],
          }
        : { mode: 'read-only' },
    diagnostics: event => {
      events.push(event)
      appendFileSync(path.join(dir, 'diagnostics.jsonl'), JSON.stringify(event) + '\n', {
        mode: 0o600,
      })
    },
    events: {
      onPermission: (_id, decision) => {
        if (decision.action === 'deny') deniedCount++
      },
    },
  })
  const result = { name, passed: false }
  try {
    const answer =
      name === 'normal'
        ? await agent.runWithContract(normalTask, contract)
        : await agent.run(deniedTask)
    await write(path.join(dir, 'answer.txt'), answer)
    if (serverFailure) throw new Error(serverFailure)
    if (JSON.stringify(requests).includes('WEB_ONLY_SENTINEL'))
      throw new Error('Sibling instructions leaked.')
    if (name === 'normal') {
      if (!requests.some(r => JSON.stringify(r).includes('API changes')))
        throw new Error('API rules missing from actual requests.')
      if (!terminalResults.some(r => /Exit code: 0/.test(r)))
        throw new Error('No successful actual test command.')
      if (
        (await fs.readFile(path.join(cwd, 'packages/api/amount.test.ts'), 'utf8')) ===
        files['packages/api/amount.test.ts']
      )
        throw new Error('Regression tests unchanged.')
      for (const file of [
        'AGENTS.md',
        'packages/api/AGENTS.md',
        'packages/web/AGENTS.md',
        'packages/web/index.ts',
      ])
        if ((await fs.readFile(path.join(cwd, file), 'utf8')) !== files[file])
          throw new Error(`Unexpected change: ${file}`)
      if (effects.length !== 3 || new Set(effects.map(effect => effect.path)).size !== 3)
        throw new Error('Expected exactly three distinct writes.')
      const check =
        "import assert from 'node:assert/strict'; import {totalCents} from './packages/api/amount.ts'; assert.equal(totalCents(2.75,3),825); assert.equal(totalCents(1.25,3),375); assert.equal(totalCents(2.75,0),0);"
      const actual = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', check],
        { cwd, encoding: 'utf8', timeout: 10000 }
      )
      await write(
        path.join(dir, 'independent-check.txt'),
        actual || 'Three independent value assertions passed.\n'
      )
      const tests = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--test', 'amount.test.ts'],
        { cwd: path.join(cwd, 'packages/api'), encoding: 'utf8', timeout: 10000 }
      )
      await write(path.join(dir, 'regression-check.txt'), tests)
      result.artifact = JSON.parse(
        await fs.readFile(path.join(cwd, 'artifacts/change-report.json'), 'utf8')
      )
    } else {
      if (deniedCount !== 1 || effects.length !== 0)
        throw new Error('Expected one denied call and zero write effects.')
      if (
        await fs.stat(path.join(dir, 'forbidden.txt')).then(
          () => true,
          () => false
        )
      )
        throw new Error('Forbidden file exists.')
      if (
        (await fs.readFile(path.join(cwd, 'packages/api/amount.ts'), 'utf8')) !==
        files['packages/api/amount.ts']
      )
        throw new Error('Denied case changed source.')
    }
    result.passed = true
  } catch (error) {
    result.failure = error.message
    process.exitCode = 1
  } finally {
    agent.cancelCompaction()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    result.requests = requests.length
    result.effects = effects
    result.deniedCalls = deniedCount
    result.reportedModels = [...new Set(events.map(e => e.responseModel).filter(Boolean))]
    await write(path.join(dir, 'snapshot.json'), JSON.stringify(agent.snapshot(), null, 2))
    await write(
      path.join(dir, 'instruction-view.json'),
      JSON.stringify(agent.getProjectInstructions(), null, 2)
    )
    await write(path.join(dir, 'terminal-results.json'), JSON.stringify(terminalResults, null, 2))
    report.cases.push(result)
  }
}
report.passed = report.cases.every(c => c.passed)
report.finishedAt = new Date().toISOString()
await write(path.join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, evidenceDirectory: output }, null, 2))
