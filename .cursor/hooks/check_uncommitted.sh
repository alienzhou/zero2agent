#!/usr/bin/env bash
#
# check_uncommitted.sh — Stop Hook: check for uncommitted changes
#
# Triggered at AI conversation end. Checks workspace for uncommitted changes.
# If found, outputs reminder for AI Agent to run fallback checkpoint commit.
#
# Supported platforms:
#   - Cursor: stop hook (stdin JSON with workspace_roots)
#   - Claude Code: Stop hook (stdin JSON with hook_event_name)
#
# Output protocol:
#   - OK: {} (empty JSON)
#   - Block (Cursor): {"followup_message": "..."}
#   - Block (Claude Code): {"decision": "block", "reason": "..."}
#
# Config: .vibe-x/agent-better-checkpoint/config.yml (project-level, optional)
# JSON parsing uses grep+sed, no jq dependency.

set -euo pipefail

# ============================================================
# Helpers: simple JSON field extraction (no jq)
# ============================================================

output_allow() {
    local info="${1:-}"
    if [[ -n "$info" ]]; then
        echo "[checkpoint] $info" >&2
    fi
    echo '{}'
    exit 0
}

json_bool() {
    local json="$1" field="$2"
    if echo "$json" | grep -qE "\"${field}\"[[:space:]]*:[[:space:]]*true"; then
        echo "true"
    else
        echo "false"
    fi
}

json_string() {
    local json="$1" field="$2"
    echo "$json" | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
        | sed -E "s/\"${field}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\"/\1/" \
        | head -1
}

