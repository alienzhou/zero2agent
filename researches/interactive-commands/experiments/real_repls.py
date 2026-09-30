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
        expression = b"value=6*7; print('VALUE='+str(value))\n" if program == "python" else b"var value=6*7; console.log('VALUE='+value);\n"
        with Child(launch_source(program, [])) as child:
            child.write(expression)
            # No output in this window alone cannot distinguish EOF wait from startup/buffering.
            before = child.read(0.2)
            assert b"VALUE=42" not in before, before
            child.close_input()
            after = child.expect(b"VALUE=42")
            exit_code = child.wait()
            assert exit_code == 0
            records.append({"program": program, "mode": "default-pipe", "pre_eof_observation_seconds": 0.2,
                            "before_eof": before.decode(), "after_eof": after.decode(), "exit_code": exit_code})

        flags = ["-i", "-q"] if program == "python" else ["--interactive"]
        prompt = b">>> " if program == "python" else b"> "
        with Child(launch_source(program, flags)) as child:
            banner = child.expect(prompt)
            child.write(expression)
            first = child.expect(prompt)
            number = int(re.search(rb"VALUE=(\d+)", first).group(1))
            # Use the parsed output AND the interpreter's prior variable: a new REPL would fail.
            next_expression = ("value += " + str(number) + "; print('NEXT='+str(value))\n") if program == "python" else ("value += " + str(number) + "; console.log('NEXT='+value);\n")
            child.write(next_expression.encode())
            second = child.expect(prompt)
            assert b"NEXT=84" in second, second
            child.close_input()
            # Tail capture is not exit proof; wait below separately checks direct-child exit.
            tail = child.read(0.2)
            exit_code = child.wait()
            assert exit_code == 0
            records.append({"program": program, "mode": "forced-interactive-pipe", "flags": flags,
                            "banner": banner.decode(), "round1": first.decode(), "round2": second.decode(),
                            "tail": tail.decode(), "interpreter_state_preserved": True, "exit_code": exit_code})
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
