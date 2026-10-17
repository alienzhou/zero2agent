// Observe raw protocol bytes through a transparent local shim. No model or business system.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { McpController, toAnthropicTool, mcpToolName } from '../../packages/core/dist/index.js'
const root = fileURLToPath(new URL('../..', import.meta.url))
await fs.mkdir(path.join(root, 'tmp/e05-s003'), { recursive: true })
const out = await fs.mkdtemp(path.join(root, 'tmp/e05-s003/protocol-'))
const wrapper = path.join(out, 'observe.mjs')
await fs.writeFile(
  wrapper,
  `import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,[process.argv[2],'normal',process.argv[3]],{env:process.env,stdio:'pipe'});process.stdin.on('data',bytes=>{fs.appendFileSync(process.argv[4],bytes);child.stdin.write(bytes)});process.stdin.on('end',()=>child.stdin.end());child.stdout.on('data',bytes=>{fs.appendFileSync(process.argv[5],bytes);process.stdout.write(bytes)});child.stderr.resume();child.on('exit',code=>process.exit(code??1));`
)
const input = path.join(out, 'client-to-server.raw'),
  output = path.join(out, 'server-to-client.raw'),
  audit = path.join(out, 'audit.jsonl')
const client = new McpController(out, {
  servers: [
    {
      id: 'issues',
      enabled: true,
      command: process.execPath,
      args: [wrapper, path.join(root, 'researches/mcp/issue-server.mjs'), audit, input, output],
    },
  ],
})
try {
  await client.open()
  assert.equal(client.tools().length, 3)
  await fs.writeFile(
    path.join(out, 'sdk-tool-table.json'),
    JSON.stringify(client.tools().map(toAnthropicTool), null, 2)
  )
  for (const name of ['get_issue', 'get_logs'])
    await client
      .tools()
      .find(t => t.name === mcpToolName('issues', name))
      .execute({}, { cwd: out })
  await client.close()
  const inbound = (await fs.readFile(input, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l)),
    outbound = (await fs.readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
  assert.equal(inbound[0].method, 'initialize')
  assert.equal(inbound[0].params.protocolVersion, '2025-11-25')
  assert.equal(outbound[0].result.protocolVersion, '2025-11-25')
  assert(inbound.some(v => v.method === 'notifications/initialized'))
  assert.equal(inbound.filter(v => v.method === 'tools/list').length, 2)
  assert.equal(inbound.filter(v => v.method === 'tools/call').length, 2)
  const events = (await fs.readFile(audit, 'utf8'))
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
  assert.equal(events.filter(e => e.event === 'effect').length, 0)
  assert.throws(() => process.kill(events[0].pid, 0))
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  const report = {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    passed: true,
    protocol: '2025-11-25',
    tools: 3,
    pages: 2,
    calls: 2,
    noEffects: true,
    nativeCleanup: true,
    streams: {
      input: { bytes: (await fs.stat(input)).size, sha256: sha(await fs.readFile(input)) },
      output: { bytes: (await fs.stat(output)).size, sha256: sha(await fs.readFile(output)) },
    },
  }
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
} finally {
  await client.close()
}
