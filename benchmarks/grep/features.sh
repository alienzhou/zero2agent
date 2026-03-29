#!/usr/bin/env bash
# Grep 功能矩阵测试：验证每个工具的实际功能支持情况
# 用法：./benchmarks/grep/features.sh
# 输出：benchmarks/results/grep/features.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPERS="$SCRIPT_DIR/wrappers"
CORPUS_ROOT="/tmp/zero2agent-bench/corpus"
RESULTS_DIR="$BENCH_DIR/results/grep"
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

for tool in rg ag; do
  if ! command -v "$tool" &>/dev/null; then
    err "$tool not installed. Run ./benchmarks/setup.sh first."
    exit 1
  fi
done

mkdir -p "$RESULTS_DIR"
OUT="$RESULTS_DIR/features.md"

info "Running grep feature tests on: $DIR"
info "Writing results to: $OUT"

count_lines() {
  local input="$1"
  [ -z "$input" ] && { echo 0; return; }
  local n
  n=$(printf '%s\n' "$input" | grep -c '.' 2>/dev/null) || n=0
  echo "$n"
}

run_rg()   { rg    "$@" 2>/dev/null || true; }
run_grep() { grep  "$@" 2>/dev/null || true; }
run_ag()   { ag    "$@" 2>/dev/null || true; }
run_node() { node "$WRAPPERS/node-grep.mjs" "$@" 2>/dev/null || true; }

ec_rg()   { rg    "$@" > /dev/null 2>&1; echo $?; }
ec_grep() { grep  "$@" > /dev/null 2>&1; echo $?; }
ec_ag()   { ag    "$@" > /dev/null 2>&1; echo $?; }
ec_node() { node "$WRAPPERS/node-grep.mjs" "$@" > /dev/null 2>&1; echo $?; }

# ── 初始化输出文件 ─────────────────────────────────────────────────────────────
{
  echo "# Grep 功能矩阵"
  echo ""
  echo "> 语料：zero2agent 项目（small corpus，~5,600 files）"
  echo ""
  echo "| 功能 | rg | grep | ag | Node 自实现 |"
  echo "|------|----|------|----|-----------|"
} > "$OUT"

# ── S-F01: 字面量搜索 ─────────────────────────────────────────────────────────
info "S-F01: literal string search (import)"
rg_count=$(count_lines "$(run_rg --no-ignore --hidden 'import' "$DIR")")
grep_count=$(count_lines "$(run_grep -rn 'import' "$DIR")")
ag_count=$(count_lines "$(run_ag -u 'import' "$DIR")")
node_count=$(count_lines "$(run_node 'import' "$DIR")")

pass_if_count() { [ "$1" -gt 0 ] && echo "✅ ($1 行)" || echo "❌ (无结果)"; }
rg_r=$(pass_if_count "$rg_count"); grep_r=$(pass_if_count "$grep_count")
ag_r=$(pass_if_count "$ag_count"); node_r=$(pass_if_count "$node_count")
echo "| **S-F01** 字面量搜索 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F02: 正则表达式 ─────────────────────────────────────────────────────────
# 注意：macOS 系统 grep 是 BSD grep，不支持 -P (PCRE)，使用 -E (POSIX ERE) 等价写法
info "S-F02: regex (function[[:space:]]+[[:alnum:]_]+)"
rg_count=$(count_lines "$(run_rg --no-ignore --hidden 'function\s+\w+' "$DIR")")
grep_count=$(count_lines "$(run_grep -rn -E 'function[[:space:]]+[[:alnum:]_]+' "$DIR")")
ag_count=$(count_lines "$(run_ag -u 'function\s+\w+' "$DIR")")
node_count=$(count_lines "$(run_node 'function\s+\w+' "$DIR")")

rg_r=$(pass_if_count "$rg_count"); grep_r=$(pass_if_count "$grep_count")
ag_r=$(pass_if_count "$ag_count"); node_r=$(pass_if_count "$node_count")
echo "| **S-F02** 正则表达式 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F03: 大小写不敏感 ───────────────────────────────────────────────────────
info "S-F03: case-insensitive (-i)"
check_ci() {
  local cs_count="$1"
  local ci_count="$2"
  if [ "$ci_count" -ge "$cs_count" ] && [ "$ci_count" -gt 0 ]; then
    echo "✅ (cs=$cs_count ci=$ci_count)"
  else
    echo "❌ (cs=$cs_count ci=$ci_count)"
  fi
}

