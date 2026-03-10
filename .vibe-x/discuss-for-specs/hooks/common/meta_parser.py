"""
Common utilities for meta.yaml parsing (backward compatibility only).

NOTE: meta.yaml is deprecated (see D02 decision). New discussions use
snapshot.yaml instead. These functions are kept only for backward compatibility
with old discussion directories that may still have meta.yaml files.

For new code, use snapshot_manager.py instead.
"""

from pathlib import Path
from typing import Any, Dict, Optional

import yaml


def load_meta(discuss_path: str) -> Optional[Dict[str, Any]]:
    """
    Load meta.yaml from discussion directory (backward compatibility only).
    
    Args:
        discuss_path: Path to discussion directory
        
    Returns:
        Dictionary containing meta data, or None if file doesn't exist
    """
    meta_path = Path(discuss_path) / "meta.yaml"
    
    if not meta_path.exists():
        return None
    
    try:
        with open(meta_path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception:
        return None
