import { glob } from 'glob'
const args = process.argv.slice(2)
const dot = args.includes('--dot')
const positional = args.filter(a => !a.startsWith('--'))
const [pattern, cwd] = positional
const files = await glob(pattern, { cwd, dot, nodir: true })
files.forEach(f => process.stdout.write(f + '\n'))
