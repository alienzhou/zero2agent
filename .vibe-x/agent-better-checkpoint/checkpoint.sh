#!/usr/bin/env bash
#
# checkpoint.sh — Create semantic Git checkpoint commits
#
# AI provides descriptive content (subject + body). This script:
# 1. Truncates user-prompt (≤60 chars, head+tail)
# 2. Appends metadata via git interpret-trailers
# 3. Runs git add -A && git commit
#
# Usage:
#   checkpoint.sh <message> [user-prompt] [--type auto|fallback]

set -euo pipefail

# ============================================================
# Argument parsing
# ============================================================
MESSAGE="${1:-}"
USER_PROMPT="${2:-}"
CHECKPOINT_TYPE="auto"

shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --type)
            CHECKPOINT_TYPE="${2:-auto}"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [[ -z "$MESSAGE" ]]; then
    echo "Error: commit message is required" >&2
    echo "Usage: checkpoint.sh <message> [user-prompt] [--type auto|fallback]" >&2
    exit 1
fi

# ============================================================
# Platform detection
# ============================================================
detect_platform() {
    # 优先检测运行时环境变量（谁在调用），而非安装态（command -v）
    if [[ -n "${CURSOR_AGENT:-}" ]] || [[ -n "${CURSOR_TRACE_ID:-}" ]] || [[ -n "${CURSOR_VERSION:-}" ]]; then
        echo "cursor"
    elif [[ -n "${CLAUDE_CODE:-}" ]]; then
        echo "claude-code"
    else
        echo "unknown"
    fi
}

AGENT_PLATFORM=$(detect_platform)

# ============================================================
# User-Prompt truncation (≤60 chars, head+tail + ellipsis)
# ============================================================
truncate_prompt() {
    local prompt="$1"
    local max_len=60
    local len=${#prompt}

    if [[ $len -le $max_len ]]; then
        echo "$prompt"
        return
    fi

    local head_len=$(( (max_len - 3) / 2 ))
    local tail_len=$(( max_len - 3 - head_len ))
    local head="${prompt:0:$head_len}"
    local tail="${prompt:$((len - tail_len)):$tail_len}"
    echo "${head}...${tail}"
}

TRUNCATED_PROMPT=""
if [[ -n "$USER_PROMPT" ]]; then
    TRUNCATED_PROMPT=$(truncate_prompt "$USER_PROMPT")
fi

# ============================================================
# Check for changes
# ============================================================
has_changes() {
    # Staged changes
    if ! git diff --cached --quiet 2>/dev/null; then
        return 0
    fi
    # Unstaged changes
    if ! git diff --quiet 2>/dev/null; then
        return 0
    fi
    # Untracked files
    if [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
        return 0
    fi
    return 1
}

if ! has_changes; then
    echo "No changes to commit."
    exit 0
fi

# ============================================================
# git add -A
# ============================================================
git add -A

# ============================================================
# Build trailers and commit
# ============================================================
TRAILER_ARGS=(
    --trailer "Agent: ${AGENT_PLATFORM}"
    --trailer "Checkpoint-Type: ${CHECKPOINT_TYPE}"
)

if [[ -n "$TRUNCATED_PROMPT" ]]; then
    TRAILER_ARGS+=(--trailer "User-Prompt: ${TRUNCATED_PROMPT}")
fi

echo "$MESSAGE" | git interpret-trailers "${TRAILER_ARGS[@]}" | git commit -F -

echo "Checkpoint committed successfully."
