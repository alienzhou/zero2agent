"""
Logging utilities for discuss-for-specs hooks.

All data is stored under ~/.vibe-x/discuss-for-specs/
- ~/.vibe-x/discuss-for-specs/hooks/  - Hook scripts
- ~/.vibe-x/discuss-for-specs/logs/   - Log files

Log Format Design (Concurrent-Safe):
- Each log line includes [HOOK_NAME] prefix for filtering in multi-process scenarios
- Short execution ID (exec_id) links related log entries from same execution
- Format: TIME | LEVEL | [hook:exec_id] message

Example log output:
  22:13:29 | INFO     | [check_precipitation:a3f2] START cwd=/path/to/project
  22:13:29 | INFO     | [check_precipitation:a3f2] platform=claude_code
  22:13:29 | INFO     | [check_precipitation:a3f2] >> Checking discussions for precipitation
  22:13:29 | INFO     | [check_precipitation:a3f2] >> Stale items: 1 found
  22:13:29 | INFO     | [check_precipitation:a3f2] END [OK]
"""

import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional


# Directory paths
def get_base_dir() -> Path:
    """Get base directory path for discuss-for-specs."""
    return Path.home() / ".vibe-x" / "discuss-for-specs"


def get_config_dir() -> Path:
    """Get configuration directory path (alias for get_base_dir)."""
    return get_base_dir()


def get_data_dir() -> Path:
    """Get data directory path (alias for get_base_dir)."""
    return get_base_dir()


def get_log_dir() -> Path:
    """Get log directory path."""
    return get_data_dir() / "logs"


def ensure_directories() -> None:
    """Ensure all required directories exist."""
    get_config_dir().mkdir(parents=True, exist_ok=True)
    get_log_dir().mkdir(parents=True, exist_ok=True)


# Logger configuration
_logger: Optional[logging.Logger] = None

# Current hook context (thread-local would be better, but hooks are single-threaded)
_current_hook_name: str = "unknown"
_current_exec_id: str = "0000"
_current_hook_actions: List[str] = []


def get_logger(name: str = "discuss-hooks") -> logging.Logger:
    """
    Get or create a logger instance.
    
    Args:
        name: Logger name (used as log file prefix)
        
    Returns:
        Configured logger instance
    """
    global _logger
    
    if _logger is not None:
        return _logger
    
    # Ensure directories exist
    ensure_directories()
    
    # Create logger
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    
    # Avoid adding handlers multiple times
    if logger.handlers:
        _logger = logger
        return logger
    
    # Create log file path with date
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = get_log_dir() / f"{name}-{today}.log"
    
    # File handler - detailed logging
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    # Format: full datetime for cross-day log analysis
    file_format = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    file_handler.setFormatter(file_format)
    logger.addHandler(file_handler)
    
    # Don't add stream handler - hooks should not output to stderr
    # as it may interfere with the hook protocol
    
    _logger = logger
    return logger


def _log(level: int, message: str) -> None:
    """
    Internal log function that adds hook context prefix.
    
    Args:
        level: Logging level (logging.INFO, logging.DEBUG, etc.)
        message: Log message
    """
    logger = get_logger()
    prefix = f"[{_current_hook_name}:{_current_exec_id}]"
    logger.log(level, f"{prefix} {message}")


def log_hook_start(hook_name: str, input_data: dict = None) -> None:
    """
    Log hook start with input data.
    
    Args:
        hook_name: Name of the hook (e.g., "check_precipitation")
        input_data: Input JSON data received from stdin
    """
    global _current_hook_name, _current_exec_id, _current_hook_actions
    
    # Set context for this hook execution
    _current_hook_name = hook_name
    _current_exec_id = uuid.uuid4().hex[:4]  # Short 4-char ID
    _current_hook_actions = []
    
    # Log start
    _log(logging.INFO, f"START cwd={os.getcwd()}")
    
    if input_data:
        # Extract key info from input
        platform = _detect_platform_from_input(input_data)
        session_id = input_data.get("session_id") or input_data.get("conversation_id") or "N/A"
        file_path = _extract_file_path(input_data)
        
        _log(logging.INFO, f"platform={platform} session={session_id}")
        if file_path:
            _log(logging.INFO, f"target={file_path}")
        
        # Log full input data at debug level
        import json
        input_str = json.dumps(input_data, ensure_ascii=False)
        if len(input_str) > 500:
            input_str = input_str[:500] + "...(truncated)"
        _log(logging.DEBUG, f"input={input_str}")


def log_hook_end(hook_name: str, output_data: dict = None, success: bool = True) -> None:
    """
    Log hook end with output data.
    
    Args:
        hook_name: Name of the hook
        output_data: Output JSON data to be written to stdout
        success: Whether the hook completed successfully
    """
    global _current_hook_actions
    
    # Log summary of actions
    if _current_hook_actions:
        summary = " | ".join(_current_hook_actions)
        _log(logging.INFO, f"summary: {summary}")
    
    # Log end status
    status = "[OK]" if success else "[FAIL]"
    _log(logging.INFO, f"END {status}")
    
    if output_data:
        import json
        output_str = json.dumps(output_data, ensure_ascii=False)
        if len(output_str) > 500:
            output_str = output_str[:500] + "...(truncated)"
        _log(logging.DEBUG, f"output={output_str}")
    
    # Reset actions
    _current_hook_actions = []


