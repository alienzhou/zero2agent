#!/usr/bin/env python3
"""
Installation script for discuss hooks.

This script detects the current platform (Claude Code or Cursor) and
configures the appropriate hooks for precipitation tracking and reminder.

Usage:
    python install.py [--platform claude|cursor] [--uninstall]
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Optional


# Hook script paths (relative to this install.py)
HOOKS_DIR = Path(__file__).parent
CHECK_PRECIPITATION = HOOKS_DIR / "stop" / "check_precipitation.py"


def get_home_dir() -> Path:
    """Get user home directory."""
    return Path.home()


def detect_platform() -> Optional[str]:
    """
    Auto-detect which AI platform is installed.
    
    Returns:
        "claude" or "cursor" if detected, None otherwise
    """
    home = get_home_dir()
    
    # Check for Claude Code
    if (home / ".claude").exists():
        return "claude"
    
    # Check for Cursor
    if (home / ".cursor").exists():
        return "cursor"
    
    return None


def get_claude_settings_path() -> Path:
    """Get Claude Code settings.json path."""
    return get_home_dir() / ".claude" / "settings.json"


def get_cursor_hooks_path() -> Path:
    """Get Cursor hooks.json path."""
    return get_home_dir() / ".cursor" / "hooks.json"


def get_hooks_install_dir(platform: str) -> Path:
    """Get the directory to install hooks scripts."""
    home = get_home_dir()
    if platform == "claude":
        return home / ".claude" / "hooks" / "discuss"
    else:
        return home / ".cursor" / "hooks" / "discuss"


def copy_hooks_to_install_dir(platform: str) -> Path:
    """
    Copy hook scripts to the platform's hooks directory.
    
    Returns:
        Path to the installed hooks directory
    """
    install_dir = get_hooks_install_dir(platform)
    
    # Create directories
    install_dir.mkdir(parents=True, exist_ok=True)
    (install_dir / "common").mkdir(exist_ok=True)
    (install_dir / "stop").mkdir(exist_ok=True)
    
    # Copy common modules
    for file in (HOOKS_DIR / "common").glob("*.py"):
        shutil.copy(file, install_dir / "common" / file.name)
    
    # Copy hook scripts
    shutil.copy(CHECK_PRECIPITATION, install_dir / "stop" / "check_precipitation.py")
    
    # Make scripts executable
    (install_dir / "stop" / "check_precipitation.py").chmod(0o755)
    
    return install_dir


def install_claude_hooks() -> None:
    """Install hooks for Claude Code."""
    settings_path = get_claude_settings_path()
    
    # Copy hooks to install directory
    install_dir = copy_hooks_to_install_dir("claude")
    
    check_precip_cmd = f"python3 {install_dir}/stop/check_precipitation.py"
    
    # Load existing settings or create new
    if settings_path.exists():
        with open(settings_path, encoding="utf-8") as f:
            settings = json.load(f)
    else:
        settings = {}
    
    # Ensure hooks section exists
    if "hooks" not in settings:
        settings["hooks"] = {}
    
    hooks = settings["hooks"]
    
    # Add Stop hook for precipitation check
    if "Stop" not in hooks:
        hooks["Stop"] = []
    
    stop_hook_exists = any(
        "discuss" in str(h.get("hooks", [{}])[0].get("command", ""))
        for h in hooks["Stop"]
        if isinstance(h, dict)
    )
    
    if not stop_hook_exists:
        hooks["Stop"].append({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": check_precip_cmd
            }]
        })
    
    # Save settings
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    
    print(f"✓ Claude Code hooks installed")
    print(f"  - Settings: {settings_path}")
    print(f"  - Hooks: {install_dir}")


def install_cursor_hooks() -> None:
    """Install hooks for Cursor."""
    hooks_path = get_cursor_hooks_path()
    
    # Copy hooks to install directory
    install_dir = copy_hooks_to_install_dir("cursor")
    
    check_precip_cmd = f"python3 {install_dir}/stop/check_precipitation.py"
    
    # Load existing hooks or create new
    if hooks_path.exists():
        with open(hooks_path, encoding="utf-8") as f:
            config = json.load(f)
    else:
        config = {"version": 1, "hooks": {}}
    
    hooks = config.setdefault("hooks", {})
    
    # Add stop hook
    if "stop" not in hooks:
        hooks["stop"] = []
    
    stop_hook_exists = any(
        "discuss" in h.get("command", "")
        for h in hooks["stop"]
        if isinstance(h, dict)
    )
    
    if not stop_hook_exists:
        hooks["stop"].append({
            "command": check_precip_cmd
        })
    
    # Save hooks config
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    with open(hooks_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    
    print(f"✓ Cursor hooks installed")
    print(f"  - Config: {hooks_path}")
    print(f"  - Hooks: {install_dir}")


def uninstall_claude_hooks() -> None:
    """Remove hooks for Claude Code."""
    settings_path = get_claude_settings_path()
    install_dir = get_hooks_install_dir("claude")
    
    # Remove hooks from settings
    if settings_path.exists():
        with open(settings_path, encoding="utf-8") as f:
            settings = json.load(f)
        
        hooks = settings.get("hooks", {})
        
        # Remove Stop hooks containing "discuss"
        if "Stop" in hooks:
            hooks["Stop"] = [
                h for h in hooks["Stop"]
                if "discuss" not in str(h.get("hooks", [{}])[0].get("command", ""))
            ]
        
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
    
    # Remove installed hooks directory
    if install_dir.exists():
        shutil.rmtree(install_dir)
    
    print("✓ Claude Code hooks uninstalled")


def uninstall_cursor_hooks() -> None:
    """Remove hooks for Cursor."""
    hooks_path = get_cursor_hooks_path()
    install_dir = get_hooks_install_dir("cursor")
    
    # Remove hooks from config
    if hooks_path.exists():
        with open(hooks_path, encoding="utf-8") as f:
            config = json.load(f)
        
        hooks = config.get("hooks", {})
        
        # Remove stop hooks containing "discuss"
        if "stop" in hooks:
            hooks["stop"] = [
                h for h in hooks["stop"]
                if "discuss" not in h.get("command", "")
            ]
        
        with open(hooks_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    
    # Remove installed hooks directory
    if install_dir.exists():
        shutil.rmtree(install_dir)
    
    print("✓ Cursor hooks uninstalled")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Install discuss hooks")
    parser.add_argument(
        "--platform",
        choices=["claude", "cursor"],
        help="Target platform (auto-detected if not specified)"
    )
    parser.add_argument(
        "--uninstall",
        action="store_true",
        help="Uninstall hooks instead of installing"
    )
    
    args = parser.parse_args()
    
    # Detect platform if not specified
    platform = args.platform or detect_platform()
    
    if platform is None:
        print("Error: Could not detect platform. Please specify --platform claude or --platform cursor")
        sys.exit(1)
    
    # Install or uninstall
    if args.uninstall:
        if platform == "claude":
            uninstall_claude_hooks()
        else:
            uninstall_cursor_hooks()
    else:
        if platform == "claude":
            install_claude_hooks()
        else:
            install_cursor_hooks()


if __name__ == "__main__":
    main()
