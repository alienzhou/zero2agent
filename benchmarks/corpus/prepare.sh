#!/usr/bin/env bash
# 准备 benchmark 语料：small（项目拷贝）、medium（Vite v8.0.3）、large（Next.js v16.2.1）
# 用法：./benchmarks/corpus/prepare.sh [small|medium|large|all]
#
# 语料存放位置：/tmp/zero2agent-bench/corpus/{small,medium,large}
# 不在项目目录内，避免污染项目。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BENCH_ROOT="/tmp/zero2agent-bench/corpus"
RESULTS_DIR="$SCRIPT_DIR/../results"

# 语料版本（与 commits.json 一致）
MEDIUM_REPO="https://github.com/vitejs/vite.git"
MEDIUM_TAG="v8.0.3"
LARGE_REPO="https://github.com/vercel/next.js.git"
LARGE_TAG="v16.2.1"

TARGET="${1:-all}"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}[corpus]${NC} $*" >&2; }
ok()   { echo -e "${GREEN}[corpus]${NC} $*"; }
info() { echo -e "${CYAN}[corpus]${NC} $*"; }
warn() { echo -e "${YELLOW}[corpus]${NC} $*"; }

mkdir -p "$BENCH_ROOT"

# ── small: rsync 项目拷贝 ─────────────────────────────────────────────────────
prepare_small() {
  local dest="$BENCH_ROOT/small"
  if [ -d "$dest" ]; then
    warn "small corpus already exists ($dest)"
    warn "Delete and re-run to refresh: rm -rf $dest"
    return
  fi
  info "Preparing small corpus (zero2agent project copy)..."
  mkdir -p "$dest"
  rsync -a --exclude='.git' "$PROJECT_ROOT/" "$dest/"
  # 创建空 .git 目录，让 rg/fd 能识别并应用 .gitignore 规则
  mkdir -p "$dest/.git"
  ok "small ready: $dest"
}

# ── medium: Vite ──────────────────────────────────────────────────────────────
prepare_medium() {
  local dest="$BENCH_ROOT/medium"
  if [ -d "$dest" ]; then
    warn "medium corpus already exists ($dest)"
    warn "Delete and re-run to refresh: rm -rf $dest"
    return
  fi
  info "Cloning Vite $MEDIUM_TAG..."
  git clone --depth 1 --branch "$MEDIUM_TAG" "$MEDIUM_REPO" "$dest"
  info "Installing Vite dependencies..."
  (cd "$dest" && pnpm install --frozen-lockfile 2>&1 | tail -3)
  ok "medium ready: $dest"
}

# ── large: Next.js ────────────────────────────────────────────────────────────
prepare_large() {
  local dest="$BENCH_ROOT/large"
  if [ -d "$dest" ]; then
    warn "large corpus already exists ($dest)"
    warn "Delete and re-run to refresh: rm -rf $dest"
    return
  fi
  info "Cloning Next.js $LARGE_TAG (this may take a while)..."
  git clone --depth 1 --branch "$LARGE_TAG" "$LARGE_REPO" "$dest"
  info "Installing Next.js dependencies (5-10 minutes)..."
  (cd "$dest" && pnpm install --frozen-lockfile 2>&1 | tail -3)
  ok "large ready: $dest"
}

# ── 运行 ──────────────────────────────────────────────────────────────────────
case "$TARGET" in
  small)  prepare_small ;;
  medium) prepare_medium ;;
  large)  prepare_large ;;
  all)    prepare_small; prepare_medium; prepare_large ;;
  *)      err "Unknown target: $TARGET (use small|medium|large|all)"; exit 1 ;;
esac

# ── 统计文件数，写入 manifest ──────────────────────────────────────────────────
mkdir -p "$RESULTS_DIR"
MANIFEST="$RESULTS_DIR/corpus-manifest.json"

info "Counting files..."
printf '{\n' > "$MANIFEST"
first=true
for size in small medium large; do
  dir="$BENCH_ROOT/$size"
  [ -d "$dir" ] || continue
  file_count=$(find "$dir" -type f | wc -l | tr -d ' ')
  dir_count=$(find "$dir" -type d | wc -l | tr -d ' ')
  [ "$first" = true ] || printf ',\n' >> "$MANIFEST"
  printf '  "%s": { "files": %s, "dirs": %s }' "$size" "$file_count" "$dir_count" >> "$MANIFEST"
  first=false
  ok "$size: $file_count files, $dir_count dirs"
done
printf '\n}\n' >> "$MANIFEST"
ok "Manifest written to $MANIFEST"
