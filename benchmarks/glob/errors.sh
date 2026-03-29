#!/usr/bin/env bash
# Glob 错误反馈测试：捕获各工具面对异常输入时的错误信息质量
# 用法：./benchmarks/glob/errors.sh
# 输出：benchmarks/results/glob/errors.md

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

err()  { echo -e "${RED}[errors]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[errors]${NC} $*"; }
info() { echo -e "${CYAN}[errors]${NC} $*"; }

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
OUT="$RESULTS_DIR/errors.md"

# ── 辅助：运行命令捕获 exit code + stderr ─────────────────────────────────────
# 输出格式: "EXIT_CODE|STDERR_TEXT"
capture_error() {
  local ec stderr_out
  stderr_out=$(eval "$1" 2>&1 1>/dev/null) && ec=0 || ec=$?
  # 截断过长的错误输出
  stderr_out=$(echo "$stderr_out" | head -5 | tr '\n' ' ')
  echo "$ec|$stderr_out"
}

# ── 格式化错误行 ──────────────────────────────────────────────────────────────
format_row() {
  local label="$1"
  local rg_out="$2"
  local fd_out="$3"
  local npm_out="$4"
  local node_out="$5"

  local rg_ec="${rg_out%%|*}";   local rg_msg="${rg_out#*|}"
  local fd_ec="${fd_out%%|*}";   local fd_msg="${fd_out#*|}"
  local npm_ec="${npm_out%%|*}"; local npm_msg="${npm_out#*|}"
  local node_ec="${node_out%%|*}"; local node_msg="${node_out#*|}"

  echo "### $label"
  echo ""
  echo "| 工具 | exit code | 错误信息摘要 |"
  echo "|------|-----------|-------------|"
  echo "| rg --files | \`$rg_ec\` | \`${rg_msg:0:80}\` |"
  echo "| fd | \`$fd_ec\` | \`${fd_msg:0:80}\` |"
  echo "| npm glob | \`$npm_ec\` | \`${npm_msg:0:80}\` |"
  echo "| node fs.glob | \`$node_ec\` | \`${node_msg:0:80}\` |"
  echo ""
}

# 创建权限受限目录（E03 用）
PERM_DIR="/tmp/zero2agent-bench-noperm-$$"
mkdir -p "$PERM_DIR"
chmod 000 "$PERM_DIR"
trap 'chmod 755 "$PERM_DIR" 2>/dev/null; rm -rf "$PERM_DIR"' EXIT

# ── 运行四组错误测试 ──────────────────────────────────────────────────────────
info "E01: invalid glob pattern ([unclosed)"
E01_RG=$(capture_error  "rg --files --no-ignore --glob '[unclosed' '$DIR'")
E01_FD=$(capture_error  "fd --no-ignore -g '[unclosed' '$DIR'")
E01_NPM=$(capture_error "node '$WRAPPERS/npm-glob.mjs' '[unclosed' '$DIR'")
E01_NODE=$(capture_error "node '$WRAPPERS/node-fs-glob.mjs' '[unclosed' '$DIR'")

info "E02: nonexistent directory"
NODIR="/tmp/zero2agent-bench-nonexistent-$$"
E02_RG=$(capture_error  "rg --files --no-ignore '$NODIR'")
E02_FD=$(capture_error  "fd . '$NODIR'")
E02_NPM=$(capture_error "node '$WRAPPERS/npm-glob.mjs' '**/*' '$NODIR'")
E02_NODE=$(capture_error "node '$WRAPPERS/node-fs-glob.mjs' '**/*' '$NODIR'")

info "E03: permission denied directory"
E03_RG=$(capture_error  "rg --files --no-ignore '$PERM_DIR'")
E03_FD=$(capture_error  "fd . '$PERM_DIR'")
E03_NPM=$(capture_error "node '$WRAPPERS/npm-glob.mjs' '**/*' '$PERM_DIR'")
E03_NODE=$(capture_error "node '$WRAPPERS/node-fs-glob.mjs' '**/*' '$PERM_DIR'")

info "E04: empty pattern string"
E04_RG=$(capture_error  "rg --files --no-ignore --glob '' '$DIR'")
E04_FD=$(capture_error  "fd --no-ignore -g '' '$DIR'")
E04_NPM=$(capture_error "node '$WRAPPERS/npm-glob.mjs' '' '$DIR'")
E04_NODE=$(capture_error "node '$WRAPPERS/node-fs-glob.mjs' '' '$DIR'")

# ── 生成 Markdown ─────────────────────────────────────────────────────────────
info "Writing results to $OUT"

{
  echo "# Glob 错误反馈测试"
  echo ""
  echo "> 评估各工具在异常输入下的错误信息质量。"
  echo "> Agent 可用性：错误信息是否清晰到可以直接返回给模型修正。"
  echo ""

  format_row "E01：无效 glob pattern (\`[unclosed\`)" "$E01_RG" "$E01_FD" "$E01_NPM" "$E01_NODE"
  format_row "E02：目录不存在" "$E02_RG" "$E02_FD" "$E02_NPM" "$E02_NODE"
  format_row "E03：权限不足" "$E03_RG" "$E03_FD" "$E03_NPM" "$E03_NODE"
  format_row "E04：空 pattern" "$E04_RG" "$E04_FD" "$E04_NPM" "$E04_NODE"

  echo "> 生成时间：$(date '+%Y-%m-%d %H:%M:%S')"
} > "$OUT"

ok "Done! Results written to $OUT"
echo ""
cat "$OUT"