rg_cs=$(count_lines "$(run_rg --no-ignore --hidden 'readme' "$DIR")")
rg_ci=$(count_lines "$(run_rg --no-ignore --hidden -i 'readme' "$DIR")")
grep_cs=$(count_lines "$(run_grep -rn 'readme' "$DIR")")
grep_ci=$(count_lines "$(run_grep -rni 'readme' "$DIR")")
ag_cs=$(count_lines "$(run_ag -u 'readme' "$DIR")")
ag_ci=$(count_lines "$(run_ag -u -i 'readme' "$DIR")")
node_cs=$(count_lines "$(run_node 'readme' "$DIR")")
node_ci=$(count_lines "$(run_node -i 'readme' "$DIR")")

rg_r=$(check_ci "$rg_cs" "$rg_ci"); grep_r=$(check_ci "$grep_cs" "$grep_ci")
ag_r=$(check_ci "$ag_cs" "$ag_ci"); node_r=$(check_ci "$node_cs" "$node_ci")
echo "| **S-F03** 大小写不敏感 (\`-i\`) | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F04: 上下文行 -C 2 ─────────────────────────────────────────────────────
info "S-F04: context lines (-C 2)"
check_ctx() {
  local match_count="$1"
  local ctx_count="$2"
  local supported="$3"
  if [ "$supported" = "false" ]; then
    echo "❌ 不支持"
  elif [ "$ctx_count" -gt "$match_count" ]; then
    echo "✅ (match=$match_count ctx=$ctx_count)"
  else
    echo "❌ (无上下文扩展)"
  fi
}

rg_m=$(count_lines "$(run_rg --no-ignore --hidden 'import' "$DIR")")
rg_c=$(count_lines "$(run_rg --no-ignore --hidden -C 2 'import' "$DIR")")
grep_m=$(count_lines "$(run_grep -rn 'import' "$DIR")")
grep_c=$(count_lines "$(run_grep -rn -C 2 'import' "$DIR")")
ag_m=$(count_lines "$(run_ag -u 'import' "$DIR")")
ag_c=$(count_lines "$(run_ag -u -C 2 'import' "$DIR")")
node_m=$(count_lines "$(run_node 'import' "$DIR")")

rg_r=$(check_ctx "$rg_m" "$rg_c" "true"); grep_r=$(check_ctx "$grep_m" "$grep_c" "true")
ag_r=$(check_ctx "$ag_m" "$ag_c" "true"); node_r=$(check_ctx "$node_m" "$node_m" "false")
echo "| **S-F04** 上下文行 (\`-C 2\`) | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F05: 文件类型过滤 ───────────────────────────────────────────────────────
info "S-F05: file type filter (.ts only)"
check_typefilter() {
  local out="$1"
  local supported="$2"
  [ "$supported" = "false" ] && { echo "❌ 不支持"; return; }
  local count; count=$(count_lines "$out")
  if [ "$count" -gt 0 ]; then
    local bad; bad=$(echo "$out" | cut -d: -f1 | grep -v '\.ts$' | grep -c '.' || echo 0)
    [ "$bad" -eq 0 ] && echo "✅ ($count 行)" || echo "❌ (含非 .ts 结果)"
  else
    echo "❌ (无结果)"
  fi
}

# 验证方式：统计各工具实际搜索的文件中，是否只有 .ts 文件产生了匹配
# rg/grep 的输出格式是 file:line:content，可以 cut -d: -f1 取路径
# ag 的输出格式是 filename\n  line:content，需要不同的提取方式
check_ts_only() {
  local tool="$1"
  local out="$2"
  if [ "$tool" = "node" ]; then echo "❌ 不支持"; return; fi
  if [ -z "$out" ]; then echo "❌ (无结果)"; return; fi
  local count; count=$(count_lines "$out")
  if [ "$count" -gt 0 ]; then
    local bad=0
    if [ "$tool" = "ag" ]; then
      # ag 输出格式：文件路径行不含 ':'（除非路径含冒号），内容行含 ':'
      # 取不含 ':' 的行（文件名行），检查是否全为 .ts
      bad=$(printf '%s\n' "$out" | grep -v ':' | grep -c -v '\.ts$' 2>/dev/null) || bad=0
    else
      bad=$(printf '%s\n' "$out" | cut -d: -f1 | grep -c -v '\.ts$' 2>/dev/null) || bad=0
    fi
    [ "$bad" -eq 0 ] && echo "✅ ($count 行)" || echo "❌ (含非 .ts 文件)"
  else
    echo "❌ (无结果)"
  fi
}

