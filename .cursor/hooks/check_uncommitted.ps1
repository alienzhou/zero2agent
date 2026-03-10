<#
.SYNOPSIS
    check_uncommitted.ps1 — Stop Hook: check for uncommitted changes (Windows PowerShell)

.DESCRIPTION
    Triggered at AI conversation end. Checks workspace for uncommitted changes.
    If found, outputs reminder for AI Agent to run fallback checkpoint commit.

    Supported platforms:
    - Cursor: stop hook (stdin JSON with workspace_roots)
    - Claude Code: Stop hook (stdin JSON with hook_event_name)

    Output protocol:
    - OK: {} (empty JSON)
    - Block (Cursor): {"followup_message": "..."}
    - Block (Claude Code): {"decision": "block", "reason": "..."}

    Config: .vibe-x/agent-better-checkpoint/config.yml (project-level, optional)
#>

$ErrorActionPreference = "Stop"

$CONFIG_FILE_NAME = ".vibe-x/agent-better-checkpoint/config.yml"

# ============================================================
# Helper functions
# ============================================================

function Output-Allow {
    param([string]$Info = "")
    if ($Info) {
        [Console]::Error.WriteLine("[checkpoint] $Info")
    }
    Write-Output '{}'
    exit 0
}

function Output-Block {
    param(
        [string]$Message,
        [string]$Platform
    )

    $Escaped = $Message -replace '\\', '\\\\' `
                        -replace '"', '\"' `
                        -replace "`r`n", '\n' `
                        -replace "`n", '\n' `
                        -replace "`r", '\r' `
                        -replace "`t", '\t'

    switch ($Platform) {
        "cursor" {
            Write-Output "{`"followup_message`":`"$Escaped`"}"
        }
        "claude_code" {
            Write-Output "{`"decision`":`"block`",`"reason`":`"$Escaped`"}"
        }
        default {
            Write-Output "{`"message`":`"$Escaped`"}"
        }
    }
    exit 0
}

# ============================================================
# Config parsing
# ============================================================

function Parse-CheckpointConfig {
    param([string]$ConfigPath)

    $config = @{
        MinChangedLines = $null
        MinChangedFiles = $null
        PassivePatterns = @()
    }

    if (-not (Test-Path $ConfigPath)) {
        return $config
    }

    $lines = Get-Content $ConfigPath -ErrorAction SilentlyContinue
    if (-not $lines) { return $config }

    $inPassiveSection = $false

    foreach ($line in $lines) {
        # Skip comments
        if ($line -match '^\s*#') { continue }
        if (-not $line.Trim()) { continue }

        # Thresholds under trigger_if_any
        if ($line -match '^\s+min_changed_lines:\s*(\d+)') {
            $config.MinChangedLines = [int]$Matches[1]
            continue
        }
        if ($line -match '^\s+min_changed_files:\s*(\d+)') {
            $config.MinChangedFiles = [int]$Matches[1]
            continue
        }

        # passive_patterns section
        if ($line -match '^passive_patterns:') {
            $inPassiveSection = $true
            continue
        }
        if ($inPassiveSection) {
            if ($line -match '^\s+-\s+(.+)') {
                $val = $Matches[1].Trim()
                $val = $val -replace '^["'']', '' -replace '["'']$', ''
                $val = $val -replace '\s*#.*$', ''
                if ($val) {
                    $config.PassivePatterns += $val
                }
            }
            elseif ($line -match '^\S') {
                $inPassiveSection = $false
            }
        }
    }

    return $config
}

# ============================================================
# Passive file matching
# ============================================================

function Test-PassiveFile {
    param(
        [string]$FilePath,
        [string[]]$Patterns
    )

    foreach ($pattern in $Patterns) {
        # dir/** → match all files under dir/
        if ($pattern -match '^(.+)/\*\*$') {
            $prefix = $Matches[1] + "/"
            if ($FilePath.StartsWith($prefix)) { return $true }
            continue
        }

        # *.ext → match suffix
        if ($pattern -match '^\*(\..+)$') {
            $suffix = $Matches[1]
            if ($FilePath.EndsWith($suffix)) { return $true }
            continue
        }

        # Exact match
        if ($FilePath -eq $pattern) { return $true }
    }

    return $false
}

# ============================================================
# Changed line count
# ============================================================

