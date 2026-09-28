#!/usr/bin/env python3
"""Exercise real Python/Node REPLs over pipes, without product or model calls."""

import json
import re
import subprocess
import sys
from datetime import datetime

from probe import Child


def launch_source(program, flags):
    # exec preserves the isolated process group owned by Child.
    if program == "python":
        return "import os,sys; os.execv(sys.executable," + repr([sys.executable] + flags) + ")"
    return "import os; os.execvp('node'," + repr(["node"] + flags) + ")"


def run():
    records = []
    for program in ("python", "node"):
        expression = b"print('VALUE='+str(6*7))\n" if program == "python" else b"console.log('VALUE='+(6*7));\n"
        with Child(launch_source(program, [])) as child:
            child.write(expression)
            before = child.read(0.2)
            assert b"VALUE=42" not in before, before
            child.close_input()
            after = child.expect(b"VALUE=42")
            records.append({"program": program, "mode": "default-pipe", "before_eof": before.decode(), "after_eof": after.decode()})

        flags = ["-i", "-q"] if program == "python" else ["--interactive"]
        prompt = b">>> " if program == "python" else b"> "
        with Child(launch_source(program, flags)) as child:
            banner = child.expect(prompt)
            child.write(expression)
            first = child.expect(prompt)
            number = int(re.search(rb"VALUE=(\d+)", first).group(1))
            next_expression = ("print('NEXT='+str(" + str(number) + "+1))\n") if program == "python" else ("console.log('NEXT='+(" + str(number) + "+1));\n")
            child.write(next_expression.encode())
            second = child.expect(prompt)
            assert b"NEXT=43" in second, second
            child.close_input()
            tail = child.read(0.2)
            records.append({"program": program, "mode": "forced-interactive-pipe", "flags": flags, "banner": banner.decode(), "round1": first.decode(), "round2": second.decode(), "tail": tail.decode()})
    return {
        "observed_at": datetime.now().astimezone().isoformat(),
        "python": sys.version.split()[0],
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "scope": "real language executables over pipes; deterministic controller, not product E2E",
        "passed": len(records),
        "total": 4,
        "results": records,
    }


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
