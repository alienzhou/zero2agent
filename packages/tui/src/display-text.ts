/** Only this module turns untrusted text into terminal cells. Never interpret model ANSI. */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), item => item.segment)
}

export function safeText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => {
    if (char === '\n') return '\n'
    if (char === '\t') return '    '
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}

/** Terminal width convention: combining clusters 0/1, East Asian and emoji clusters 2. */
export function cellWidth(cluster: string): number {
  if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(cluster)) return 0
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(cluster)) return 2
  const cp = cluster.codePointAt(0) ?? 0
  return cp >= 0x1100 && (
    cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) ? 2 : 1
}

export function textWidth(text: string): number {
  return graphemes(text).reduce((sum, cluster) => sum + cellWidth(cluster), 0)
}

/** Reserve the terminal's final column to avoid implicit wrap/scroll on every redraw. */
export function wrapText(text: string, width: number): string[] {
  width = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const cluster of graphemes(safeText(text))) {
    if (cluster === '\n') {
      lines.push(line)
      line = ''
      used = 0
      continue
    }
    const size = cellWidth(cluster)
    if (used + size > width && line) {
      lines.push(line)
      line = ''
      used = 0
    }
    // A double-width cluster cannot fit a one-column viewport. Make the limitation visible.
    line += size > width ? '?' : cluster
    used += Math.min(size, width)
  }
  lines.push(line)
  return lines
}

export function clipText(text: string, width: number): string {
  const line = safeText(text).replaceAll('\n', ' ')
  let result = ''
  let used = 0
  for (const cluster of graphemes(line)) {
    const size = cellWidth(cluster)
    if (used + size > width) break
    result += cluster
    used += size
  }
  return result
}
