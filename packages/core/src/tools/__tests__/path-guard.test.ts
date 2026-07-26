import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { resolveInsideCwd } from '../path-guard.js'

const cwd = path.resolve('/tmp/z2a-workspace')

describe('resolveInsideCwd', () => {
  it('cwd 内的普通相对路径返回解析后的绝对路径', () => {
    expect(resolveInsideCwd(cwd, 'a.txt')).toBe(path.join(cwd, 'a.txt'))
    expect(resolveInsideCwd(cwd, 'src/deep/x.ts')).toBe(path.join(cwd, 'src/deep/x.ts'))
  })

  it('内部可被 .. 抵消但仍落在 cwd 内的路径应通过', () => {
    expect(resolveInsideCwd(cwd, 'src/../a.txt')).toBe(path.join(cwd, 'a.txt'))
  })

  it('相对路径逃逸（../）被拒绝，返回 null', () => {
    expect(resolveInsideCwd(cwd, '../escape.txt')).toBeNull()
    expect(resolveInsideCwd(cwd, '../../etc/hosts')).toBeNull()
    expect(resolveInsideCwd(cwd, 'src/../../escape.txt')).toBeNull()
  })

  it('绝对路径逃逸被拒绝，返回 null', () => {
    expect(resolveInsideCwd(cwd, '/etc/hosts')).toBeNull()
  })

  it('目标就是 cwd 本身时被拒绝（不允许把 cwd 当文件写/删）', () => {
    expect(resolveInsideCwd(cwd, '.')).toBeNull()
    expect(resolveInsideCwd(cwd, cwd)).toBeNull()
  })
})
