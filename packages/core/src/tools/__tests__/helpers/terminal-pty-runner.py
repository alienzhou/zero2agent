#!/usr/bin/env python3
"""在真实 PTY 中运行 terminal-pty-harness.mjs，并按计划注入按键。"""
from __future__ import annotations

import json
import os
import pty
import select
import sys
import time


def main() -> int:
    harness_path = sys.argv[1]
    config = json.loads(sys.argv[2])
    keys = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []

    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp("node", ["node", harness_path, json.dumps(config)])

    os.close(slave_fd)
    start = time.monotonic()
    sent = 0
    status = None

    while True:
        elapsed_ms = (time.monotonic() - start) * 1000
        while sent < len(keys) and keys[sent]["delayMs"] <= elapsed_ms:
            payload = bytes(keys[sent]["bytes"])
            os.write(master_fd, payload)
            sent += 1

        waited_pid, exit_status = os.waitpid(pid, os.WNOHANG)
        if waited_pid == pid:
            status = exit_status
            break

        r, _, _ = select.select([master_fd], [], [], 0.05)
        for _ in r:
            try:
                os.read(master_fd, 4096)
            except OSError:
                pass

    # drain remaining PTY output
    while True:
        r, _, _ = select.select([master_fd], [], [], 0.1)
        if not r:
            break
        try:
            chunk = os.read(master_fd, 4096)
            if not chunk:
                break
        except OSError:
            break

    os.close(master_fd)
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1


if __name__ == "__main__":
    raise SystemExit(main())
