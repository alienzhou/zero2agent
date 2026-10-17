// pnpm build && node researches/skills/demo.mjs [--live]
// Every run, including failures, gets a new ignored directory. Never automatically rerun a task.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { Agent, allTools, buildSystemPrompt, getModelName } from '../../packages/core/dist/index.js'
import {
  fixtureVersion,
  limits,
  sentinels,
  files,
  fixedAmount,
  fixedTest,
  testCommand,
  scriptCommand,
  normalTask,
  deniedTask,
  expectedChangedPaths,
  scriptEffectPaths,
  contract,
} from './cases.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const live = process.argv.includes('--live')
if (process.argv.slice(2).some(argument => argument !== '--live'))
  throw new Error('Only --live is supported.')
if (live) {
  try {
    process.loadEnvFile(path.join(root, '.env.local'))
  } catch {}
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configure ANTHROPIC_API_KEY for --live.')
}
const outputRoot = path.join(root, 'tmp/e05-s002')
await fs.mkdir(outputRoot, { recursive: true })
const output = await fs.mkdtemp(path.join(outputRoot, live ? 'live-' : 'offline-'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const save = (file, value) => fs.writeFile(file, value, { mode: 0o600 })
const json = (file, value) => save(file, JSON.stringify(value, null, 2) + '\n')
const report = {
  version: 1,
  fixtureVersion,
  mode: live ? 'real-service' : 'deterministic-http',
  startedAt: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirtySource: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  platform: { system: process.platform, architecture: process.arch, node: process.version },
  command: `node researches/skills/demo.mjs${live ? ' --live' : ''}`,
  requestedModel: live ? getModelName({}) : 'deterministic-fixture',
  limits,
  cases: [],
  passed: false,
  sourceHashes: {},
  runtimeHashes: {},
  frozenCasesSha256: sha(await fs.readFile(new URL('./cases.mjs', import.meta.url))),
}

async function walk(directory, prefix = '') {
  const found = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await walk(path.join(directory, entry.name), relative)))
    else {
      assert(entry.isFile(), `Unexpected non-file in fixture/source: ${relative}`)
      found.push(relative)
    }
  }
  return found.sort()
}
// Copy exact production source and built runtime, not merely the current HEAD label.
const sources = ['researches/skills/cases.mjs', 'researches/skills/demo.mjs', 'pnpm-lock.yaml']
for (const packageName of ['core', 'tui', 'shared']) {
  for (const part of ['src', 'dist']) {
    const directory = `packages/${packageName}/${part}`
    for (const name of await walk(path.join(root, directory))) {
      if (!name.includes('__tests__/') && name.endsWith(part === 'src' ? '.ts' : '.js'))
        sources.push(`${directory}/${name}`)
    }
  }
  sources.push(`packages/${packageName}/package.json`)
}
for (const name of sources) {
  const bytes = await fs.readFile(path.join(root, name))
  const table = name.includes('/dist/') ? report.runtimeHashes : report.sourceHashes
  table[name] = sha(bytes)
  const target = path.join(output, 'source', name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await save(target, bytes)
}
await json(path.join(output, 'frozen-run.json'), report)

async function fileStates(cwd) {
  return Object.fromEntries(
    await Promise.all(
      (await walk(cwd)).map(async name => {
        const bytes = await fs.readFile(path.join(cwd, name))
        return [name, { bytes: bytes.length, sha256: sha(bytes) }]
      })
    )
  )
}
const changedPaths = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .sort()
function paired(messages) {
  const calls = new Map(),
    results = new Map(),
    pending = new Set()
  for (const message of messages) {
    const blocks = Array.isArray(message.content) ? message.content : []
    if (pending.size)
      assert.equal(message.role, 'user', 'Tool results must immediately follow calls.')
    const awaiting = new Set(pending)
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        assert.equal(message.role, 'assistant')
        assert(!calls.has(block.id), `Duplicate tool call ${block.id}`)
        calls.set(block.id, block)
        pending.add(block.id)
      } else if (block.type === 'tool_result') {
        assert.equal(message.role, 'user')
        assert(awaiting.has(block.tool_use_id), `Orphan result ${block.tool_use_id}`)
        assert(!results.has(block.tool_use_id), `Duplicate result ${block.tool_use_id}`)
        results.set(block.tool_use_id, block)
        pending.delete(block.tool_use_id)
      }
    }
    if (awaiting.size) assert.equal(pending.size, 0, 'All batch calls require results.')
  }
  assert.equal(pending.size, 0, 'Unpaired tool calls remain.')
  return { calls: [...calls.values()], results }
}
const tool = (name, input, id) => ({ type: 'tool_use', name, input, id })
function sse(res, blocks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', {
    message: {
      id: 'skills-fixed-fixture',
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
    event('content_block_start', {
      index,
      content_block:
        block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta:
        block.type === 'tool_use'
          ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
          : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: {
      stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage: { output_tokens: 1 },
  })
  event('message_stop', {})
  res.end()
}
const offlineNormal = [
  [tool('load_skill', { skill: 'fix-with-tests' }, 'load-fix')],
  [
    tool(
      'read_skill_resource',
      { skill: 'fix-with-tests', path: 'references/report-format.json' },
      'report-format'
    ),
  ],
  [
    tool('read_file', { path: 'packages/api/amount.ts' }, 'read-source'),
    tool('read_file', { path: 'packages/api/amount.test.ts' }, 'read-test'),
  ],
  [
    tool('write_file', { path: 'packages/api/amount.ts', content: fixedAmount }, 'fix'),
    tool('write_file', { path: 'packages/api/amount.test.ts', content: fixedTest }, 'regression'),
  ],
  [tool('terminal', { command: testCommand, workdir: 'packages/api' }, 'real-test')],
  [
    tool(
      'write_file',
      {
        path: 'artifacts/change-report.json',
        content: JSON.stringify({
          package: 'api',
          testsPassed: true,
          summary:
            'Converted unit prices to cents; actual decimal and zero-quantity regressions passed.',
        }),
      },
      'write-report'
    ),
  ],
  [{ type: 'text', text: 'The actual tests passed and the report was saved.' }],
]

for (const name of ['normal', 'denied']) {
  const directory = path.join(output, name),
    cwd = path.join(directory, 'workspace')
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 })
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(cwd, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await save(target, text)
  }
  const before = await fileStates(cwd)
  await json(path.join(directory, 'before.json'), before)
  const requests = [],
    observations = [],
    diagnostics = [],
    starts = [],
    permissions = [],
    effects = [],
    terminalResults = []
  let serverFailure
  const server = createServer(async (req, res) => {
    const control = new AbortController()
    res.on('close', () => control.abort())
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      assert(
        Buffer.byteLength(body) <= 4 * 1024 * 1024,
        'Acceptance request exceeds 4 MiB capture boundary.'
      )
      const request = JSON.parse(body)
      requests.push(request)
      paired(request.messages)
      const observation = { request: requests.length, files: await fileStates(cwd) }
      observations.push(observation)
      await fs.appendFile(path.join(directory, 'requests.jsonl'), body + '\n', { mode: 0o600 })
      await fs.appendFile(
        path.join(directory, 'request-observations.jsonl'),
        JSON.stringify(observation) + '\n',
        { mode: 0o600 }
      )
      if (live) {
        // Credentials travel only to the configured service; headers are never saved.
        const headers = Object.fromEntries(
          ['content-type', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'authorization']
            .filter(key => typeof req.headers[key] === 'string')
            .map(key => [key, req.headers[key]])
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
          await fs.appendFile(path.join(directory, 'responses.raw'), chunk, { mode: 0o600 })
          res.write(chunk)
        }
        res.end()
      } else {
        const blocks =
          name === 'normal'
            ? offlineNormal[requests.length - 1]
            : requests.length === 1
              ? [tool('terminal', { command: scriptCommand, workdir: '.' }, 'denied-script')]
              : requests.length === 2
                ? [
                    {
                      type: 'text',
                      text: 'The host denied the script. Stopped without retry or effect.',
                    },
                  ]
                : undefined
        assert(blocks, 'Unexpected extra deterministic request; fixture does not mask failures.')
        sse(res, blocks)
      }
    } catch (error) {
      if (!control.signal.aborted) serverFailure = error.message
      if (!res.headersSent) res.writeHead(502)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const wrappedTools = allTools.map(original =>
    ['read_tool_result', 'read_history'].includes(original.name)
      ? original
      : {
          ...original,
          execute: async (input, context) => {
            const prior =
              original.permission?.effect === 'write' ? await fileStates(cwd) : undefined
            const response = await original.execute(input, context)
            if (prior) {
              const after = await fileStates(cwd)
              effects.push({
                tool: original.name,
                request: requests.length,
                path: input.path,
                changedPaths: changedPaths(prior, after),
                before: prior,
                after,
              })
            }
            if (original.name === 'terminal')
              terminalResults.push({ input, output: response, request: requests.length })
            return response
          },
        }
  )
  const agent = new Agent({
    cwd,
    tools: wrappedTools,
    systemPrompt: buildSystemPrompt(),
    skills: name === 'denied' ? { selected: ['malicious-script'] } : {},
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
    results: { directory: path.join(directory, 'results') },
    permissions:
      name === 'normal'
        ? {
            mode: 'accept-edits',
            rules: [
              {
                tool: 'terminal',
                action: 'allow',
                input: { command: testCommand, workdir: 'packages/api' },
              },
            ],
          }
        : { mode: 'read-only' },
    diagnostics: event => {
      diagnostics.push(event)
      appendFileSync(path.join(directory, 'diagnostics.jsonl'), JSON.stringify(event) + '\n', {
        mode: 0o600,
      })
    },
    events: {
      onPermission: (id, decision) => permissions.push({ id, ...decision }),
      onToolStart: (tool, input) => starts.push({ tool, input, request: requests.length }),
    },
  })
  const result = { name, passed: false, startedAt: new Date().toISOString() }
  let snapshot
  try {
    const answer =
      name === 'normal'
        ? await agent.runWithContract(normalTask, contract)
        : await agent.run(deniedTask)
    await save(path.join(directory, 'answer.txt'), answer)
    if (serverFailure) throw new Error(serverFailure)
    snapshot = agent.snapshot()
    const pairing = paired(snapshot.messages),
      after = await fileStates(cwd)
    const serial = requests.map(request => JSON.stringify(request))
    assert(requests.length <= limits.maxRequests)
    assert(pairing.calls.length <= limits.maxToolCalls)
    assert(
      !serial.some(
        request => request.includes(sentinels.unrelated) || request.includes(sentinels.large)
      ),
      'Unrelated body/reference leaked.'
    )
    assert.equal(
      starts.filter(start => start.tool === 'terminal').length,
      name === 'normal' ? 1 : 0
    )
    for (const file of scriptEffectPaths)
      assert(!Object.hasOwn(after, file), `Script effect exists: ${file}`)
    if (name === 'normal') {
      assert(
        serial[0].includes(sentinels.metadata),
        'First request lacks skill catalogue metadata.'
      )
      assert(
        !serial[0].includes(sentinels.body) && !serial[0].includes(sentinels.report),
        'Body/reference was loaded eagerly.'
      )
      const bodyRequest = serial.findIndex(request => request.includes(sentinels.body))
      const referenceRequest = serial.findIndex(request => request.includes(sentinels.report))
      assert(
        bodyRequest > 0 && referenceRequest > bodyRequest,
        'Catalogue/body/reference did not load in sequence.'
      )
      const loads = pairing.calls.filter(call => call.name === 'load_skill')
      assert.equal(loads.length, 1, 'Expected exactly one selected skill load.')
      assert(
        !JSON.stringify(pairing.results.get(loads[0].id)).includes(sentinels.body),
        'load_skill receipt must not duplicate body into history.'
      )
      const resources = pairing.calls.filter(call => call.name === 'read_skill_resource')
      assert.equal(resources.length, 1)
      assert.equal(resources[0].input.path, 'references/report-format.json')
      assert(
        !serial.some(request => request.includes(sentinels.malicious)),
        'Unselected malicious body leaked.'
      )
      assert.deepEqual(changedPaths(before, after), [...expectedChangedPaths])
      assert.equal(effects.length, 3)
      assert.deepEqual(effects.flatMap(effect => effect.changedPaths).sort(), [
        ...expectedChangedPaths,
      ])
      assert(
        effects.every(effect => effect.request >= referenceRequest + 1),
        'Write occurred before reference was visible to model.'
      )
      assert(
        observations
          .slice(0, referenceRequest + 1)
          .every(observation => changedPaths(before, observation.files).length === 0),
        'Premature file effect.'
      )
      assert.equal(permissions.filter(decision => decision.action === 'deny').length, 0)
      assert.equal(terminalResults.length, 1)
      assert.deepEqual(terminalResults[0].input, { command: testCommand, workdir: 'packages/api' })
      assert.match(terminalResults[0].output, /Exit code: 0/)
      assert.notEqual(
        after['packages/api/amount.test.ts'].sha256,
        before['packages/api/amount.test.ts'].sha256
      )
      const check =
        "import assert from 'node:assert/strict'; import {totalCents} from './packages/api/amount.ts'; assert.equal(totalCents(2.75,3),825); assert.equal(totalCents(1.25,3),375); assert.equal(totalCents(2.75,0),0);"
      const independent = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', check],
        { cwd, encoding: 'utf8', timeout: 10000 }
      )
      await save(
        path.join(directory, 'independent-check.txt'),
        independent || 'Three independent amount assertions passed.\n'
      )
      const regression = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--test', 'amount.test.ts'],
        { cwd: path.join(cwd, 'packages/api'), encoding: 'utf8', timeout: 10000 }
      )
      await save(path.join(directory, 'regression-check.txt'), regression)
      result.artifact = JSON.parse(
        await fs.readFile(path.join(cwd, 'artifacts/change-report.json'), 'utf8')
      )
      assert.deepEqual(Object.keys(result.artifact).sort(), ['package', 'summary', 'testsPassed'])
      assert.equal(result.artifact.package, 'api')
      assert.equal(result.artifact.testsPassed, true)
      assert(typeof result.artifact.summary === 'string' && result.artifact.summary.trim())
      result.loading = { bodyRequest: bodyRequest + 1, referenceRequest: referenceRequest + 1 }
    } else {
      assert.equal(pairing.calls.length, 1, 'Negative case must stop after one denied call.')
      assert.equal(pairing.calls[0].name, 'terminal')
      assert.deepEqual(pairing.calls[0].input, { command: scriptCommand, workdir: '.' })
      assert.equal(permissions.filter(decision => decision.action === 'deny').length, 1)
      assert.equal(effects.length, 0)
      assert.equal(terminalResults.length, 0)
      assert.deepEqual(after, before)
      assert(
        serial[0].includes(sentinels.malicious),
        'Explicitly selected current skill body missing.'
      )
      const view = JSON.stringify(agent.getSkills())
      assert(
        view.includes('allowed-tools') &&
          /grant|permissions remain|informational only|权限|unsupported|advisory|未实现|不支持/i.test(
            view
          ),
        'Unsupported permission declaration warning missing.'
      )
      assert.equal(pairing.results.get(pairing.calls[0].id)?.is_error, true)
    }
    result.toolCalls = pairing.calls.length
    result.pairedResults = pairing.results.size
    result.changedPaths = changedPaths(before, after)
    result.passed = true
  } catch (error) {
    result.failure = error.message
    process.exitCode = 1
  } finally {
    agent.cancelCompaction()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    snapshot ??= agent.snapshot()
    result.finishedAt = new Date().toISOString()
    result.requests = requests.length
    result.effects = effects.map(({ before: _before, after: _after, ...effect }) => effect)
    result.deniedCalls = permissions.filter(decision => decision.action === 'deny').length
    result.terminalStarts = starts.filter(start => start.tool === 'terminal').length
    result.reportedModels = [
      ...new Set(diagnostics.map(event => event.responseModel).filter(Boolean)),
    ]
    await json(path.join(directory, 'snapshot.json'), snapshot)
    await json(path.join(directory, 'skills-view.json'), agent.getSkills())
    await json(path.join(directory, 'after.json'), await fileStates(cwd))
    await json(path.join(directory, 'tool-starts.json'), starts)
    await json(path.join(directory, 'permissions.json'), permissions)
    await json(path.join(directory, 'effects.json'), effects)
    await json(path.join(directory, 'terminal-results.json'), terminalResults)
    report.cases.push(result)
    await json(path.join(output, 'summary.json'), report)
  }
}
report.passed = report.cases.every(result => result.passed)
report.finishedAt = new Date().toISOString()
// Check known credential values before treating raw evidence as suitable for archival.
const credentials = [process.env.ANTHROPIC_API_KEY].filter(value => value && value.length >= 8)
for (const name of await walk(output)) {
  const text = await fs.readFile(path.join(output, name), 'utf8')
  if (credentials.some(value => text.includes(value))) {
    report.passed = false
    report.privateDataCheck = 'failed; raw artifacts require private review before archival'
    process.exitCode = 1
    break
  }
}
report.privateDataCheck ??= 'Known credential values absent; request headers never recorded.'
await json(path.join(output, 'summary.json'), report)
console.log(JSON.stringify({ ...report, evidenceDirectory: output }, null, 2))