function Get-ChangedLineCount {
    param(
        [string]$Workspace,
        [string[]]$Files
    )

    if ($Files.Count -eq 0) { return 0 }
    $total = 0

    # Tracked files: staged + unstaged
    $diffArgs = @("-C", $Workspace, "diff", "--numstat", "--") + $Files
    $cachedArgs = @("-C", $Workspace, "diff", "--cached", "--numstat", "--") + $Files

    foreach ($args in @($diffArgs, $cachedArgs)) {
        $output = git @args 2>$null
        if ($output) {
            foreach ($line in ($output -split "`n")) {
                $parts = $line -split "`t"
                if ($parts.Count -ge 2) {
                    $adds = if ($parts[0] -ne "-") { [int]$parts[0] } else { 0 }
                    $dels = if ($parts[1] -ne "-") { [int]$parts[1] } else { 0 }
                    $total += $adds + $dels
                }
            }
        }
    }

    # Untracked files: total lines count as changes
    foreach ($file in $Files) {
        $untracked = git -C $Workspace ls-files --others --exclude-standard -- $file 2>$null
        if ($untracked) {
            $fullPath = Join-Path $Workspace $file
            if (Test-Path $fullPath -PathType Leaf) {
                $lineCount = (Get-Content $fullPath -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
                $total += $lineCount
            }
        }
    }

    return $total
}

# ============================================================
# Platform detection
# ============================================================

function Detect-Platform {
    param($InputData)

    if (-not $InputData) {
        return "unknown"
    }
    if ($InputData.PSObject.Properties["hook_event_name"] -or
        $InputData.PSObject.Properties["tool_name"]) {
        return "claude_code"
    }
    return "cursor"
}

# ============================================================
# Workspace root detection
# ============================================================

function Get-WorkspaceRoot {
    param($InputData)

    if ($InputData) {
        foreach ($field in @("workspace_roots", "workspaceRoots")) {
            $roots = $null
            try { $roots = $InputData.$field } catch {}
            if ($roots -and $roots.Count -gt 0) {
                return $roots[0]
            }
        }
    }

    foreach ($envVar in @("CURSOR_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "WORKSPACE_ROOT", "PROJECT_ROOT")) {
        $val = [Environment]::GetEnvironmentVariable($envVar)
        if ($val) { return $val }
    }

    return (Get-Location).Path
}

# ============================================================
# Git operations
# ============================================================

function Test-GitRepo {
    param([string]$Path)
    try {
        $null = git -C $Path rev-parse --is-inside-work-tree 2>$null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Get-ChangeSummary {
    param(
        [string]$Path,
        [int]$MaxLines = 20
    )

    $output = git -C $Path status --short 2>$null
    if (-not $output) { return "" }

    $lines = $output -split "`n"
    if ($lines.Count -gt $MaxLines) {
        $shown = $lines[0..($MaxLines - 1)]
        $shown += "  ... and $($lines.Count - $MaxLines) more files"
        return ($shown -join "`n")
    }
    return ($lines -join "`n")
}

# ============================================================
# Reminder message build
# ============================================================

function Build-Reminder {
    param([string]$Workspace)

    $Changes = Get-ChangeSummary -Path $Workspace
    $ChangesIndented = ($Changes -split "`n" | ForEach-Object { "  $_" }) -join "`n"

    # Project-local script; fallback to global
    $checkpointSh = "~/.vibe-x/agent-better-checkpoint/scripts/checkpoint.sh"
    $checkpointPs1 = "`$env:USERPROFILE/.vibe-x/agent-better-checkpoint/scripts/checkpoint.ps1"
    if (Test-Path (Join-Path $Workspace ".vibe-x/agent-better-checkpoint/checkpoint.sh")) {
        $checkpointSh = ".vibe-x/agent-better-checkpoint/checkpoint.sh"
    }
    if (Test-Path (Join-Path $Workspace ".vibe-x/agent-better-checkpoint/checkpoint.ps1")) {
        $checkpointPs1 = ".\.vibe-x\agent-better-checkpoint\checkpoint.ps1"
    }

    return @"
## ⚠️ Uncommitted Changes Detected

There are uncommitted changes in the workspace. Please create a checkpoint commit before ending the conversation.

**Changed files:**
``````
$ChangesIndented
``````

**Action Required**: Run the checkpoint script to commit these changes:

**macOS/Linux:**
``````bash
$checkpointSh "checkpoint(<scope>): <description>" "<user-prompt>" --type fallback
``````

**Windows (PowerShell):**
``````powershell
powershell -File "$checkpointPs1" "checkpoint(<scope>): <description>" "<user-prompt>" -Type fallback
``````
"@
}

# ============================================================
# Main logic
# ============================================================

$InputData = $null
$rawInput = ""
try {
    $rawInput = [Console]::In.ReadToEnd()
    if ($rawInput.Trim()) {
        $InputData = $rawInput | ConvertFrom-Json
    }
}
catch {}

if ($InputData -and $InputData.PSObject.Properties["stop_hook_active"]) {
    if ($InputData.stop_hook_active -eq $true) {
        Output-Allow
    }
}

$Platform = Detect-Platform -InputData $InputData
$Workspace = Get-WorkspaceRoot -InputData $InputData

# Delegate to project-local script when present (committed with project)
$ProjectScript = Join-Path $Workspace ".vibe-x/agent-better-checkpoint/check_uncommitted.ps1"
if (Test-Path $ProjectScript -PathType Leaf) {
    $rawInput | & $ProjectScript
    exit $LASTEXITCODE
}

if (-not (Test-GitRepo -Path $Workspace)) {
    Output-Allow
}

# Get all changes
$StatusOutput = git -C $Workspace status --porcelain 2>$null
if (-not $StatusOutput) {
    Output-Allow
}

# Load config
$ConfigFile = Join-Path $Workspace $CONFIG_FILE_NAME
$Config = Parse-CheckpointConfig -ConfigPath $ConfigFile

# ---- 分离主动/被动文件 ----
$ActiveFiles = @()
$PassiveFilesList = @()

foreach ($line in ($StatusOutput -split "`n")) {
    if ($line.Length -lt 4) { continue }
    $file = $line.Substring(3)
    # Handle rename
    if ($file -match ' -> (.+)$') {
        $file = $Matches[1]
    }
    $file = $file.Trim('"')

    if ($Config.PassivePatterns.Count -gt 0 -and (Test-PassiveFile -FilePath $file -Patterns $Config.PassivePatterns)) {
        $PassiveFilesList += $file
    }
    else {
        $ActiveFiles += $file
    }
}

# ---- 无主动文件 → 仅被动变更，跳过 ----
if ($ActiveFiles.Count -eq 0) {
    Output-Allow -Info "Skipped: only passive file changes ($($PassiveFilesList.Count) files). Patterns: $($Config.PassivePatterns -join ', ')"
}

# ---- 无阈值配置 → 有主动变更就触发 ----
if ($null -eq $Config.MinChangedLines -and $null -eq $Config.MinChangedFiles) {
    $Reminder = Build-Reminder -Workspace $Workspace
    Output-Block -Message $Reminder -Platform $Platform
}

# ---- 检查触发条件（OR 关系） ----
$Triggered = $false
$ActiveFileCount = $ActiveFiles.Count
$ActiveLineCount = 0

# Check file count first (cheaper)
if ($null -ne $Config.MinChangedFiles -and $ActiveFileCount -ge $Config.MinChangedFiles) {
    $Triggered = $true
}

# Then check line count
if (-not $Triggered -and $null -ne $Config.MinChangedLines) {
    $ActiveLineCount = Get-ChangedLineCount -Workspace $Workspace -Files $ActiveFiles
    if ($ActiveLineCount -ge $Config.MinChangedLines) {
        $Triggered = $true
    }
}

if (-not $Triggered) {
    if ($ActiveLineCount -eq 0 -and $null -ne $Config.MinChangedLines) {
        # Already computed
    }
    elseif ($ActiveLineCount -eq 0) {
        $ActiveLineCount = Get-ChangedLineCount -Workspace $Workspace -Files $ActiveFiles
    }
    $minFilesStr = if ($null -ne $Config.MinChangedFiles) { $Config.MinChangedFiles } else { "unset" }
    $minLinesStr = if ($null -ne $Config.MinChangedLines) { $Config.MinChangedLines } else { "unset" }
    Output-Allow -Info "Skipped: changes below threshold ($ActiveFileCount files, $ActiveLineCount lines). Config: min_changed_files=$minFilesStr, min_changed_lines=$minLinesStr"
}

# ---- 达到阈值，触发提交提醒 ----
$Reminder = Build-Reminder -Workspace $Workspace
Output-Block -Message $Reminder -Platform $Platform
