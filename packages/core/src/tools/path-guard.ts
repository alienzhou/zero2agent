import { realpathSync, lstatSync } from 'node:fs'
import * as path from 'node:path'

/**
 * 校验目标路径是否落在工作区（cwd）目录树内，并返回解析后的绝对路径。
 *
 * 这是路径的词法边界判断：写和删都不可越出 cwd。
 * 读工具危害小，可以不用；但带副作用的工具必须硬拒绝越界。
 *
 * @param cwd     Agent 工作目录的绝对路径
 * @param relPath 待校验的相对（或绝对）路径
 * @returns 落在 cwd 内时返回解析后的绝对路径；越界时返回 null
 *
 * 判定逻辑：
 * - `path.resolve` 把 relPath 解析成绝对路径（能吸收 `..`、`./` 以及绝对路径入参）
 * - `path.relative(cwd, resolved)` 若以 `..` 开头或本身是绝对路径，说明目标跳出了 cwd
 * - 结果为空串表示目标就是 cwd 本身，同样拒绝（不允许把 cwd 当文件写/删）
 *
 * 能挡住：`../../etc/hosts`（相对逃逸）、`/etc/hosts`（绝对路径逃逸）。
 * 本函数仅做词法判断；写工具还使用 resolvePhysicalInsideCwd 解析软链接与已有祖先。
 */
export function resolveInsideCwd(cwd: string, relPath: string): string | null {
  const resolved = path.resolve(cwd, relPath)
  const rel = path.relative(cwd, resolved)

  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return null
  }

  return resolved
}

/** Include missing tails while resolving every existing ancestor, including symlinks. */
export function resolvePhysicalPath(value: string, cwd = process.cwd()): string {
  let current = path.resolve(cwd, value)
  const tail: string[] = []
  while (true) {
    try {
      return path.join(realpathSync(current), ...tail)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A dangling symlink is not a new path; never reinterpret it as missing.
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error('Dangling symlink')
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
      }
      const parent = path.dirname(current)
      if (parent === current) throw error
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}
export function isInsidePath(root: string, target: string, includeRoot = false): boolean {
  const rel = path.relative(root, target)
  return (
    (includeRoot || rel !== '') &&
    rel !== '..' &&
    !rel.startsWith('..' + path.sep) &&
    !path.isAbsolute(rel)
  )
}
export function resolvePhysicalInsideCwd(cwd: string, value: string): string | null {
  if (!resolveInsideCwd(cwd, value)) return null
  try {
    const root = resolvePhysicalPath(cwd)
    const target = resolvePhysicalPath(value, cwd)
    return isInsidePath(root, target) ? target : null
  } catch {
    return null
  }
}