# 使用 --glob '*.ts' 而非 --type ts，因为 --type ts 包含 .tsx/.d.ts 等多种类型
rg_out=$(run_rg --no-ignore --hidden --glob '*.ts' 'import' "$DIR")
grep_out=$(run_grep -rn 'import' --include='*.ts' "$DIR")
ag_out=$(run_ag -u -G '\.ts$' 'import' "$DIR")

rg_r=$(check_ts_only "rg" "$rg_out")
grep_r=$(check_ts_only "grep" "$grep_out")
ag_r=$(check_ts_only "ag" "$ag_out")
node_r="❌ 不支持"
echo "| **S-F05** 文件类型过滤 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F06: .gitignore 尊重 ────────────────────────────────────────────────────
info "S-F06: .gitignore respect"
rg_raw=$(count_lines "$(rg --no-ignore 'import' "$DIR" 2>/dev/null || true)")
rg_def=$(count_lines "$(rg 'import' "$DIR" 2>/dev/null || true)")
[ "$rg_raw" -gt "$rg_def" ] && rg_r="✅ 默认排除 (raw=$rg_raw def=$rg_def)" \
  || rg_r="⚠️ 相同 (raw=$rg_raw def=$rg_def)"

grep_r="❌ 不支持"
node_r="❌ 不支持"

ag_raw=$(count_lines "$(ag -u 'import' "$DIR" 2>/dev/null || true)")
ag_def=$(count_lines "$(ag 'import' "$DIR" 2>/dev/null || true)")
[ "$ag_raw" -gt "$ag_def" ] && ag_r="✅ 默认排除 (raw=$ag_raw def=$ag_def)" \
  || ag_r="⚠️ 相同 (raw=$ag_raw def=$ag_def)"

echo "| **S-F06** .gitignore 默认排除 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F07: 无效正则 [unclosed ─────────────────────────────────────────────────
info "S-F07: invalid regex ([unclosed)"
rg_ec=$(ec_rg   --no-ignore --hidden '[unclosed' "$DIR")
grep_ec=$(ec_grep -rn -E '[unclosed' "$DIR")
ag_ec=$(ec_ag   -u '[unclosed' "$DIR")
node_ec=$(ec_node '[unclosed' "$DIR")

check_error() { [ "$1" -ne 0 ] && echo "✅ 报错 (exit $1)" || echo "⚠️ 静默退出"; }
rg_r=$(check_error "$rg_ec"); grep_r=$(check_error "$grep_ec")
ag_r=$(check_error "$ag_ec"); node_r=$(check_error "$node_ec")
echo "| **S-F07** 无效正则报错 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── S-F08: 二进制文件处理 ─────────────────────────────────────────────────────
info "S-F08: binary file handling"
BINARY_FILE="$DIR/.bench-binary-test"
dd if=/dev/urandom of="$BINARY_FILE" bs=1024 count=1 2>/dev/null
# shellcheck disable=SC2064
trap "rm -f '$BINARY_FILE'" EXIT

BIN_DIR=$(dirname "$BINARY_FILE")
check_binary() {
  local out="$1"
  local binary_notice; binary_notice=$(echo "$out" | grep -i 'binary' | grep -c '.' 2>/dev/null || echo 0)
  [ "$binary_notice" -gt 0 ] && echo "✅ 标注 Binary" || echo "⚠️ 静默跳过"
}

rg_out=$(run_rg --no-ignore --hidden 'test' "$BIN_DIR")
grep_out=$(run_grep -rn 'test' "$BIN_DIR")
ag_out=$(run_ag -u 'test' "$BIN_DIR")
node_out=$(run_node 'test' "$BIN_DIR")

rg_r=$(check_binary "$rg_out"); grep_r=$(check_binary "$grep_out")
ag_r=$(check_binary "$ag_out"); node_r=$(check_binary "$node_out")
echo "| **S-F08** 二进制文件处理 | $rg_r | $grep_r | $ag_r | $node_r |" >> "$OUT"

# ── 收尾 ──────────────────────────────────────────────────────────────────────
{
  echo ""
  echo "> 生成时间：$(date '+%Y-%m-%d %H:%M:%S')"
} >> "$OUT"

ok "Done! Results written to $OUT"
echo ""
cat "$OUT"
