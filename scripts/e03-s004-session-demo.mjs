/** A reproducible cross-process resume through the production CLI and SDK, without API credentials. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../packages/tui/dist/session-store.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'zero2agent-s004-demo-'));
const requests = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  const old = request.messages.some(message => typeof message.content === 'string' && message.content.includes('ALPHA-42'));
  const answer = request.messages.length > 1 && old ? '找到了：ALPHA-42。旧上下文来自磁盘恢复。' : '已记住识别码 ALPHA-42。';
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('message_start', { message: { id: 's004-demo', type: 'message', role: 'assistant', model: 'lesson-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: answer } });
  event('content_block_stop', { index: 0 });
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, ZERO2AGENT_SKIP_LOCAL_ENV: '1', ZERO2AGENT_NO_SAVE: '0', ZERO2AGENT_SESSION_DIR: path.join(cwd, 'sessions'), ANTHROPIC_API_KEY: 'local-demo-placeholder', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, MODEL_NAME: 'lesson-fixture', CONTEXT_WINDOW: '30000', MAX_INPUT_TOKENS: '24000', MAX_OUTPUT_TOKENS: '2048' };
async function cli(args, interactive = false) {
  const child = spawn(process.execPath, [path.join(root, 'packages/tui/dist/cli.js'), ...args], { cwd, env, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  let output = '';
  if (!interactive) {
    child.stdout.on('data', data => { output += data; process.stdout.write(data); });
    child.stderr.on('data', data => process.stderr.write(data));
  }
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`CLI exited ${code}`);
  return output;
}
try {
  console.log('进程 A：保存识别码。');
  await cli(['请记住 ALPHA-42，稍后我会再次询问。']);
  const store = await SessionStore.open(cwd, env.ZERO2AGENT_SESSION_DIR);
  const [saved] = await store.list();
  console.log('\n进程 B：列出保存的会话。');
  await cli(['--list-sessions']);
  if (process.argv.includes('--tui')) {
    console.log('\n进入 TUI：/sessions 浏览；/new 后再次恢复；/session 看完整 UUID。exit 结束演示。');
    await cli(['--resume', saved.id], true);
  } else {
    console.log('\n进程 C：恢复后询问，新的问题不包含识别码。');
    const answer = await cli(['--resume', saved.id, '刚才的识别码是什么？']);
    if (!answer.includes('ALPHA-42') || requests.length !== 2 || !JSON.stringify(requests[1].messages).includes('稍后我会再次询问')) throw new Error('Resume contract failed');
    console.log('\nPASS：两个独立模型轮次，旧历史进入恢复后的真实 SDK 请求。模型响应来自本地夹具。');
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(cwd, { recursive: true, force: true });
}
