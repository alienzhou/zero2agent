"""
Snapshot Manager for Hook scripts.

Manages snapshot.yaml file to track discussion state changes.
Snapshot file is stored at: .discuss/.snapshot.yaml

Snapshot File Structure:
{
    "version": 1,
    "config": {
        "stale_threshold": 3
    },
    "discussions": {
        "2026-01-30/multi-agent-platform-support": {
            "outline": {
                "mtime": 1706621400.0,
                "change_count": 2
            },
            "decisions": [
                {"name": "D01-xxx.md", "mtime": 1706620000.0}
            ],
            "notes": [
                {"name": "analysis.md", "mtime": 1706619000.0}
            ]
        }
    }
}

Core Logic:
- outline mtime changed → change_count++
- decisions/notes changed → change_count = 0 (reset)
- Trigger reminder when change_count >= threshold
"""

import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from .logging_utils import log_debug, log_error, log_info, log_warning


# Default staleness threshold
DEFAULT_STALE_THRESHOLD = 3

# Snapshot file name
SNAPSHOT_FILE_NAME = ".snapshot.yaml"

# Detection window (hours)
DETECTION_WINDOW_HOURS = 24


def get_snapshot_path(discuss_root: Path) -> Path:
    """
    Get the path to snapshot.yaml file.
    
    Args:
        discuss_root: Path to .discuss directory
        
    Returns:
        Path to snapshot.yaml
    """
    return discuss_root / SNAPSHOT_FILE_NAME


def load_snapshot(discuss_root: Path) -> Dict[str, Any]:
    """
    Load snapshot.yaml from .discuss directory.
    
    Args:
        discuss_root: Path to .discuss directory
        
    Returns:
        Snapshot dictionary with default structure if file doesn't exist
    """
    snapshot_path = get_snapshot_path(discuss_root)
    
    if not snapshot_path.exists():
        log_debug(f"Snapshot file not found, creating default: {snapshot_path}")
        return create_default_snapshot()
    
    try:
        with open(snapshot_path, encoding="utf-8") as f:
            snapshot = yaml.safe_load(f) or {}
        
        # Ensure structure
        if "version" not in snapshot:
            snapshot["version"] = 1
        if "config" not in snapshot:
            snapshot["config"] = {}
        if "discussions" not in snapshot:
            snapshot["discussions"] = {}
        
        # Ensure config has stale_threshold
        if "stale_threshold" not in snapshot["config"]:
            snapshot["config"]["stale_threshold"] = DEFAULT_STALE_THRESHOLD
        
        log_debug(f"Loaded snapshot with {len(snapshot.get('discussions', {}))} discussions")
        return snapshot
        
    except Exception as e:
        log_error(f"Failed to load snapshot: {snapshot_path}", e)
        return create_default_snapshot()


def save_snapshot(discuss_root: Path, snapshot: Dict[str, Any]) -> bool:
    """
    Save snapshot.yaml to .discuss directory.
    
    Args:
        discuss_root: Path to .discuss directory
        snapshot: Snapshot dictionary
        
    Returns:
        True if successful, False otherwise
    """
    snapshot_path = get_snapshot_path(discuss_root)
    
    try:
        # Ensure .discuss directory exists
        discuss_root.mkdir(parents=True, exist_ok=True)
        
        with open(snapshot_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(snapshot, f, sort_keys=False, allow_unicode=True, default_flow_style=False)
        
        log_debug(f"Saved snapshot: {snapshot_path}")
        return True
        
    except Exception as e:
        log_error(f"Failed to save snapshot: {snapshot_path}", e)
        return False


def create_default_snapshot() -> Dict[str, Any]:
    """
    Create default snapshot structure.
    
    Returns:
        Default snapshot dictionary
    """
    return {
        "version": 1,
        "config": {
            "stale_threshold": DEFAULT_STALE_THRESHOLD,
        },
        "discussions": {},
    }


def get_discuss_key(discuss_dir: Path, discuss_root: Path) -> str:
    """
    Get discussion key from directory path.
    
    Key format: "YYYY-MM-DD/topic-slug"
    
    Args:
        discuss_dir: Path to discussion directory
        discuss_root: Path to .discuss root directory
        
    Returns:
        Discussion key string
    """
    try:
        relative_path = discuss_dir.relative_to(discuss_root)
        return str(relative_path).replace("\\", "/")  # Normalize path separators
    except ValueError:
        # Fallback: use directory name
        return discuss_dir.name


def find_active_discussions(discuss_root: Path, hours: int = DETECTION_WINDOW_HOURS) -> List[Path]:
    """
    Find discussion directories modified within the specified time window.
    
    Args:
        discuss_root: Path to .discuss directory
        hours: Time window in hours (default: 24)
        
    Returns:
        List of discussion directory paths
    """
    if not discuss_root.exists():
        return []
    
    active_discussions = []
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=hours)
    
    # Scan .discuss directory for date directories (YYYY-MM-DD)
    for date_dir in discuss_root.iterdir():
        if not date_dir.is_dir():
            continue
        
        # Check if directory name matches date pattern
        if not re.match(r"\d{4}-\d{2}-\d{2}$", date_dir.name):
            continue
        
        # Scan topic directories within date directory
        for topic_dir in date_dir.iterdir():
            if not topic_dir.is_dir():
                continue
            
            # Check if any file in the discussion directory was modified recently
            if is_recently_modified(topic_dir, cutoff_time):
                active_discussions.append(topic_dir)
                log_debug(f"Found active discussion: {get_discuss_key(topic_dir, discuss_root)}")
    
    return active_discussions


