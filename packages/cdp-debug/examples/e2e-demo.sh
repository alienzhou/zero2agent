#!/usr/bin/env bash
# CDP Debug 端到端演示脚本
# 完整流程：启动 → 设断点 → 命中 → 读变量 → 读调用栈 → eval → 停止

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$DIR/.." && pwd)"
CLI="node $PKG_DIR/dist/cli/index.js"
TARGET="$DIR/target.js"
CWD="$DIR"

INSPECT_PORT=9234
SERVER_PORT=7498

echo ""
echo "=========================================="
echo "  CDP Debug — End-to-End Demo"
echo "=========================================="
echo ""

cleanup() {
  echo ""
  echo "[cleanup] Stopping..."
  $CLI stop --cwd "$CWD" 2>/dev/null || true
  kill $(lsof -ti:$INSPECT_PORT 2>/dev/null) 2>/dev/null || true
}
trap cleanup EXIT

# ── 1. 启动（--inspect-brk：在第一行暂停）──
echo "── 1. Start target with --inspect-brk ──"
$CLI start "$TARGET" --brk --cwd "$CWD" --inspect-port $INSPECT_PORT --server-port $SERVER_PORT &
sleep 3
echo ""

# ── 2. 确认暂停 ──
echo "── 2. Status (paused at first line) ──"
$CLI status --cwd "$CWD"
echo ""

# ── 3. 设断点 ──
echo "── 3. Set breakpoints ──"
echo '  → line 3: "const result = a + b" (inside add)'
$CLI bp set "$TARGET:3" --cwd "$CWD"
echo ""
echo '  → line 8: "const msg = ..." (inside greet)'
$CLI bp set "$TARGET:8" --cwd "$CWD"
echo ""

# ── 4. Resume → 命中 add(3, 7) ──
echo "── 4. Resume → hit add(3, 7) ──"
$CLI resume --cwd "$CWD"
$CLI wait --cwd "$CWD" --timeout 5000
echo ""

echo "  Call stack:"
$CLI stack --cwd "$CWD"
echo ""

echo "  Variables (a=3, b=7):"
$CLI vars --cwd "$CWD"
echo ""

echo '  eval "a + b":'
$CLI eval "a + b" --cwd "$CWD"
echo ""

# ── 5. Resume → 命中 add(10, 5) ──
echo "── 5. Resume → hit add(10, 5) (second call) ──"
$CLI resume --cwd "$CWD"
$CLI wait --cwd "$CWD" --timeout 5000
echo ""

echo "  Variables (a=10, b=5):"
$CLI vars --cwd "$CWD"
echo ""

echo '  eval "a * b":'
$CLI eval "a * b" --cwd "$CWD"
echo ""

# ── 6. Resume → 命中 greet('Zero2Agent') ──
echo "── 6. Resume → hit greet('Zero2Agent') ──"
$CLI resume --cwd "$CWD"
$CLI wait --cwd "$CWD" --timeout 5000
echo ""

echo "  Call stack:"
$CLI stack --cwd "$CWD"
echo ""

echo "  Variables:"
$CLI vars --cwd "$CWD"
echo ""

echo '  eval "name.toUpperCase()":'
$CLI eval "name.toUpperCase()" --cwd "$CWD"
echo ""

# ── 7. 停止 ──
echo "── 7. Stop ──"
$CLI stop --cwd "$CWD"
trap - EXIT
echo ""

echo "=========================================="
echo "  Demo Complete!"
echo "=========================================="
