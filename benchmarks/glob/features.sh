#!/usr/bin/env bash
# Glob 功能矩阵测试：验证每个工具的实际功能支持情况
# 用法：./benchmarks/glob/features.sh
# 输出：benchmarks/results/glob/features.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPERS="$SCRIPT_DIR/wrappers"
CORPUS_ROOT="/tmp/zero2agent-bench/corpus"
RESULTS_DIR="$BENCH_DIR/results/glob"
DIR="$CORPUS_ROOT/small"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}[features]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[features]${NC} $*"; }
info() { echo -e "${CYAN}[features]${NC} $*"; }
warn() { echo -e "${YELLOW}[features]${NC} $*"; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
if [ ! -d "$DIR" ]; then
  err "Small corpus not found: $DIR"
  err "Run ./benchmarks/corpus/prepare.sh small first."
  exit 1
fi

for tool in rg fd; do
  if ! command -v "$tool" &>/dev/null; then
    err "$tool not installed. Run ./benchmarks/setup.sh first."
    exit 1
  fi
done

mkdir -p "$RESULTS_DIR"
OUT="$RESULTS_DIR/features.md"

info "Running glob feature tests on: $DIR"
info "Writing results to: $OUT"

# ── 辅助函数 ──────────────────────────────────────────────────────────────────
# 运行工具（忽略 stderr，失败时返回空字符串）
run_rg()   { rg          "$@" 2>/dev/null || true; }
run_fd()   { fd          "$@" 2>/dev/null || true; }
run_npm()  { node "$WRAPPERS/npm-glob.mjs" --dot "$@" 2>/dev/null || true; }
run_node() { node "$WRAPPERS/node-fs-glob.mjs" "$@" 2>/dev/null || true; }

# 获取 exit code
ec_rg()   { rg          "$@" > /dev/null 2>&1; echo $?; }
ec_fd()   { fd          "$@" > /dev/null 2>&1; echo $?; }
ec_npm()  { node "$WRAPPERS/npm-glob.mjs" --dot "$@" > /dev/null 2>&1; echo $?; }
ec_node() { node "$WRAPPERS/node-fs-glob.mjs" "$@" > /dev/null 2>&1; echo $?; }

# 统计非空行数（避免 grep -c 返回 exit 1 时的 || 双输出问题）
count_lines() {
  local input="$1"
  [ -z "$input" ] && { echo 0; return; }
  local n
  n=$(printf '%s\n' "$input" | grep -c '.' 2>/dev/null) || n=0
  echo "$n"
}

# ── 初始化输出文件 ─────────────────────────────────────────────────────────────
{
  echo "# Glob 功能矩阵"
  echo ""
  echo "> 语料：zero2agent 项目（small corpus，~5,600 files）"
  echo ""
  echo "| 功能 | rg --files | fd | npm glob | Node fs.glob |"
  echo "|------|-----------|-----|---------|--------------|"
} > "$OUT"

# ── G-F01: globstar **/*.ts ────────────────────────────────────────────────────
info "G-F01: globstar (**/*.ts)"
test_tool() {
  local out="$1"
  local count; count=$(count_lines "$out")
  local bad=0
  if [ -n "$out" ]; then
    bad=$(printf '%s\n' "$out" | grep -c -v '\.ts$' 2>/dev/null) || bad=0
  fi
  if [ "$count" -gt 0 ] && [ "$bad" -eq 0 ]; then
    echo "✅ ($count 个文件)"
  else
    echo "❌ (count=$count bad=$bad)"
  fi
}

rg_out=$(run_rg --files --no-ignore --hidden --glob '*.ts' "$DIR")
fd_out=$(run_fd --no-ignore --hidden -g '*.ts' "$DIR")
npm_out=$(run_npm '**/*.ts' "$DIR")
node_out=$(run_node '**/*.ts' "$DIR")

rg_r=$(test_tool "$rg_out"); fd_r=$(test_tool "$fd_out")
npm_r=$(test_tool "$npm_out"); node_r=$(test_tool "$node_out")
echo "| **G-F01** globstar (\`**/*.ts\`) | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F02: brace expansion {package,tsconfig}.json ────────────────────────────
info "G-F02: brace expansion ({package,tsconfig}.json)"
test_brace() {
  local out="$1"
  local count; count=$(count_lines "$out")
  if [ "$count" -gt 0 ]; then
    local bad=0
    bad=$(printf '%s\n' "$out" | while IFS= read -r f; do basename "$f"; done \
      | grep -c -v -E '^(package|tsconfig)\.json$' 2>/dev/null) || bad=0
    if [ "$bad" -eq 0 ]; then
      echo "✅ ($count 个文件)"
    else
      echo "❌ (含非法匹配 $bad 条)"
    fi
  else
    echo "❌ (无结果)"
  fi
}

rg_out=$(run_rg --files --no-ignore --hidden --glob '{package,tsconfig}.json' "$DIR")
fd_out=$(run_fd --no-ignore --hidden -g '{package,tsconfig}.json' "$DIR")
npm_out=$(run_npm '**/{package,tsconfig}.json' "$DIR")
node_out=$(run_node '**/{package,tsconfig}.json' "$DIR")

rg_r=$(test_brace "$rg_out"); fd_r=$(test_brace "$fd_out")
npm_r=$(test_brace "$npm_out"); node_r=$(test_brace "$node_out")
echo "| **G-F02** brace expansion (\`{}\`) | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F03: 字符类 [A-Z]*.ts ────────────────────────────────────────────────────
info "G-F03: character class ([A-Z]*.ts)"
test_charclass() {
  local tool="$1"
  local out ec
  case "$tool" in
    rg)   out=$(run_rg  --files --no-ignore --hidden --glob '[A-Z]*.ts' "$DIR")
          ec=$(ec_rg    --files --no-ignore --hidden --glob '[A-Z]*.ts' "$DIR") ;;
    fd)   out=$(run_fd  --no-ignore --hidden -g '[A-Z]*.ts' "$DIR")
          ec=$(ec_fd    --no-ignore --hidden -g '[A-Z]*.ts' "$DIR") ;;
    npm)  out=$(run_npm  '**/[A-Z]*.ts' "$DIR")
          ec=$(ec_npm   '**/[A-Z]*.ts' "$DIR") ;;
    node) out=$(run_node '**/[A-Z]*.ts' "$DIR")
          ec=$(ec_node  '**/[A-Z]*.ts' "$DIR") ;;
  esac
  local count; count=$(count_lines "$out")
  if [ "$ec" -ne 0 ]; then
    echo "❌ (exit $ec)"
  elif [ "$count" -gt 0 ]; then
    local bad=0
    bad=$(printf '%s\n' "$out" | while IFS= read -r f; do basename "$f"; done \
      | grep -c -v '^[A-Z].*\.ts$' 2>/dev/null) || bad=0
    if [ "$bad" -eq 0 ]; then
      echo "✅ ($count 个文件)"
    else
      echo "⚠️ ($count 个文件，含小写开头 $bad 条，macOS 大小写不敏感)"
    fi
  else
    echo "✅ 支持（语料无匹配）"
  fi
}

