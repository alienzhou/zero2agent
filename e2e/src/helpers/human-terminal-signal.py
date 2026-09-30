"""Signal a live CLI while keeping its PTY open; inspect restoration before cleanup."""
import errno
import json
import os
import pty
import select
import signal
import sys
import termios
import time

gate_read, gate_write = os.pipe()
pid, master = pty.fork()
if pid == 0:
    os.close(gate_write)
    os.read(gate_read, 1)
    os.close(gate_read)
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], '--terminal', 'bash ./signal.sh'])

os.close(gate_read)
# Capture the device before Node can enter raw mode, not on a startup timer.
baseline = termios.tcgetattr(master)
os.write(gate_write, b'1')
os.close(gate_write)
data = b''
approved = False
sent = False
status = None
restored = False
remaining = []
tracked_children = 0
error = ''

def collect():
    global data
    if not select.select([master], [], [], 0.02)[0]:
        return
    try:
        data += os.read(master, 65536)
    except OSError as exc:
        if exc.errno != errno.EIO:
            raise

try:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        collect()
        if not approved and b'Allow human terminal? [y/N]' in data:
            os.write(master, b'y\r')
            approved = True
        if not sent and b'READY_TO_SIGNAL' in data:
            os.kill(pid, getattr(signal, sys.argv[3]))
            sent = True
        waited, value = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = value
            collect()
            restored = termios.tcgetattr(master) == baseline
            break
except Exception as exc:
    error = str(exc)
finally:
    # Inspect owned fixture PIDs before emergency cleanup, so cleanup cannot hide a leak.
    try:
        with open('signal-pids.txt', encoding='utf-8') as source:
            fixture_pids = [int(value) for value in source.read().split()]
        if len(fixture_pids) != 2 or len(set(fixture_pids)) != 2 or any(
            child <= 1 or child in (pid, os.getpid()) for child in fixture_pids
        ):
            raise ValueError('Expected two distinct owned fixture PIDs')
        tracked_children = len(fixture_pids)
        for child in fixture_pids:
            try:
                os.kill(child, 0)
                remaining.append(child)
            except ProcessLookupError:
                pass
    except (OSError, ValueError) as exc:
        # Missing/invalid PID evidence must not look like successful process cleanup.
        error = error or str(exc)
    for child in remaining:
        try:
            os.kill(child, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if status is None:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(master)

reset = b'\x1b[0m\x1b[?25h\x1b[?1049l\x1b[?2004l'
result = {
    'approved': approved,
    'signal_sent': sent,
    'exit_code': os.waitstatus_to_exitcode(status) if status is not None else None,
    'terminal_restored': restored,
    'display_reset': reset in data,
    'tracked_children': tracked_children,
    'remaining_children': remaining,
    'error': error,
}
print(json.dumps(result))
sys.exit(0 if status is not None and not error else 1)
