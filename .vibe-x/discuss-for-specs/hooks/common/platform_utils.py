"""
Platform-specific utilities for handling different AI platform inputs/outputs.

Supported platforms:
- Claude Code: PostToolUse hook with tool_input, Stop hook
- Cursor: afterFileEdit hook with file_path, stop hook
"""

import json
import sys
from enum import Enum
from typing import Any, Dict, Optional


class Platform(Enum):
    """Supported AI platforms."""
    CLAUDE_CODE = "claude_code"
    CURSOR = "cursor"
    UNKNOWN = "unknown"


def read_stdin_json() -> Optional[Dict[str, Any]]:
    """
    Read and parse JSON input from stdin.
    
    Returns:
        Parsed JSON dictionary, or None if input is empty or invalid
    """
    try:
        input_text = sys.stdin.read().strip()
        if not input_text:
            return None
        return json.loads(input_text)
    except json.JSONDecodeError:
        return None


def detect_platform(input_data: Dict[str, Any]) -> Platform:
    """
    Detect which platform the input is from based on input structure.
    
    Args:
        input_data: JSON input from stdin
        
    Returns:
        Detected platform enum
    """
    if input_data is None:
        return Platform.UNKNOWN
    
    # Cursor: has cursor_version field (most reliable indicator)
    if "cursor_version" in input_data:
        return Platform.CURSOR
    
    # Cursor: has file_path at top level for afterFileEdit (without tool_input)
    if "file_path" in input_data and "tool_input" not in input_data:
        return Platform.CURSOR
    
    # Cursor: stop hook has status field with "completed"
    if "status" in input_data and "completed" in str(input_data.get("status", "")):
        return Platform.CURSOR
    
    # Claude Code: has tool_name or hook_event_name (but not cursor_version)
    if "tool_name" in input_data or "hook_event_name" in input_data:
        return Platform.CLAUDE_CODE
    
    return Platform.UNKNOWN


def get_file_path_from_input(input_data: Dict[str, Any]) -> Optional[str]:
    """
    Extract file_path from different platform inputs.
    
    Args:
        input_data: JSON input from stdin
        
    Returns:
        Extracted file path, or None if not found
    """
    if input_data is None:
        return None
    
    # Cursor: directly has file_path
    if "file_path" in input_data:
        return input_data["file_path"]
    
    # Claude Code: in tool_input
    if "tool_input" in input_data:
        tool_input = input_data["tool_input"]
        if isinstance(tool_input, dict):
            return tool_input.get("file_path")
    
    return None


def is_stop_hook_active(input_data: Dict[str, Any]) -> bool:
    """
    Check if this is a continuation after stop hook already triggered.
    
    Claude Code uses stop_hook_active field to prevent infinite loops.
    
    Args:
        input_data: JSON input from stdin
        
    Returns:
        True if stop hook is already active (should allow passage)
    """
    if input_data is None:
        return False
    
    return input_data.get("stop_hook_active", False)


def format_output_allow() -> str:
    """
    Format output to allow the operation to continue.
    
    Returns:
        JSON string for allow/pass output
    """
    return json.dumps({})


def format_output_block(message: str, platform: Platform) -> str:
    """
    Format output to block/remind with a message.
    
    Args:
        message: Reminder message to display
        platform: Target platform
        
    Returns:
        JSON string for block output
    """
    if platform == Platform.CURSOR:
        # Cursor uses followup_message
        return json.dumps({"followup_message": message})
    elif platform == Platform.CLAUDE_CODE:
        # Claude Code uses decision: block with reason
        return json.dumps({
            "decision": "block",
            "reason": message
        })
    else:
        # Unknown platform, use generic format
        return json.dumps({"message": message})


def write_output(output: str) -> None:
    """
    Write output to stdout.
    
    Args:
        output: JSON string to output
    """
    print(output)


def allow_and_exit() -> None:
    """Convenience function to allow operation and exit."""
    write_output(format_output_allow())
    sys.exit(0)


def block_and_exit(message: str, platform: Platform) -> None:
    """Convenience function to block with message and exit."""
    write_output(format_output_block(message, platform))
    sys.exit(0)