rg_r=$(test_charclass rg); fd_r=$(test_charclass fd)
npm_r=$(test_charclass npm); node_r=$(test_charclass node)
echo "| **G-F03** 字符类 (\`[A-Z]\`) | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F04: .gitignore 尊重 ─────────────────────────────────────────────────────
info "G-F04: .gitignore respect"

# 比较「无 --no-ignore」和「有 --no-ignore」的文件数差异：
# 差异越大代表 .gitignore 发挥了越大作用
rg_raw=$(rg --files --no-ignore "$DIR" 2>/dev/null | wc -l | tr -d ' ')
rg_def=$(rg --files "$DIR" 2>/dev/null | wc -l | tr -d ' ')
if [ "$rg_raw" -gt "$rg_def" ]; then
  rg_r="✅ 默认排除 (raw=$rg_raw def=$rg_def)"
else
  rg_r="⚠️ 相同 (raw=$rg_raw def=$rg_def,语料中无 ignore 差异)"
fi

fd_raw=$(fd --no-ignore . "$DIR" 2>/dev/null | wc -l | tr -d ' ')
fd_def=$(fd . "$DIR" 2>/dev/null | wc -l | tr -d ' ')
if [ "$fd_raw" -gt "$fd_def" ]; then
  fd_r="✅ 默认排除 (raw=$fd_raw def=$fd_def)"
