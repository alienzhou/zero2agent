#!/usr/bin/env python3
"""
Hook: Precipitation Check (Snapshot-based)

This hook is triggered when AI conversation ends and checks if discussion
files need to be updated (precipitated) using snapshot comparison.

Behavior:
- Compares current file state with last saved snapshot
- Detects when outline changed but decisions/notes didn't update
- Triggers reminder when change_count >= threshold

Trigger:
- Claude Code: Stop hook
- Cursor: stop hook

Input (stdin JSON):
- Cursor: {"status": "completed", ...}
- Claude Code: {"hook_event_name": "Stop", "stop_hook_active": false, ...}

Output (stdout JSON):
- Allow: {}
- Block (Cursor): {"followup_message": "..."}
- Block (Claude Code): {"decision": "block", "reason": "..."}

Workflow:
1. Check if stop_hook_active is true (prevent infinite loop)
2. Load snapshot from .discuss/.snapshot.yaml
3. Find active discussions (modified within 24h)
4. Compare each discussion's state with snapshot
5. Update snapshot with new state
6. Emit reminder if change_count >= threshold
7. Save snapshot
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for common imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from common.logging_utils import (  # noqa: E402
    log_action,
    log_debug,
    log_error,
    log_hook_end,
    log_hook_start,
    log_info,
    log_skip,
    log_stale_detection,
)
from common.platform_utils import (  # noqa: E402
    Platform,
    allow_and_exit,
    block_and_exit,
    detect_platform,
    is_stop_hook_active,
    read_stdin_json,
)
from common.snapshot_manager import (  # noqa: E402
    cleanup_deleted_discussions,
    compare_and_update,
    find_active_discussions,
    get_discuss_key,
    load_snapshot,
    save_snapshot,
    scan_discussion,
)


HOOK_NAME = "check_precipitation"


from typing import Any, Optional


def get_workspace_root(input_data: Optional[dict[str, Any]] = None) -> Path:
    """
    Get the workspace root directory using priority-based detection.
    
    Priority order:
    1. stdin JSON data (workspace_roots / workspaceRoots)
    2. Platform-specific environment variables (CURSOR_PROJECT_DIR, CLAUDE_PROJECT_DIR)
    3. Generic environment variables (WORKSPACE_ROOT, PROJECT_ROOT)
    4. PWD environment variable
    5. Current working directory (fallback)
    
    Args:
        input_data: Optional stdin JSON data containing workspace information
    
    Returns:
        Path to workspace root
    """
    # Priority 1: stdin JSON data (most reliable for Cursor/Cline)
    if input_data:
        # Cursor format: workspace_roots
        if "workspace_roots" in input_data and input_data["workspace_roots"]:
            workspace = input_data["workspace_roots"]
            if isinstance(workspace, list) and len(workspace) > 0:
                return Path(workspace[0])
        # Cline format: workspaceRoots
        if "workspaceRoots" in input_data and input_data["workspaceRoots"]:
            workspace = input_data["workspaceRoots"]
            if isinstance(workspace, list) and len(workspace) > 0:
                return Path(workspace[0])
    
    # Priority 2: Platform-specific environment variables
    for env_var in ["CURSOR_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]:
        if env_var in os.environ and os.environ[env_var]:
            return Path(os.environ[env_var])
    
    # Priority 3: Generic environment variables
    for env_var in ["WORKSPACE_ROOT", "PROJECT_ROOT"]:
        if env_var in os.environ and os.environ[env_var]:
            return Path(os.environ[env_var])
    
    # Priority 4: PWD
    if "PWD" in os.environ and os.environ["PWD"]:
        return Path(os.environ["PWD"])
    
    # Priority 5: Fallback to current working directory
    return Path.cwd()


def format_stale_reminder(
    discuss_key: str,
    change_count: int,
    threshold: int,
    is_force: bool = False
) -> str:
    """
    Format a reminder message for stale discussion.
    
    Args:
        discuss_key: Discussion key (e.g., "2026-01-30/topic-name")
        change_count: Current change_count value
        threshold: Staleness threshold
        is_force: Whether this is a force update (exceeded force threshold)
        
    Returns:
        Formatted reminder message
    """
    if is_force:
        header = "## ⚠️ Precipitation Required\n\n"
        header += "The discussion outline has been updated multiple times, but decisions/notes haven't been updated:\n\n"
    else:
        header = "## 💡 Precipitation Suggestion\n\n"
        header += "The discussion outline has been updated, but decisions/notes may need updating:\n\n"
    
    items_text = f"- Discussion: `{discuss_key}`\n"
    items_text += f"- Outline changes without updates: {change_count} (threshold: {threshold})\n"
    
    footer = f"\n📁 Discussion: `.discuss/{discuss_key}`\n"
    
    if is_force:
        footer += "\n**Please update the discussion files before continuing.**\n"
        footer += "This ensures important decisions are properly documented.\n"
    else:
        footer += "\nWould you like me to help update the decisions/notes?\n"
        footer += "This helps maintain a complete record of our discussion.\n"
    
    return header + items_text + footer


def main():
    """Main entry point for the precipitation check hook."""
    input_data = None
    platform = Platform.UNKNOWN
    
    try:
        # Read input from stdin
        input_data = read_stdin_json()
        log_hook_start(HOOK_NAME, input_data)
        
        # Detect platform
        platform = detect_platform(input_data) if input_data else Platform.UNKNOWN
        log_info(f"Detected platform: {platform.value}")
        
        # Check if this is a continuation after stop hook already triggered
        if input_data and is_stop_hook_active(input_data):
            log_skip("stop_hook_active is True, bypassing check")
            log_hook_end(HOOK_NAME, {}, success=True)
            allow_and_exit()
        
        # Get workspace root (pass input_data for stdin-based detection)
        workspace_root = get_workspace_root(input_data)
        log_debug(f"Workspace root: {workspace_root}")
        
        # Get .discuss directory
        discuss_root = workspace_root / ".discuss"
        
        if not discuss_root.exists():
            log_skip("No .discuss directory found")
            log_hook_end(HOOK_NAME, {}, success=True)
            allow_and_exit()
        
        log_action("Checking discussions for precipitation")
        
        # Load snapshot
        snapshot = load_snapshot(discuss_root)
        threshold = snapshot.get("config", {}).get("stale_threshold", 3)
        force_threshold = threshold * 2  # Force at 2x the suggest threshold
        
        # Find active discussions (modified within 24h)
        active_discussions = find_active_discussions(discuss_root, hours=24)
        log_debug(f"Found {len(active_discussions)} active discussion(s)")
        
        if not active_discussions:
            log_skip("No active discussions found")
            log_hook_end(HOOK_NAME, {}, success=True)
            allow_and_exit()
        
        # Check each discussion for staleness
        stale_reminders = []
        
        for discuss_dir in active_discussions:
            discuss_key = get_discuss_key(discuss_dir, discuss_root)
            log_debug(f"Checking discussion: {discuss_key}")
            
            # Get old state from snapshot
            old_state = snapshot.get("discussions", {}).get(discuss_key, {})
            
            # Scan current state
            new_state = scan_discussion(discuss_dir)
            
            # Compare and update change_count
            change_count = compare_and_update(old_state, new_state)
            
            # Update snapshot with new state
            if "discussions" not in snapshot:
                snapshot["discussions"] = {}
            snapshot["discussions"][discuss_key] = new_state
            
            # Check if reminder is needed
            if change_count >= threshold:
                is_force = change_count >= force_threshold
                reminder = format_stale_reminder(discuss_key, change_count, threshold, is_force)
                stale_reminders.append((reminder, is_force))
                
                log_stale_detection(
                    str(discuss_dir),
                    [("outline", change_count, is_force)]
                )
        
        # Clean up deleted discussions
        cleanup_deleted_discussions(snapshot, discuss_root)
        
        # Save snapshot
        save_snapshot(discuss_root, snapshot)
        
        # Summary logging
        log_info(f"Stale reminders: {len(stale_reminders)}")
        
        # If there are stale reminders, check if any require forcing
        if stale_reminders:
            # Check if any reminder is force-level
            has_force = any(is_force for _, is_force in stale_reminders)
            
            combined_reminder = "\n\n---\n\n".join(reminder for reminder, _ in stale_reminders)
            
            if has_force:
                log_action(f"Blocking: {len(stale_reminders)} stale reminder(s) [FORCE]")
                log_hook_end(HOOK_NAME, {"action": "block", "force": True}, success=True)
                block_and_exit(combined_reminder, platform)
            else:
                # Suggest but don't block for non-force reminders
                log_action(f"Suggesting update: {len(stale_reminders)} stale item(s)")
                log_hook_end(HOOK_NAME, {"action": "suggest"}, success=True)
                block_and_exit(combined_reminder, platform)
        
        # No issues, allow and exit
        log_hook_end(HOOK_NAME, {}, success=True)
        allow_and_exit()
        
    except Exception as e:
        log_error(f"Unexpected error in {HOOK_NAME}", e)
        log_hook_end(HOOK_NAME, {}, success=False)
        # Still allow operation to continue even on error
        allow_and_exit()


if __name__ == "__main__":
    main()
