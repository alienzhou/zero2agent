#!/usr/bin/env bash
# 运行所有 benchmark（或按类型/语料筛选）
# 用法：
#   ./benchmarks/run-all.sh                      # 全量运行
#   ./benchmarks/run-all.sh glob                 # 只跑 glob 的所有维度
#   ./benchmarks/run-all.sh grep                 # 只跑 grep 的所有维度
#   ./benchmarks/run-all.sh glob performance     # 只跑 glob 性能
#   ./benchmarks/run-all.sh grep features        # 只跑 grep 功能矩阵
#   ./benchmarks/run-all.sh glob performance small  # 指定语料

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()     { echo -e "${GREEN}[run-all]${NC} $*"; }
info()   { echo -e "${CYAN}[run-all]${NC} $*"; }
header() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }

TOOL="${1:-all}"    # all | glob | grep
DIM="${2:-all}"     # all | features | performance | errors
CORPUS="${3:-all}"  # all | small | medium | large

run_glob() {
  local dim="$1"
  local corpus="$2"

  case "$dim" in
    features|all)
      header "Glob Features"
      bash "$SCRIPT_DIR/glob/features.sh"
      ;;
  esac

  case "$dim" in
    performance|all)
      header "Glob Performance ($corpus)"
      bash "$SCRIPT_DIR/glob/performance.sh" "$corpus"
      ;;
  esac

  case "$dim" in
    errors|all)
      header "Glob Errors"
      bash "$SCRIPT_DIR/glob/errors.sh"
      ;;
  esac
}

run_grep() {
  local dim="$1"
  local corpus="$2"

  case "$dim" in
    features|all)
      header "Grep Features"
      bash "$SCRIPT_DIR/grep/features.sh"
      ;;
  esac

  case "$dim" in
    performance|all)
      header "Grep Performance ($corpus)"
      bash "$SCRIPT_DIR/grep/performance.sh" "$corpus"
      ;;
  esac

  case "$dim" in
    errors|all)
      header "Grep Errors"
      bash "$SCRIPT_DIR/grep/errors.sh"
      ;;
  esac
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
header "Zero2Agent Benchmark"
info "Tool: $TOOL | Dimension: $DIM | Corpus: $CORPUS"
echo ""

START_TIME=$(date +%s)

case "$TOOL" in
  all)
    run_glob "$DIM" "$CORPUS"
    run_grep "$DIM" "$CORPUS"
    ;;
  glob)
    run_glob "$DIM" "$CORPUS"
    ;;
  grep)
    run_grep "$DIM" "$CORPUS"
    ;;
  *)
    echo "Unknown tool: $TOOL (use all|glob|grep)"
    exit 1
    ;;
esac

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
header "All done in ${ELAPSED}s"
ok "Results written to: $SCRIPT_DIR/results/"
ls "$SCRIPT_DIR/results/" 2>/dev/null || true
