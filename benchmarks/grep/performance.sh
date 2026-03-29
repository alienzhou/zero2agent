#!/usr/bin/env bash
# Grep 性能 benchmark：用 hyperfine 对比四个工具在不同语料上的表现
# 用法：./benchmarks/grep/performance.sh [small|medium|large|all]
#
# 公平性保证：
#   - rg/ag 使用 --no-ignore/-u，与 grep/node 的遍历范围对齐
#   - stdout 重定向到 /dev/null，排除终端 I/O 干扰
#   - 统一 --warmup 3 --min-runs 10

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPERS="$SCRIPT_DIR/wrappers"
CORPUS_ROOT="/tmp/zero2agent-bench/corpus"
RESULTS_DIR="$BENCH_DIR/results/grep"

CORPUS="${1:-all}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}[perf]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[perf]${NC} $*"; }
info() { echo -e "${CYAN}[perf]${NC} $*"; }
warn() { echo -e "${YELLOW}[perf]${NC} $*"; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
for tool in hyperfine rg ag; do
  if ! command -v "$tool" &>/dev/null; then
    err "$tool not installed. Run ./benchmarks/setup.sh first."
    exit 1
  fi
done

mkdir -p "$RESULTS_DIR"

# ── 结果校验：运行前确认各工具匹配行数相近 ────────────────────────────────────
verify_counts() {
  local scenario="$1"
  local dir="$2"
  local rg_cmd="$3"
  local grep_cmd="$4"
  local ag_cmd="$5"
  local node_cmd="$6"

  local rg_count grep_count ag_count node_count
  rg_count=$({ eval "$rg_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  grep_count=$({ eval "$grep_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  ag_count=$({ eval "$ag_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  node_count=$({ eval "$node_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')

  info "$scenario counts: rg=$rg_count grep=$grep_count ag=$ag_count node_grep=$node_count"

  local max min
  max=$(echo -e "$rg_count\n$grep_count\n$ag_count\n$node_count" | sort -n | tail -1)
  min=$(echo -e "$rg_count\n$grep_count\n$ag_count\n$node_count" | sort -n | head -1)
  local diff=$((max - min))
  if [ "$diff" -gt 100 ]; then
    warn "$scenario: match counts differ by $diff (max=$max min=$min)"
  fi
}

# ── 单语料性能测试 ────────────────────────────────────────────────────────────
run_for_corpus() {
  local corpus="$1"
  local DIR="$CORPUS_ROOT/$corpus"

  if [ ! -d "$DIR" ]; then
    warn "$corpus corpus not found: $DIR"
    warn "Run ./benchmarks/corpus/prepare.sh $corpus first."
    return
  fi

  local file_count
  file_count=$(find "$DIR" -type f | wc -l | tr -d ' ')
  info "Starting grep performance on $corpus corpus ($file_count files)"
  echo ""

  # ── S-P01: 高频字面量 "import" ────────────────────────────────────────────
  info "S-P01: high-frequency literal (import)"
  verify_counts "S-P01" "$DIR" \
    "rg --no-ignore --hidden 'import' '$DIR'" \
    "grep -rn 'import' '$DIR'" \
    "ag -u 'import' '$DIR'" \
    "node '$WRAPPERS/node-grep.mjs' 'import' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg" \
    -n "grep" \
    -n "ag" \
    -n "node (自实现)" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-S-P01.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-S-P01.json" \
    "rg --no-ignore --hidden 'import' '$DIR' > /dev/null" \
    "grep -rn 'import' '$DIR' > /dev/null" \
    "ag -u 'import' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-grep.mjs' 'import' '$DIR' > /dev/null"

  # ── S-P02: 低频字面量 "deprecated" ────────────────────────────────────────
  info "S-P02: low-frequency literal (deprecated)"
  verify_counts "S-P02" "$DIR" \
    "rg --no-ignore --hidden 'deprecated' '$DIR'" \
    "grep -rn 'deprecated' '$DIR'" \
    "ag -u 'deprecated' '$DIR'" \
    "node '$WRAPPERS/node-grep.mjs' 'deprecated' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg" \
    -n "grep" \
    -n "ag" \
    -n "node (自实现)" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-S-P02.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-S-P02.json" \
    "rg --no-ignore --hidden 'deprecated' '$DIR' > /dev/null" \
    "grep -rn 'deprecated' '$DIR' > /dev/null" \
    "ag -u 'deprecated' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-grep.mjs' 'deprecated' '$DIR' > /dev/null"

  # ── S-P03: 简单正则 function\s+\w+ ────────────────────────────────────────
  # macOS BSD grep 不支持 -P，改用 -E 加 POSIX 字符类
  info "S-P03: simple regex (function[[:space:]]+[[:alnum:]_]+)"
  verify_counts "S-P03" "$DIR" \
    "rg --no-ignore --hidden 'function\s+\w+' '$DIR'" \
    "grep -rn -E 'function[[:space:]]+[[:alnum:]_]+' '$DIR'" \
    "ag -u 'function\s+\w+' '$DIR'" \
    "node '$WRAPPERS/node-grep.mjs' 'function\\s+\\w+' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg" \
    -n "grep" \
    -n "ag" \
    -n "node (自实现)" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-S-P03.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-S-P03.json" \
    "rg --no-ignore --hidden 'function\s+\w+' '$DIR' > /dev/null" \
    "grep -rn -E 'function[[:space:]]+[[:alnum:]_]+' '$DIR' > /dev/null" \
    "ag -u 'function\s+\w+' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-grep.mjs' 'function\\s+\\w+' '$DIR' > /dev/null"

  # ── S-P04: 复杂正则 [A-Z][a-z]+Error ─────────────────────────────────────
  # macOS BSD grep 不支持 -P（\b word boundary），改用 -E
  info "S-P04: complex regex ([A-Z][a-z]+Error)"
  verify_counts "S-P04" "$DIR" \
    "rg --no-ignore --hidden '\b[A-Z][a-z]+Error\b' '$DIR'" \
    "grep -rn -E '[A-Z][a-z]+Error' '$DIR'" \
    "ag -u '\b[A-Z][a-z]+Error\b' '$DIR'" \
    "node '$WRAPPERS/node-grep.mjs' '\b[A-Z][a-z]+Error\b' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg" \
    -n "grep" \
    -n "ag" \
    -n "node (自实现)" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-S-P04.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-S-P04.json" \
    "rg --no-ignore --hidden '\b[A-Z][a-z]+Error\b' '$DIR' > /dev/null" \
    "grep -rn -E '[A-Z][a-z]+Error' '$DIR' > /dev/null" \
    "ag -u '\b[A-Z][a-z]+Error\b' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-grep.mjs' '\b[A-Z][a-z]+Error\b' '$DIR' > /dev/null"

  # ── S-P05: 大小写不敏感 "readme" -i ───────────────────────────────────────
  info "S-P05: case-insensitive (readme -i)"
  verify_counts "S-P05" "$DIR" \
    "rg --no-ignore --hidden -i 'readme' '$DIR'" \
    "grep -rn -i 'readme' '$DIR'" \
    "ag -u -i 'readme' '$DIR'" \
    "node '$WRAPPERS/node-grep.mjs' -i 'readme' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg" \
    -n "grep" \
    -n "ag" \
    -n "node (自实现)" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-S-P05.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-S-P05.json" \
    "rg --no-ignore --hidden -i 'readme' '$DIR' > /dev/null" \
    "grep -rn -i 'readme' '$DIR' > /dev/null" \
    "ag -u -i 'readme' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-grep.mjs' -i 'readme' '$DIR' > /dev/null"

  ok "Completed $corpus corpus. Results in $RESULTS_DIR/"
}

# ── 合并各 corpus 结果到 performance.md ──────────────────────────────────────
merge_results() {
  local out="$RESULTS_DIR/performance.md"
  {
    echo "# Grep 性能测试汇总"
    echo ""
    for corpus in small medium large; do
      echo "## $corpus corpus"
      echo ""
      for scenario in S-P01 S-P02 S-P03 S-P04 S-P05; do
        local f="$RESULTS_DIR/perf-${corpus}-${scenario}.md"
        if [ -f "$f" ]; then
          echo "### $scenario"
          cat "$f"
          echo ""
        fi
      done
    done
    echo "> 生成时间：$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$out"
  ok "Merged results written to $out"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
if [ "$CORPUS" = "all" ]; then
  for c in small medium large; do
    run_for_corpus "$c"
  done
else
  run_for_corpus "$CORPUS"
fi

merge_results
