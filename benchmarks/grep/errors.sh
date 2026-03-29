#!/usr/bin/env bash
# Grep 错误反馈测试：捕获各工具面对异常输入时的错误信息质量
# 用法：./benchmarks/grep/errors.sh
# 输出：benchmarks/results/grep/errors.md

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

err()  { echo -e "${RED}[errors]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[errors]${NC} $*"; }
info() { echo -e "${CYAN}[errors]${NC} $*"; }

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
OUT="$RESULTS_DIR/errors.md"

# ── 辅助：运行命令，捕获 exit code + stderr ───────────────────────────────────
capture_error() {
  local ec stderr_out
  stderr_out=$(eval "$1" 2>&1 1>/dev/null) && ec=0 || ec=$?
  stderr_out=$(echo "$stderr_out" | head -5 | tr '\n' ' ')
  echo "$ec|$stderr_out"
}

format_row() {
  local label="$1"
  local rg_out="$2"
  local grep_out="$3"
  local ag_out="$4"
  local node_out="$5"

  local rg_ec="${rg_out%%|*}";   local rg_msg="${rg_out#*|}"
  local grep_ec="${grep_out%%|*}"; local grep_msg="${grep_out#*|}"
  local ag_ec="${ag_out%%|*}";   local ag_msg="${ag_out#*|}"
  local node_ec="${node_out%%|*}"; local node_msg="${node_out#*|}"

  echo "### $label"
  echo ""
  echo "| 工具 | exit code | 错误信息摘要 |"
  echo "|------|-----------|-------------|"
  echo "| rg | \`$rg_ec\` | \`${rg_msg:0:80}\` |"
  echo "| grep | \`$grep_ec\` | \`${grep_msg:0:80}\` |"
  echo "| ag | \`$ag_ec\` | \`${ag_msg:0:80}\` |"
  echo "| node (自实现) | \`$node_ec\` | \`${node_msg:0:80}\` |"
  echo ""
}

# 创建权限受限目录
PERM_DIR="/tmp/zero2agent-bench-grep-noperm-$$"
mkdir -p "$PERM_DIR"
chmod 000 "$PERM_DIR"
trap 'chmod 755 "$PERM_DIR" 2>/dev/null; rm -rf "$PERM_DIR"' EXIT

# ── 运行四组错误测试 ──────────────────────────────────────────────────────────
info "E01: invalid regex ([unclosed)"
E01_RG=$(capture_error   "rg --no-ignore --hidden '[unclosed' '$DIR'")
E01_GREP=$(capture_error "grep -rn -E '[unclosed' '$DIR'")
E01_AG=$(capture_error   "ag -u '[unclosed' '$DIR'")
E01_NODE=$(capture_error "node '$WRAPPERS/node-grep.mjs' '[unclosed' '$DIR'")

info "E02: nonexistent directory"
NODIR="/tmp/zero2agent-bench-grep-nonexistent-$$"
E02_RG=$(capture_error   "rg --no-ignore --hidden 'import' '$NODIR'")
E02_GREP=$(capture_error "grep -rn 'import' '$NODIR'")
E02_AG=$(capture_error   "ag -u 'import' '$NODIR'")
E02_NODE=$(capture_error "node '$WRAPPERS/node-grep.mjs' 'import' '$NODIR'")

info "E03: permission denied directory"
E03_RG=$(capture_error   "rg --no-ignore --hidden 'import' '$PERM_DIR'")
E03_GREP=$(capture_error "grep -rn 'import' '$PERM_DIR'")
E03_AG=$(capture_error   "ag -u 'import' '$PERM_DIR'")
E03_NODE=$(capture_error "node '$WRAPPERS/node-grep.mjs' 'import' '$PERM_DIR'")

info "E04: empty pattern string"
E04_RG=$(capture_error   "rg --no-ignore --hidden '' '$DIR'")
E04_GREP=$(capture_error "grep -rn '' '$DIR'")
E04_AG=$(capture_error   "ag -u '' '$DIR'")
E04_NODE=$(capture_error "node '$WRAPPERS/node-grep.mjs' '' '$DIR'")

# ── 生成 Markdown ─────────────────────────────────────────────────────────────
info "Writing results to $OUT"

{
  echo "# Grep 错误反馈测试"
  echo ""
  echo "> 评估各工具在异常输入下的错误信息质量。"
  echo "> Agent 可用性：错误信息是否清晰到可以直接返回给模型修正。"
  echo ""

  format_row "E01：无效正则 (\`[unclosed\`)" "$E01_RG" "$E01_GREP" "$E01_AG" "$E01_NODE"
  format_row "E02：目录不存在" "$E02_RG" "$E02_GREP" "$E02_AG" "$E02_NODE"
  format_row "E03：权限不足" "$E03_RG" "$E03_GREP" "$E03_AG" "$E03_NODE"
  format_row "E04：空 pattern" "$E04_RG" "$E04_GREP" "$E04_AG" "$E04_NODE"

  echo "> 生成时间：$(date '+%Y-%m-%d %H:%M:%S')"
} > "$OUT"

ok "Done! Results written to $OUT"
echo ""
cat "$OUT"
