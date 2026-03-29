#!/usr/bin/env bash
# Glob 性能 benchmark：用 hyperfine 对比四个工具在不同语料上的表现
# 用法：./benchmarks/glob/performance.sh [small|medium|large|all]
#
# 公平性保证：
#   - rg/fd 使用 --no-ignore（不加 --hidden），与 npm-glob/fs-glob 遍历范围对齐
#     ∵ Node 24 的 fs.glob 不支持 dot 选项，无法遍历隐藏目录
#   - stdout 重定向到 /dev/null，排除终端 I/O 干扰
#   - 统一 --warmup 3 --min-runs 10

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WRAPPERS="$SCRIPT_DIR/wrappers"
CORPUS_ROOT="/tmp/zero2agent-bench/corpus"
RESULTS_DIR="$BENCH_DIR/results/glob"

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
for tool in hyperfine rg fd; do
  if ! command -v "$tool" &>/dev/null; then
    err "$tool not installed. Run ./benchmarks/setup.sh first."
    exit 1
  fi
done

mkdir -p "$RESULTS_DIR"

# ── 结果校验：运行前确认各工具找到相同数量的文件 ──────────────────────────────
verify_counts() {
  local scenario="$1"
  local dir="$2"
  local rg_cmd="$3"
  local fd_cmd="$4"
  local npm_cmd="$5"
  local node_cmd="$6"

  local rg_count fd_count npm_count node_count
  rg_count=$({ eval "$rg_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  fd_count=$({ eval "$fd_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  npm_count=$({ eval "$npm_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')
  node_count=$({ eval "$node_cmd" 2>/dev/null || true; } | wc -l | tr -d ' ')

  info "$scenario counts: rg=$rg_count fd=$fd_count npm_glob=$npm_count node_fs_glob=$node_count"

  # 宽松校验：允许小偏差（不同工具对符号链接等边缘情况处理可能略有差异）
  local max min
  max=$(echo -e "$rg_count\n$fd_count\n$npm_count\n$node_count" | sort -n | tail -1)
  min=$(echo -e "$rg_count\n$fd_count\n$npm_count\n$node_count" | sort -n | head -1)
  local diff=$((max - min))
  if [ "$diff" -gt 10 ]; then
    warn "$scenario: file counts differ by $diff (max=$max min=$min) — results may not be directly comparable"
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
  info "Starting glob performance on $corpus corpus ($file_count files)"
  echo ""

  # ── G-P01: 全量列文件 ──────────────────────────────────────────────────────
  info "G-P01: all files (pure traversal)"
  verify_counts "G-P01" "$DIR" \
    "rg --files --no-ignore '$DIR'" \
    "fd --no-ignore . '$DIR'" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*' '$DIR'" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg --files" \
    -n "fd" \
    -n "npm glob" \
    -n "node fs.glob" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-G-P01.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-G-P01.json" \
    "rg --files --no-ignore '$DIR' > /dev/null" \
    "fd --no-ignore . '$DIR' > /dev/null" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*' '$DIR' > /dev/null"

  # ── G-P02: 扩展名过滤 *.ts ────────────────────────────────────────────────
  info "G-P02: extension filter (*.ts)"
  verify_counts "G-P02" "$DIR" \
    "rg --files --no-ignore --glob '*.ts' '$DIR'" \
    "fd --no-ignore -g '*.ts' '$DIR'" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.ts' '$DIR'" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.ts' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg --files" \
    -n "fd" \
    -n "npm glob" \
    -n "node fs.glob" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-G-P02.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-G-P02.json" \
    "rg --files --no-ignore --glob '*.ts' '$DIR' > /dev/null" \
    "fd --no-ignore -g '*.ts' '$DIR' > /dev/null" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.ts' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.ts' '$DIR' > /dev/null"

  # ── G-P03: 多扩展名 {ts,tsx,js,jsx} ──────────────────────────────────────
  info "G-P03: multi-extension ({ts,tsx,js,jsx})"
  verify_counts "G-P03" "$DIR" \
    "rg --files --no-ignore --glob '*.{ts,tsx,js,jsx}' '$DIR'" \
    "fd --no-ignore -e ts -e tsx -e js -e jsx . '$DIR'" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.{ts,tsx,js,jsx}' '$DIR'" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.{ts,tsx,js,jsx}' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg --files" \
    -n "fd" \
    -n "npm glob" \
    -n "node fs.glob" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-G-P03.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-G-P03.json" \
    "rg --files --no-ignore --glob '*.{ts,tsx,js,jsx}' '$DIR' > /dev/null" \
    "fd --no-ignore -e ts -e tsx -e js -e jsx . '$DIR' > /dev/null" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.{ts,tsx,js,jsx}' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.{ts,tsx,js,jsx}' '$DIR' > /dev/null"

  # ── G-P04: 精确文件名 package.json ────────────────────────────────────────
  info "G-P04: exact filename (package.json)"
  verify_counts "G-P04" "$DIR" \
    "rg --files --no-ignore --glob 'package.json' '$DIR'" \
    "fd --no-ignore -g 'package.json' '$DIR'" \
    "node '$WRAPPERS/npm-glob.mjs' '**/package.json' '$DIR'" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/package.json' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg --files" \
    -n "fd" \
    -n "npm glob" \
    -n "node fs.glob" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-G-P04.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-G-P04.json" \
    "rg --files --no-ignore --glob 'package.json' '$DIR' > /dev/null" \
    "fd --no-ignore -g 'package.json' '$DIR' > /dev/null" \
    "node '$WRAPPERS/npm-glob.mjs' '**/package.json' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/package.json' '$DIR' > /dev/null"

  # ── G-P05: 深层路径 **/*.test.ts ─────────────────────────────────────────
  info "G-P05: deep path (**/*.test.ts)"
  verify_counts "G-P05" "$DIR" \
    "rg --files --no-ignore --glob '**/*.test.ts' '$DIR'" \
    "fd --no-ignore -g '*.test.ts' . '$DIR'" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.test.ts' '$DIR'" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.test.ts' '$DIR'"

  hyperfine \
    --warmup 3 --min-runs 10 \
    -n "rg --files" \
    -n "fd" \
    -n "npm glob" \
    -n "node fs.glob" \
    --export-markdown "$RESULTS_DIR/perf-${corpus}-G-P05.md" \
    --export-json    "$RESULTS_DIR/perf-${corpus}-G-P05.json" \
    "rg --files --no-ignore --glob '**/*.test.ts' '$DIR' > /dev/null" \
    "fd --no-ignore -g '*.test.ts' . '$DIR' > /dev/null" \
    "node '$WRAPPERS/npm-glob.mjs' '**/*.test.ts' '$DIR' > /dev/null" \
    "node '$WRAPPERS/node-fs-glob.mjs' '**/*.test.ts' '$DIR' > /dev/null"

  ok "Completed $corpus corpus. Results in $RESULTS_DIR/"
}

# ── 合并各 corpus 结果到 performance.md ──────────────────────────────────────
merge_results() {
  local out="$RESULTS_DIR/performance.md"
  {
    echo "# Glob 性能测试汇总"
    echo ""
    for corpus in small medium large; do
      echo "## $corpus corpus"
      echo ""
      for scenario in G-P01 G-P02 G-P03 G-P04 G-P05; do
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

# ── Node 启动开销基线 ─────────────────────────────────────────────────────────
measure_node_baseline() {
  local out="$RESULTS_DIR/node-baseline.md"
  info "Measuring Node.js startup baseline..."
  hyperfine \
    --warmup 3 --min-runs 10 \
    --export-markdown "$out" \
    'node -e ""'
  ok "Node baseline written to $out"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
measure_node_baseline

if [ "$CORPUS" = "all" ]; then
  for c in small medium large; do
    run_for_corpus "$c"
  done
else
  run_for_corpus "$CORPUS"
fi

merge_results