else
  fd_r="⚠️ 相同 (raw=$fd_raw def=$fd_def,语料中无 ignore 差异)"
fi

npm_r="❌ 不支持（需手动配置）"
node_r="❌ 不支持（无内置机制）"
echo "| **G-F04** .gitignore 默认排除 | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F05: 隐藏文件 ────────────────────────────────────────────────────────────
info "G-F05: hidden files (.env)"
HIDDEN_FILE="$DIR/.bench-hidden-test"
echo "benchmark hidden file test" > "$HIDDEN_FILE"
# shellcheck disable=SC2064
trap "rm -f '$HIDDEN_FILE'" EXIT

test_hidden() {
  local found="$1"
  [ "$found" -gt 0 ] && echo "✅ 找到" || echo "❌ 未找到"
}

rg_found=$(rg --files --no-ignore --hidden --glob '.bench-hidden-test' "$DIR" 2>/dev/null | wc -l | tr -d ' ')
fd_found=$(fd --no-ignore --hidden -g '.bench-hidden-test' "$DIR" 2>/dev/null | wc -l | tr -d ' ')
npm_found=$(run_npm '**/.bench-hidden-test' "$DIR" | wc -l | tr -d ' ')
node_found=$(run_node '**/.bench-hidden-test' "$DIR" | wc -l | tr -d ' ')

rg_r=$(test_hidden "$rg_found"); fd_r=$(test_hidden "$fd_found")
npm_r=$(test_hidden "$npm_found"); node_r=$(test_hidden "$node_found")
echo "| **G-F05** 隐藏文件（\`--hidden\`） | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F06: 不存在的目录 ────────────────────────────────────────────────────────
info "G-F06: nonexistent directory"
NODIR="/tmp/zero2agent-bench-nonexistent-$$"

test_nodir() {
  local ec="$1"
  [ "$ec" -ne 0 ] && echo "✅ 报错 (exit $ec)" || echo "⚠️ 静默退出 (exit 0)"
}

rg_ec=$(ec_rg  --files "$NODIR")
fd_ec=$(ec_fd  . "$NODIR")
npm_ec=$(ec_npm  '**/*' "$NODIR")
node_ec=$(ec_node '**/*' "$NODIR")

rg_r=$(test_nodir "$rg_ec"); fd_r=$(test_nodir "$fd_ec")
npm_r=$(test_nodir "$npm_ec"); node_r=$(test_nodir "$node_ec")
echo "| **G-F06** 目录不存在时报错 | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── G-F07: 空 pattern ──────────────────────────────────────────────────────────
info "G-F07: empty pattern"

test_empty() {
  local ec="$1"
  local lines="$2"
  if [ "$ec" -ne 0 ]; then
    echo "报错 (exit $ec)"
  elif [ "$lines" -gt 0 ]; then
    echo "返回 $lines 行"
  else
    echo "空结果"
  fi
}

rg_ec=$(ec_rg  --files --no-ignore --hidden --glob '' "$DIR")
rg_lines=$(run_rg  --files --no-ignore --hidden --glob '' "$DIR" | wc -l | tr -d ' ')
fd_ec=$(ec_fd  --no-ignore --hidden -g '' "$DIR")
fd_lines=$(run_fd  --no-ignore --hidden -g '' "$DIR" | wc -l | tr -d ' ')
npm_ec=$(ec_npm  '' "$DIR")
npm_lines=$(run_npm  '' "$DIR" | wc -l | tr -d ' ')
node_ec=$(ec_node '' "$DIR")
node_lines=$(run_node '' "$DIR" | wc -l | tr -d ' ')

rg_r=$(test_empty "$rg_ec" "$rg_lines"); fd_r=$(test_empty "$fd_ec" "$fd_lines")
npm_r=$(test_empty "$npm_ec" "$npm_lines"); node_r=$(test_empty "$node_ec" "$node_lines")
echo "| **G-F07** 空 pattern 行为 | $rg_r | $fd_r | $npm_r | $node_r |" >> "$OUT"

# ── 收尾 ──────────────────────────────────────────────────────────────────────
{
  echo ""
  echo "> 生成时间：$(date '+%Y-%m-%d %H:%M:%S')"
} >> "$OUT"

ok "Done! Results written to $OUT"
echo ""
cat "$OUT"
