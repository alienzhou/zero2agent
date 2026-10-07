/** Reproducible complete-course gates. Live runs are explicit (--live). */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'researches/runtime-tui/acceptance');
await mkdir(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
async function sourceHashes(dir, result = {}) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceHashes(name, result);
    else result[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  }
  return result;
}
const report = { startedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), platform: process.platform, arch: process.arch, node: process.version, sourceHashes: { ...await sourceHashes('packages/core/src'), ...await sourceHashes('packages/tui/src'), ...await sourceHashes('e2e/src') }, passed: false, checks: [] };
const changedTs = git('diff', '--name-only', 'caa47ea', '--', 'packages', 'e2e').split('\n').filter(name => name.endsWith('.ts'));
const commands = [
  ['build', 'pnpm', ['build']],
  ['offline', 'pnpm', ['-r', '--workspace-concurrency=1', 'run', 'test', '--no-file-parallelism']],
  ['e2e-types', 'pnpm', ['--filter', '@zero2agent/e2e', 'exec', 'tsc', '--noEmit']],
  ['lint', 'pnpm', ['lint']],
  ['format', 'pnpm', ['exec', 'prettier', '--check', ...changedTs]],
  ['runtime-demo', process.execPath, ['scripts/e03-s003-runtime-demo.mjs']],
  ['terminal-restore', process.execPath, ['scripts/e03-s003-terminal-restore.mjs']],
  ['site-build', 'pnpm', ['site:build']],
  ['site-check', 'pnpm', ['site:check']],
  ['whitespace', 'git', ['diff', '--check', 'caa47ea']],
  ...(process.argv.includes('--live') ? [['live', 'pnpm', ['--filter', '@zero2agent/e2e', 'exec', 'vitest', 'run', 'src/runtime-live.test.ts', '--reporter=default', '--reporter=json', '--outputFile.json=' + path.join(out, 'live-results.json')]]] : []),
];
await writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
for (const [name, command, args] of commands) {
  const start = Date.now();
  let text = '';
  const child = spawn(command, args, { cwd: root, env: { ...process.env, E2E_LIVE: name === 'live' ? '1' : '0', E2E_EVIDENCE_DIR: name === 'live' ? path.join(out, 'live-evidence') : '', NO_COLOR: '1' } });
  child.stdout.on('data', data => { text += data; });
  child.stderr.on('data', data => { text += data; });
  let timedOut = false;
  let forceKill;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
  }, name === 'offline' ? 600_000 : name === 'live' ? 360_000 : 120_000);
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  } finally { clearTimeout(deadline); clearTimeout(forceKill); }
  if (timedOut) { exitCode = 124; text += '\nAcceptance command timed out.\n'; }
  if (name === 'live' && exitCode === 0) {
    const result = JSON.parse(await readFile(path.join(out, 'live-results.json'), 'utf8'));
    if (result.numPassedTests !== 3 || result.numPendingTests !== 0) {
      exitCode = 1;
      text += '\nLive gate requires all three tests to execute and pass; skipped tests do not satisfy it.\n';
    }
  }
  await writeFile(path.join(out, name + '.txt'), text);
  report.checks.push({ name, command: [command, ...args], exitCode, elapsedMs: Date.now() - start, log: name + '.txt' });
  await writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${name}: ${exitCode === 0 ? 'PASS' : 'FAIL'} (${Date.now() - start}ms)`);
  if (exitCode !== 0) { console.log(text.slice(-6000)); process.exitCode = 1; break; }
}
report.completedAt = new Date().toISOString();
report.finalSourceHashes = { ...await sourceHashes('packages/core/src'), ...await sourceHashes('packages/tui/src'), ...await sourceHashes('e2e/src') };
report.sourceStable = JSON.stringify(report.sourceHashes) === JSON.stringify(report.finalSourceHashes);
report.passed = report.sourceStable && report.checks.length === commands.length && report.checks.every(check => check.exitCode === 0);
await writeFile(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