json_workspace_root() {
    local json="$1"
    local result=""

    for field in "workspace_roots" "workspaceRoots"; do
        result=$(echo "$json" \
            | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\[[^]]*\]" \
            | grep -oE '"[^"]*"' \
            | tail -n +2 \
            | head -1 \
            | tr -d '"' || true)
        if [[ -n "$result" ]]; then
            echo "$result"
            return
        fi
    done
}

# ============================================================
# Config parsing (.vibe-x/agent-better-checkpoint/config.yml)
# ============================================================

CONFIG_FILE_NAME=".vibe-x/agent-better-checkpoint/config.yml"

parse_min_changed_lines() {
    local config="$1"
    [[ -f "$config" ]] || return 0
    local val
    val=$(grep -E '^[[:space:]]+min_changed_lines:[[:space:]]*[0-9]+' "$config" 2>/dev/null \
        | sed -E 's/.*min_changed_lines:[[:space:]]*([0-9]+).*/\1/' \
        | head -1 || true)
    echo "${val:-}"
}

parse_min_changed_files() {
    local config="$1"
    [[ -f "$config" ]] || return 0
    local val
    val=$(grep -E '^[[:space:]]+min_changed_files:[[:space:]]*[0-9]+' "$config" 2>/dev/null \
        | sed -E 's/.*min_changed_files:[[:space:]]*([0-9]+).*/\1/' \
        | head -1 || true)
    echo "${val:-}"
}

parse_passive_patterns() {
    local config="$1"
    [[ -f "$config" ]] || return 0
    local in_section=false
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$line" ]] && continue
        if [[ "$line" =~ ^passive_patterns: ]]; then
            in_section=true
            continue
        fi
        if $in_section; then
            if [[ "$line" =~ ^[[:space:]]*-[[:space:]]+(.*) ]]; then
                local val="${BASH_REMATCH[1]}"
                val="${val#\"}" && val="${val%\"}"
                val="${val#\'}" && val="${val%\'}"
                val=$(echo "$val" | sed 's/[[:space:]]*#.*//;s/[[:space:]]*$//')
                [[ -n "$val" ]] && echo "$val"
            elif [[ ! "$line" =~ ^[[:space:]] ]]; then
                break
            fi
        fi
    done < "$config"
}

# ============================================================
# Passive file matching
# ============================================================

match_pattern() {
    local file="$1" pattern="$2"

    # dir/** → match all files under dir/
    if [[ "$pattern" == *"/**" ]]; then
        local prefix="${pattern%/**}/"
        [[ "$file" == "$prefix"* ]] && return 0
        return 1
    fi

    # *.ext → match suffix
    if [[ "$pattern" == \*.* ]]; then
        local suffix="${pattern#\*}"
        [[ "$file" == *"$suffix" ]] && return 0
        return 1
    fi

    # Exact match
    [[ "$file" == "$pattern" ]] && return 0
    return 1
}

is_passive_file() {
    local file="$1"
    shift
    local patterns=("$@")
    for pattern in "${patterns[@]}"; do
        if match_pattern "$file" "$pattern"; then
            return 0
        fi
    done
    return 1
}

# ============================================================
# Changed line count
# ============================================================

count_changed_lines() {
    local workspace="$1"
    shift
    local files=("$@")
    local total=0

    if [[ ${#files[@]} -eq 0 ]]; then
        echo 0
        return
    fi

    # Tracked files: staged + unstaged diff lines (batch count)
    local tracked_lines
    tracked_lines=$(
        { git -C "$workspace" diff --numstat -- "${files[@]}" 2>/dev/null || true
          git -C "$workspace" diff --cached --numstat -- "${files[@]}" 2>/dev/null || true
        } | awk '{a=$1; d=$2; if(a!="-") t+=a; if(d!="-") t+=d} END {print t+0}'
    )
    total=$((total + tracked_lines))

    # Untracked files: total lines count as changes
    for file in "${files[@]}"; do
        if [[ -n "$(git -C "$workspace" ls-files --others --exclude-standard -- "$file" 2>/dev/null)" ]]; then
            if [[ -f "${workspace}/${file}" ]]; then
                local lines
                lines=$(wc -l < "${workspace}/${file}" 2>/dev/null || echo 0)
                total=$((total + ${lines## }))
            fi
        fi
    done

    echo "$total"
}

# ============================================================
# Platform detection
# ============================================================

detect_platform() {
    local json="$1"
    if [[ -z "$json" ]]; then
        echo "unknown"
        return
    fi
    if echo "$json" | grep -qE '"hook_event_name"|"tool_name"'; then
        echo "claude_code"
    else
        echo "cursor"
    fi
}

# ============================================================
# Workspace root detection
# ============================================================

get_workspace_root() {
    local json="$1"

    if [[ -n "$json" ]]; then
        local ws
        ws=$(json_workspace_root "$json")
        if [[ -n "$ws" ]]; then
            echo "$ws"
            return
        fi
    fi

    for env_var in CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR WORKSPACE_ROOT PROJECT_ROOT; do
        local val="${!env_var:-}"
        if [[ -n "$val" ]]; then
            echo "$val"
            return
        fi
    done

    echo "${PWD:-$(pwd)}"
}

# ============================================================
# Git operations
# ============================================================

is_git_repo() {
    git -C "$1" rev-parse --is-inside-work-tree &>/dev/null
}

get_change_summary() {
    local workspace="$1"
    local max_lines="${2:-20}"
    local output
    output=$(git -C "$workspace" status --short 2>/dev/null || true)

    if [[ -z "$output" ]]; then
        return
    fi

    local total
    total=$(echo "$output" | wc -l)

    if [[ "$total" -gt "$max_lines" ]]; then
        echo "$output" | head -n "$max_lines"
        echo "  ... and $((total - max_lines)) more files"
    else
        echo "$output"
    fi
}

# ============================================================
# Output reminder
# ============================================================

json_escape() {
    local str="$1"
    str="${str//\\/\\\\}"
    str="${str//\"/\\\"}"
    str="${str//$'\n'/\\n}"
    str="${str//$'\r'/\\r}"
    str="${str//$'\t'/\\t}"
    echo "$str"
}

output_block() {
    local message="$1"
    local platform="$2"
    local escaped
    escaped=$(json_escape "$message")

    if [[ "$platform" == "cursor" ]]; then
        echo "{\"followup_message\":\"${escaped}\"}"
    elif [[ "$platform" == "claude_code" ]]; then
        echo "{\"decision\":\"block\",\"reason\":\"${escaped}\"}"
    else
        echo "{\"message\":\"${escaped}\"}"
    fi
    exit 0
}

# ============================================================
# Main logic
# ============================================================

main() {
    local input=""
    if [[ ! -t 0 ]]; then
        input=$(cat)
    fi

    if [[ -n "$input" ]]; then
        local stop_active
        stop_active=$(json_bool "$input" "stop_hook_active")
        if [[ "$stop_active" == "true" ]]; then
            output_allow
        fi
    fi

    local platform
    platform=$(detect_platform "$input")

    local workspace
    workspace=$(get_workspace_root "$input")

    # Delegate to project-local script when present (committed with project)
    local project_script="${workspace}/.vibe-x/agent-better-checkpoint/check_uncommitted.sh"
    if [[ -f "$project_script" ]] && [[ -x "$project_script" ]]; then
        echo "$input" | bash "$project_script"
        exit $?
    fi

    if ! is_git_repo "$workspace"; then
        output_allow
    fi

    # Get all changes
    local status_output
    status_output=$(git -C "$workspace" status --porcelain 2>/dev/null)

    if [[ -z "$status_output" ]]; then
        output_allow
    fi

    # Load config
    local config_file="${workspace}/${CONFIG_FILE_NAME}"
    local -a passive_patterns=()
    local min_changed_lines=""
    local min_changed_files=""

    if [[ -f "$config_file" ]]; then
        while IFS= read -r p; do
            [[ -n "$p" ]] && passive_patterns+=("$p")
        done < <(parse_passive_patterns "$config_file")

        min_changed_lines=$(parse_min_changed_lines "$config_file")
        min_changed_files=$(parse_min_changed_files "$config_file")
    fi

    # ---- 分离主动/被动文件 ----
    local -a active_files=()
    local -a passive_files_list=()

    while IFS= read -r line; do
        local file="${line:3}"
        # Handle rename: "old -> new"
        if [[ "$file" == *" -> "* ]]; then
            file="${file##* -> }"
        fi
        # Strip possible quotes
        file="${file#\"}" && file="${file%\"}"

        if [[ ${#passive_patterns[@]} -gt 0 ]] && is_passive_file "$file" "${passive_patterns[@]}"; then
            passive_files_list+=("$file")
        else
            active_files+=("$file")
        fi
    done <<< "$status_output"

    # ---- No active files → only passive changes, skip ----
    if [[ ${#active_files[@]} -eq 0 ]]; then
        output_allow "Skipped: only passive file changes (${#passive_files_list[@]} files). Patterns: ${passive_patterns[*]}"
    fi

    # ---- No threshold config → trigger on any active change (backward compat) ----
    if [[ -z "$min_changed_lines" ]] && [[ -z "$min_changed_files" ]]; then
        # Use original reminder logic
        build_and_output_reminder "$workspace" "$platform"
    fi

    # ---- Check trigger conditions (OR) ----
    local triggered=false
    local active_file_count=${#active_files[@]}
    local active_line_count=0

    # Check file count first (cheaper)
    if [[ -n "$min_changed_files" ]] && [[ $active_file_count -ge $min_changed_files ]]; then
        triggered=true
    fi

    # Then check line count (requires diff)
    if [[ "$triggered" != "true" ]] && [[ -n "$min_changed_lines" ]]; then
        active_line_count=$(count_changed_lines "$workspace" "${active_files[@]}")
        if [[ $active_line_count -ge $min_changed_lines ]]; then
            triggered=true
        fi
    fi

    if [[ "$triggered" != "true" ]]; then
        # Compute line count (if not yet, for output)
        if [[ $active_line_count -eq 0 ]] && [[ -n "$min_changed_lines" ]]; then
            : # Already computed
        elif [[ $active_line_count -eq 0 ]]; then
            active_line_count=$(count_changed_lines "$workspace" "${active_files[@]}")
        fi
        output_allow "Skipped: changes below threshold (${active_file_count} files, ${active_line_count} lines). Config: min_changed_files=${min_changed_files:-unset}, min_changed_lines=${min_changed_lines:-unset}"
    fi

    # ---- Threshold reached, trigger commit reminder ----
    build_and_output_reminder "$workspace" "$platform"
}

build_and_output_reminder() {
    local workspace="$1"
    local platform="$2"

    local changes
    changes=$(get_change_summary "$workspace")
    local changes_indented
    changes_indented=$(echo "$changes" | sed 's/^/  /')

    # Project-local script; fallback to global
    local checkpoint_cmd_sh checkpoint_cmd_ps1
    if [[ -f "${workspace}/.vibe-x/agent-better-checkpoint/checkpoint.sh" ]]; then
        checkpoint_cmd_sh=".vibe-x/agent-better-checkpoint/checkpoint.sh"
    else
        checkpoint_cmd_sh="~/.vibe-x/agent-better-checkpoint/scripts/checkpoint.sh"
    fi
    if [[ -f "${workspace}/.vibe-x/agent-better-checkpoint/checkpoint.ps1" ]]; then
        checkpoint_cmd_ps1='.\\.vibe-x\\agent-better-checkpoint\\checkpoint.ps1'
    else
        checkpoint_cmd_ps1='\$env:USERPROFILE/.vibe-x/agent-better-checkpoint/scripts/checkpoint.ps1'
    fi

    local reminder
    reminder="## ⚠️ Uncommitted Changes Detected

There are uncommitted changes in the workspace. Please create a checkpoint commit before ending the conversation.

**Changed files:**
\`\`\`
${changes_indented}
\`\`\`

**Action Required**: Run the checkpoint script to commit these changes:

**macOS/Linux:**
\`\`\`bash
${checkpoint_cmd_sh} \"checkpoint(<scope>): <description>\" \"<user-prompt>\" --type fallback
\`\`\`

**Windows (PowerShell):**
\`\`\`powershell
powershell -File \"${checkpoint_cmd_ps1}\" \"checkpoint(<scope>): <description>\" \"<user-prompt>\" -Type fallback
\`\`\`"

    output_block "$reminder" "$platform"
}

main