def is_recently_modified(directory: Path, cutoff_time: datetime) -> bool:
    """
    Check if directory or any file within it was modified after cutoff_time.
    
    Args:
        directory: Directory to check
        cutoff_time: Cutoff time
        
    Returns:
        True if recently modified
    """
    # Check directory itself
    try:
        dir_mtime = datetime.fromtimestamp(directory.stat().st_mtime, tz=timezone.utc)
        if dir_mtime > cutoff_time:
            return True
    except (OSError, ValueError):
        pass
    
    # Check files recursively (limit depth to avoid performance issues)
    try:
        for item in directory.rglob("*"):
            if item.is_file():
                try:
                    file_mtime = datetime.fromtimestamp(item.stat().st_mtime, tz=timezone.utc)
                    if file_mtime > cutoff_time:
                        return True
                except (OSError, ValueError):
                    continue
    except (OSError, ValueError):
        pass
    
    return False


def scan_discussion(discuss_dir: Path) -> Dict[str, Any]:
    """
    Scan discussion directory and return current state.
    
    Args:
        discuss_dir: Path to discussion directory
        
    Returns:
        State dictionary with outline, decisions, and notes
    """
    state = {
        "outline": {"mtime": 0.0, "change_count": 0},
        "decisions": [],
        "notes": [],
    }
    
    # Scan outline.md
    outline_path = discuss_dir / "outline.md"
    if outline_path.exists():
        try:
            state["outline"]["mtime"] = outline_path.stat().st_mtime
        except OSError:
            pass
    
    # Scan decisions directory
    decisions_dir = discuss_dir / "decisions"
    if decisions_dir.exists() and decisions_dir.is_dir():
        for decision_file in decisions_dir.glob("*.md"):
            try:
                state["decisions"].append({
                    "name": decision_file.name,
                    "mtime": decision_file.stat().st_mtime,
                })
            except OSError:
                continue
    
    # Scan notes directory
    notes_dir = discuss_dir / "notes"
    if notes_dir.exists() and notes_dir.is_dir():
        for note_file in notes_dir.glob("*.md"):
            try:
                state["notes"].append({
                    "name": note_file.name,
                    "mtime": note_file.stat().st_mtime,
                })
            except OSError:
                continue
    
    return state


def compare_and_update(old_state: Dict[str, Any], new_state: Dict[str, Any]) -> int:
    """
    Compare old and new state, update change_count logic.
    
    Logic:
    - If outline mtime increased → change_count++
    - If decisions/notes changed (added/modified/deleted) → change_count = 0 (reset)
    - If outline mtime decreased → don't increase (conservative handling)
    
    Args:
        old_state: Previous state from snapshot
        new_state: Current state from scan
        
    Returns:
        Updated change_count
    """
    # Get old change_count (default 0 for new discussions)
    old_change_count = old_state.get("outline", {}).get("change_count", 0)
    old_outline_mtime = old_state.get("outline", {}).get("mtime", 0.0)
    new_outline_mtime = new_state.get("outline", {}).get("mtime", 0.0)
    
    # Check if decisions/notes changed
    old_decisions = _normalize_file_list(old_state.get("decisions", []))
    new_decisions = _normalize_file_list(new_state.get("decisions", []))
    old_notes = _normalize_file_list(old_state.get("notes", []))
    new_notes = _normalize_file_list(new_state.get("notes", []))
    
    decisions_changed = old_decisions != new_decisions
    notes_changed = old_notes != new_notes
    
    # If decisions or notes changed, reset change_count
    if decisions_changed or notes_changed:
        log_debug(f"Decisions/notes changed, resetting change_count to 0")
        new_state["outline"]["change_count"] = 0
        return 0
    
    # Check outline mtime change
    if new_outline_mtime > old_outline_mtime:
        # Outline was modified, increment change_count
        new_change_count = old_change_count + 1
        log_debug(f"Outline modified, change_count: {old_change_count} -> {new_change_count}")
        new_state["outline"]["change_count"] = new_change_count
        return new_change_count
    elif new_outline_mtime < old_outline_mtime:
        # Outline mtime decreased (file discarded?), conservative handling
        log_debug(f"Outline mtime decreased, keeping change_count: {old_change_count}")
        new_state["outline"]["change_count"] = old_change_count
        return old_change_count
    else:
        # No change
        new_state["outline"]["change_count"] = old_change_count
        return old_change_count


def _normalize_file_list(file_list: List[Dict[str, Any]]) -> List[Tuple[str, float]]:
    """
    Normalize file list for comparison.
    
    Args:
        file_list: List of file dictionaries
        
    Returns:
        List of (name, mtime) tuples
    """
    result = []
    for item in file_list:
        name = item.get("name", "")
        mtime = item.get("mtime", 0.0)
        result.append((name, mtime))
    return sorted(result)


def cleanup_deleted_discussions(snapshot: Dict[str, Any], discuss_root: Path) -> int:
    """
    Remove entries for discussions that no longer exist.
    
    Args:
        snapshot: Snapshot dictionary
        discuss_root: Path to .discuss directory
        
    Returns:
        Number of discussions cleaned up
    """
    discussions = snapshot.get("discussions", {})
    cleaned = 0
    
    for key in list(discussions.keys()):
        # Reconstruct path from key
        try:
            discuss_path = discuss_root / key
            if not discuss_path.exists() or not discuss_path.is_dir():
                del discussions[key]
                cleaned += 1
                log_debug(f"Removed deleted discussion from snapshot: {key}")
        except (ValueError, OSError) as e:
            # Invalid key or path error, remove it
            del discussions[key]
            cleaned += 1
            log_warning(f"Removed invalid discussion key from snapshot: {key} ({e})")
    
    if cleaned > 0:
        log_info(f"Cleaned up {cleaned} deleted discussion(s) from snapshot")
    
    return cleaned