def log_action(action: str) -> None:
    """
    Log an action taken by the hook (will appear in summary).
    
    Args:
        action: Description of the action (e.g., "Round: 5 -> 6")
    """
    global _current_hook_actions
    _current_hook_actions.append(action)
    _log(logging.INFO, f">> {action}")


def log_skip(reason: str) -> None:
    """
    Log that the hook is skipping processing with a reason.
    
    Args:
        reason: Why the hook is skipping
    """
    global _current_hook_actions
    _current_hook_actions.append(f"SKIP: {reason}")
    _log(logging.INFO, f"-- SKIP: {reason}")


def log_file_operation(operation: str, file_path: str, details: str = None) -> None:
    """
    Log file operation.
    
    Args:
        operation: Type of operation (e.g., "READ", "WRITE", "DETECT")
        file_path: Path to the file
        details: Additional details
    """
    msg = f"[{operation}] {file_path}"
    if details:
        msg += f" - {details}"
    _log(logging.DEBUG, msg)


def log_discuss_detection(discuss_path: str, file_type: str = None) -> None:
    """
    Log discussion directory detection.
    
    Args:
        discuss_path: Path to the discussion directory
        file_type: Type of file detected (outline/decisions/notes)
    """
    global _current_hook_actions
    
    # Extract just the relative discuss path for readability
    discuss_short = _shorten_path(discuss_path)
    
    if file_type:
        action = f"Detected: {discuss_short} ({file_type})"
    else:
        action = f"Detected: {discuss_short}"
    
    _current_hook_actions.append(action)
    _log(logging.INFO, f">> {action}")


def log_meta_update(discuss_path: str, changes: dict) -> None:
    """
    Log meta.yaml update.
    
    Args:
        discuss_path: Path to the discussion directory
        changes: Dictionary of changes made
    """
    global _current_hook_actions
    
    # Build a concise change description
    change_parts = []
    for key, value in changes.items():
        change_parts.append(f"{key}={value}")
    
    action = f"Meta updated: {', '.join(change_parts)}"
    _current_hook_actions.append(action)
    _log(logging.INFO, f">> {action}")


def log_stale_detection(discuss_path: str, stale_items: list) -> None:
    """
    Log stale file detection.
    
    Args:
        discuss_path: Path to the discussion directory
        stale_items: List of stale items detected
    """
    global _current_hook_actions
    
    if stale_items:
        action = f"Stale items: {len(stale_items)} found"
        _current_hook_actions.append(action)
        _log(logging.WARNING, f"!! {action}")
        
        for item in stale_items:
            file_type, stale_runs, is_force = item
            level = "FORCE" if is_force else "SUGGEST"
            _log(logging.WARNING, f"   [{level}] {file_type}: {stale_runs} rounds stale")
    else:
        _log(logging.DEBUG, "-- No stale items")


def log_error(message: str, exc: Exception = None) -> None:
    """
    Log error message.
    
    Args:
        message: Error message
        exc: Exception object if available
    """
    global _current_hook_actions
    
    if exc:
        error_msg = f"ERROR: {message}: {type(exc).__name__}: {exc}"
    else:
        error_msg = f"ERROR: {message}"
    
    _current_hook_actions.append(error_msg)
    _log(logging.ERROR, f"!! {error_msg}")


def log_warning(message: str) -> None:
    """Log warning message."""
    _log(logging.WARNING, f"! {message}")


def log_info(message: str) -> None:
    """Log info message."""
    _log(logging.INFO, f"> {message}")


def log_debug(message: str) -> None:
    """Log debug message."""
    _log(logging.DEBUG, f". {message}")


# Helper functions
def _detect_platform_from_input(input_data: dict) -> str:
    """Detect platform from input data."""
    if not input_data:
        return "unknown"
    
    if "hook_event_name" in input_data or "tool_name" in input_data:
        return "claude_code"
    elif "cursor" in str(input_data).lower():
        return "cursor"
    else:
        return "cursor"  # Default


def _extract_file_path(input_data: dict) -> Optional[str]:
    """Extract file path from input data."""
    if not input_data:
        return None
    
    # Direct file_path
    if "file_path" in input_data:
        return _shorten_path(input_data["file_path"])
    
    # Claude Code format
    tool_input = input_data.get("tool_input", {})
    if isinstance(tool_input, dict) and "file_path" in tool_input:
        return _shorten_path(tool_input["file_path"])
    
    return None


def _shorten_path(path: str) -> str:
    """Shorten a path for display, keeping only .discuss and below."""
    if ".discuss" in path:
        idx = path.find(".discuss")
        return path[idx:]
    
    # Keep last 3 parts
    parts = Path(path).parts
    if len(parts) > 3:
        return str(Path(*parts[-3:]))
    return path
