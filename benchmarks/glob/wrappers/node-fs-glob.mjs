import { glob } from 'node:fs/promises'
const [pattern, dir] = process.argv.slice(2)
// Node 24 的 fs.glob 不支持 dot 选项（会被静默忽略），无法遍历隐藏目录
for await (const f of glob(pattern, { cwd: dir, dot: true })) {
  process.stdout.write(f + '\n')
}
