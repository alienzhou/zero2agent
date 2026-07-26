import * as path from 'node:path'

/**
 * 校验目标路径是否落在工作区（cwd）目录树内，并返回解析后的绝对路径。
 *
 * 这是写工具（write_file / delete）的物理安全底线：写和删都不可越出 cwd。
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
 * 不处理：软链接真实路径解析（cwd 内软链指向外部不在防护范围，见 backlog）。
 */
export function resolveInsideCwd(cwd: string, relPath: string): string | null {
  const resolved = path.resolve(cwd, relPath)
  const rel = path.relative(cwd, resolved)

  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null
  }

  return resolved
}
