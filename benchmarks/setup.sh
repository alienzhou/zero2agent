#!/usr/bin/env bash
# 一键安装所有前置工具并准备 benchmark 语料
# 用法：./benchmarks/setup.sh [--corpus-only | --tools-only]
#
# 前置条件：macOS + Homebrew（Linux 用户请手动安装下列工具）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

err()    { echo -e "${RED}[setup]${NC} $*" >&2; }
ok()     { echo -e "${GREEN}[setup]${NC} $*"; }
info()   { echo -e "${CYAN}[setup]${NC} $*"; }
warn()   { echo -e "${YELLOW}[setup]${NC} $*"; }
header() { echo -e "\n${BOLD}$*${NC}"; }

MODE="${1:-}"

# ── 安装外部工具（Homebrew） ──────────────────────────────────────────────────
install_tools() {
  header "Step 1: 检查并安装外部工具"

  if ! command -v brew &>/dev/null; then
    err "Homebrew not found. Install it first: https://brew.sh"
    err "Or manually install: hyperfine, ripgrep, fd, the_silver_searcher"
    exit 1
  fi

  local tools_to_install=()
  declare -A TOOL_BREW=(
    [hyperfine]="hyperfine"
    [rg]="ripgrep"
    [fd]="fd"
    [ag]="the_silver_searcher"
  )

  for cmd in hyperfine rg fd ag; do
    if command -v "$cmd" &>/dev/null; then
      ok "$cmd already installed ($(command -v "$cmd"))"
    else
      warn "$cmd not found, will install ${TOOL_BREW[$cmd]}"
      tools_to_install+=("${TOOL_BREW[$cmd]}")
    fi
  done

  if [ "${#tools_to_install[@]}" -gt 0 ]; then
    info "Installing: ${tools_to_install[*]}"
    brew install "${tools_to_install[@]}"
  fi

  # 验证 Node.js 版本（需要 v22+）
  if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js v22+ first."
    exit 1
  fi
  local node_version
  node_version=$(node -e "process.stdout.write(process.version)")
  local node_major
  node_major=$(echo "$node_version" | cut -d. -f1 | tr -d 'v')
  if [ "$node_major" -lt 22 ]; then
    err "Node.js v22+ required for fs.glob support. Current: $node_version"
    exit 1
  fi
  ok "Node.js $node_version"

  # 验证 pnpm（用于安装语料依赖）
  if ! command -v pnpm &>/dev/null; then
    err "pnpm not found. Install: npm install -g pnpm"
    exit 1
  fi
  ok "pnpm $(pnpm --version)"

  header "Step 2: 安装 npm glob 包"
  (cd "$SCRIPT_DIR" && npm install)
  ok "npm glob installed in $SCRIPT_DIR/node_modules"
}

# ── 准备语料 ──────────────────────────────────────────────────────────────────
prepare_corpus() {
  header "Step 3: 准备 benchmark 语料"
  info "语料将克隆到 /tmp/zero2agent-bench/corpus/ (不在项目目录内)"
  info "medium (Vite) + large (Next.js) 首次需要下载并安装依赖，耗时较长"
  echo ""

  bash "$SCRIPT_DIR/corpus/prepare.sh" all
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
header "Zero2Agent Benchmark Setup"
echo ""

case "$MODE" in
  --tools-only)
    install_tools
    ;;
  --corpus-only)
    prepare_corpus
    ;;
  "")
    install_tools
    prepare_corpus
    ;;
  *)
    err "Unknown option: $MODE"
    echo "Usage: $0 [--corpus-only | --tools-only]"
    exit 1
    ;;
esac

echo ""
header "Setup complete!"
echo ""
echo "  Run benchmarks:"
echo "    ./benchmarks/run-all.sh                     # 全量运行"
echo "    ./benchmarks/run-all.sh glob                # 只跑 glob"
echo "    ./benchmarks/run-all.sh grep                # 只跑 grep"
echo "    ./benchmarks/glob/performance.sh small      # 指定语料"
echo ""
echo "  Results will be in: benchmarks/results/"
