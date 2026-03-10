"""
File system utilities for Hook scripts.
"""

import re
from pathlib import Path
from typing import Optional


# Pattern to match discussion directory: .discuss/YYYY-MM-DD/[topic-slug]
# This regex matches paths ending with .discuss/date/topic structure
DISCUSS_DIR_PATTERN = re.compile(r"\.discuss[/\\]\d{4}-\d{2}-\d{2}[/\\][^/\\]+$")


def ensure_directory(path: str) -> Path:
    """
    Ensure directory exists, create if necessary.
    
    Args:
        path: Directory path
        
    Returns:
        Path object
    """
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def find_discuss_root(current_path: str) -> Optional[Path]:
    """
    Find discussion root directory.
    
    Recognition rules (checks in order, returns on first match):
    1. Contains outline.md (primary indicator)
    2. Path matches .discuss/YYYY-MM-DD/[topic]/ pattern (structural match)
    3. Contains meta.yaml (backward compatibility with old discussions)
    
    Note: meta.yaml is no longer used in new discussions (see D02 decision),
    but we still check for it to support old discussion directories.
    
    Args:
        current_path: Starting path to search from
        
    Returns:
        Path to discussion root, or None if not found
    """
    p = Path(current_path).resolve()
    
    # Search upward through parent directories
    for parent in [p] + list(p.parents):
        # Rule 1: Has outline.md (primary indicator)
        if (parent / "outline.md").exists():
            return parent
        
        # Rule 2: Path matches .discuss/YYYY-MM-DD/topic pattern
        # This handles the case where outline.md is being created
        path_str = str(parent)
        if DISCUSS_DIR_PATTERN.search(path_str):
            return parent
        
        # Rule 3: Has meta.yaml (backward compatibility)
        if (parent / "meta.yaml").exists():
            return parent
    
    return None


def get_decision_path(discuss_root: Path, decision_id: str, title: str) -> Path:
    """
    Generate path for a decision document.
    
    Args:
        discuss_root: Discussion root directory
        decision_id: Decision ID (e.g., "D1")
        title: Decision title
        
    Returns:
        Path for the decision document
    """
    # Extract number from ID (D1 -> 01)
    num = decision_id[1:].zfill(2)
    
    # Slugify title
    slug = title.lower().replace(' ', '-')
    
    filename = f"{num}-{slug}.md"
    return discuss_root / "decisions" / filename
