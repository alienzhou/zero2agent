<#
.SYNOPSIS
    checkpoint.ps1 — Create semantic Git checkpoint commits (Windows PowerShell)

.DESCRIPTION
    AI provides descriptive content (subject + body). This script:
    1. Truncates user-prompt (≤60 chars, head+tail)
    2. Appends metadata via git interpret-trailers
    3. Runs git add -A && git commit

.PARAMETER Message
    Full commit message (subject + blank line + body). Required.

.PARAMETER UserPrompt
    The user's original prompt/request. Optional.

.PARAMETER Type
    Checkpoint type: "auto" (default) or "fallback".

.EXAMPLE
    .\checkpoint.ps1 "checkpoint(auth): add JWT refresh" "implement token refresh"
#>

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message,

    [Parameter(Position = 1)]
    [string]$UserPrompt = "",

    [string]$Type = "auto"
)

$ErrorActionPreference = "Stop"

# ============================================================
# Platform detection
# ============================================================

function Detect-Platform {
    # 优先检测运行时环境变量（谁在调用），而非安装态（Get-Command）
    if ($env:CURSOR_AGENT -or $env:CURSOR_TRACE_ID -or $env:CURSOR_VERSION) {
        return "cursor"
    }
    if ($env:CLAUDE_CODE) {
        return "claude-code"
    }
    return "unknown"
}

$AgentPlatform = Detect-Platform

# ============================================================
# User-Prompt truncation (≤60 chars, head+tail + ellipsis)
# ============================================================

function Truncate-Prompt {
    param([string]$Prompt)

    $MaxLen = 60
    if ($Prompt.Length -le $MaxLen) {
        return $Prompt
    }

    $HeadLen = [math]::Floor(($MaxLen - 3) / 2)
    $TailLen = $MaxLen - 3 - $HeadLen
    $Head = $Prompt.Substring(0, $HeadLen)
    $Tail = $Prompt.Substring($Prompt.Length - $TailLen, $TailLen)
    return "${Head}...${Tail}"
}

$TruncatedPrompt = ""
if ($UserPrompt) {
    $TruncatedPrompt = Truncate-Prompt -Prompt $UserPrompt
}

# ============================================================
# Check for changes
# ============================================================

function Test-HasChanges {
    # Staged changes
    $diffCached = git diff --cached --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { return $true }

    # Unstaged changes
    $diffWorking = git diff --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { return $true }

    # Untracked files
    $untracked = git ls-files --others --exclude-standard 2>$null
    if ($untracked) { return $true }

    return $false
}

if (-not (Test-HasChanges)) {
    Write-Host "No changes to commit."
    exit 0
}

# ============================================================
# git add -A
# ============================================================

git add -A

# ============================================================
# Build trailers and commit
# ============================================================

$TrailerArgs = @(
    "--trailer", "Agent: $AgentPlatform",
    "--trailer", "Checkpoint-Type: $Type"
)

if ($TruncatedPrompt) {
    $TrailerArgs += @("--trailer", "User-Prompt: $TruncatedPrompt")
}

# Pipe message → git interpret-trailers → git commit
$Message | git interpret-trailers @TrailerArgs | git commit -F -

Write-Host "Checkpoint committed successfully."
