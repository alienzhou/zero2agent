"""Close the actual outer PTY after approval and observe host termination."""
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], '--terminal', 'bash ./disconnect.sh'])

data = b''
approved = False
closed = False
status = None
diagnostic = ''
deadline = time.monotonic() + 10
try:
    while time.monotonic() < deadline:
        if not closed and select.select([master], [], [], 0.02)[0]:
            data += os.read(master, 65536)
            if not approved and b'Allow human terminal? [y/N]' in data:
                os.write(master, b'y\r')
                approved = True
            if b'READY_TO_DISCONNECT' in data:
                os.close(master)
                closed = True
        waited, value = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = value
            break
        if closed:
            time.sleep(0.01)
finally:
    if not closed:
        os.close(master)
    if status is None:
        diagnostic = subprocess.check_output(['ps', '-p', str(pid), '-o', 'stat=,wchan=,command='], text=True).strip()
        try:
            with open('disconnect-state.json', encoding='utf-8') as state:
                diagnostic += ' ' + state.read()
        except FileNotFoundError:
            pass
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)

print(json.dumps({'approved': approved, 'disconnected': closed, 'host_exited': status is not None, 'exit_code': os.waitstatus_to_exitcode(status) if status is not None else None, 'diagnostic': diagnostic}))
sys.exit(0 if approved and closed and status is not None else 1)
