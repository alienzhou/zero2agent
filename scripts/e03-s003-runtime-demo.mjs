/** Offline fixture server + production SDK/CLI. No external model or credentials required. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Agent, TurnCancelledError } from '../packages/core/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = await mkdtemp(join(tmpdir(), 'zero2agent-runtime-'));
const requests = [];
let agent;
async function within(work, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 10_000); })]); }
  finally { clearTimeout(timer); }
}
let slowResponse;
let slowReady;
const slowStarted = new Promise(resolve => { slowReady = resolve; });
function reply(res, blocks, reason = 'end_turn') {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('message_start', { message: { id: 'runtime_demo', type: 'message', role: 'assistant', model: 'offline-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  blocks.forEach((block, index) => {
    const tool = block.type === 'tool_use';
    event('content_block_start', { index, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { index, delta: tool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event('message_stop', {});
  res.end();
}
const write = (id, path) => ({ type: 'tool_use', id, name: 'write_file', input: { path, content: 'Hello from the runtime lesson.\n' } });
const server = createServer(async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const last = request.messages.at(-1);
    if (Array.isArray(last.content)) {
      reply(res, [{ type: 'text', text: '工具回执已收到。这是本地固定响应；可继续输入“重复”“慢速”“报错”或 exit。' }]);
      return;
    }
    const text = String(last.content);
    if (/slow|慢速/i.test(text)) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': waiting for cancellation\n\n');
      slowResponse = res;
      slowReady();
      const heartbeat = setInterval(() => res.write(': waiting\n\n'), 1000);
      res.once('close', () => clearInterval(heartbeat));
      return;
    }
    if (/报错|error/i.test(text)) {
      reply(res, [{ type: 'tool_use', id: 'unknown', name: 'missing_tool', input: {} }], 'tool_use');
    } else if (/终端|terminal/i.test(text)) {
      reply(res, [{ type: 'tool_use', id: 'human', name: 'terminal', input: { command: 'printf "Human terminal ready\\n"; read -r -p "Say hello: " value; printf "Received %s chars\\n" "${#value}"', interactive: true } }], 'tool_use');
    } else {
      reply(res, /重复|repeat/i.test(text) ? [write('first', 'first.txt'), write('second', 'second.txt')] : [write('write', 'lesson.txt')], 'tool_use');
    }
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
try {
  if (process.argv.includes('--tui') || process.argv.includes('--plain')) {
    console.log('离线课程演示：模型响应来自本地固定夹具，生产 CLI/Core/工具真实运行。');
    console.log('输入“写入”看审批，“重复”看两个调用，“慢速”后按 Ctrl+C，“终端”看人工交接，exit 退出。');
    console.log(`临时工作目录：${cwd}（退出自动删除）`);
    const child = spawn(process.execPath, [join(root, 'packages/tui/dist/cli.js'), ...(process.argv.includes('--plain') ? ['--plain'] : [])], {
      cwd, stdio: 'inherit', env: {
        PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, TERM: process.env.TERM ?? 'xterm-256color',
        ZERO2AGENT_SKIP_LOCAL_ENV: '1', ANTHROPIC_API_KEY: 'offline-fixture', ANTHROPIC_BASE_URL: baseURL,
        MODEL_NAME: 'offline-fixture', CONTEXT_WINDOW: '200000', PERMISSION_MODE: 'default',
      },
    });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { process.exitCode = code ?? 1; resolve(); }); });
  } else {
    const events = [];
    agent = new Agent({
      cwd, config: { apiKey: 'offline-fixture', baseURL, model: 'offline-fixture' },
      context: { contextWindow: 200000 },
      permissions: { requestApproval: async request => ({ requestId: request.id, decision: request.input.path === 'first.txt' ? 'deny' : 'allow' }) },
      events: { onEvent: event => events.push(event) },
    });
    await within(agent.run('repeat'), 'tool round');
    await assert.rejects(readFile(join(cwd, 'first.txt')));
    assert.equal(await readFile(join(cwd, 'second.txt'), 'utf8'), 'Hello from the runtime lesson.\n');
    assert(events.some(e => e.type === 'tool-state' && e.toolCallId === 'first' && e.status === 'denied'));
    assert(events.some(e => e.type === 'tool-state' && e.toolCallId === 'second' && e.status === 'completed'));
    const pairs = agent.getHistory().flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    assert.deepEqual(pairs.map(p => p.tool_use_id), ['first', 'second']);
    const running = agent.run('slow');
    const cancellation = assert.rejects(running, TurnCancelledError);
    await within(slowStarted, 'slow HTTP request');
    const countAtCancel = requests.length;
    const disconnected = new Promise(resolve => slowResponse.once('close', resolve));
    assert.equal(agent.cancelTurn(), true);
    await within(cancellation, 'cancelled Agent');
    await within(disconnected, 'HTTP disconnect');
    assert.equal(requests.length, countAtCancel);
    assert.equal(events.at(-1).type, 'turn-end');
    assert.equal(events.at(-1).status, 'cancelled');
    assert.equal(agent.cancelTurn(), false);
    console.log(JSON.stringify({ fixture: 'local SSE; real SDK/Core/tools', cases: ['deny first write', 'approve second write', 'pair both results', 'cancel live HTTP stream', 'no subsequent request', 'release after cancellation'], passed: true, events: events.map(e => ({ type: e.type, seq: e.seq, ...(e.status && { status: e.status }), ...(e.toolCallId && { toolCallId: e.toolCallId }) })) }, null, 2));
  }
} finally {
  agent?.cancelTurn();
  agent?.cancelCompaction();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(cwd, { recursive: true, force: true });
}
