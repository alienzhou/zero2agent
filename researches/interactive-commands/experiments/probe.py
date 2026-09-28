#!/usr/bin/env python3
"""Local POSIX mechanism probes, not product E2E tests. No network or credentials."""

import contextlib
import json
import os
import platform
import pty
import select
import signal
import subprocess
import sys
import time
from datetime import datetime


class Child:
    """Own a probe-created child; these Python fixtures spawn no descendants."""

    def __init__(self, source, terminal=False):
        self.process = None
        self.status = None
        self.terminal = terminal
        if terminal:
            self.pid, self.fd = pty.fork()
            if self.pid == 0:
                os.execv(sys.executable, [sys.executable, "-c", source])
        else:
            self.process = subprocess.Popen(
                [sys.executable, "-c", source],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self.pid = self.process.pid
            self.fd = self.process.stdout.fileno()
        os.set_blocking(self.fd, False)

    def read(self, seconds=0.15, until=None):
        data = b""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.fd], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                break
            try:
                chunk = os.read(self.fd, 65536)
            except OSError as error:
                # macOS/Linux may report slave closure as EIO rather than b''.
                if error.errno == 5:
                    break
                raise
            if not chunk:
                break
            data += chunk
            if until is not None and until in data:
                break
        return data

    def expect(self, marker):
        data = self.read(3, marker)
        assert marker in data, (marker, data)
        return data

    def write(self, data):
        if self.terminal:
            os.write(self.fd, data)
        else:
            self.process.stdin.write(data)
            self.process.stdin.flush()

    def close_input(self):
        assert not self.terminal, "A PTY master does not offer pipe-style half-close"
        self.process.stdin.close()

    def alive(self):
        if self.process is not None:
            return self.process.poll() is None
        if self.status is None:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.status = status
        return self.status is None

    def wait(self, timeout=3):
        """Observe direct-child exit without sending a cleanup signal."""
        if self.process is not None:
            return self.process.wait(timeout=timeout)
        deadline = time.monotonic() + timeout
        while self.alive():
            if time.monotonic() >= deadline:
                raise TimeoutError("PTY child did not exit within observation window")
            time.sleep(0.01)
        return os.waitstatus_to_exitcode(self.status)

    def close(self):
        # Give naturally exiting children time to be reaped before signaling a
        # process group whose leader may already be disappearing.
        with contextlib.suppress(subprocess.TimeoutExpired, TimeoutError):
            self.wait(timeout=0.2)
        # These PIDs are created above, never discovered by name or broad matching.
        if self.alive():
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.pid, signal.SIGKILL)
        if self.process is not None:
            self.process.wait(timeout=3)
            if not self.process.stdin.closed:
                self.process.stdin.close()
            self.process.stdout.close()
        else:
            try:
                self.wait(timeout=3)
            finally:
                os.close(self.fd)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def multi_turn():
    source = """import sys
print('number=7', flush=True)
answer = int(sys.stdin.readline())
print('confirm=' + str(7 + answer), flush=True)
confirmation = sys.stdin.readline().strip()
print('accepted=' + str(confirmation == str(7 + answer)), flush=True)
"""
    with Child(source) as child:
        first = child.expect(b"number=7")
        number = int(first.decode().strip().split("=")[1])
        child.write(str(number + 1).encode() + b"\n")
        second = child.expect(b"confirm=15")
        child.write(second.strip().split(b"=")[1] + b"\n")
        final = child.expect(b"accepted=True")
    return {"rounds": 2, "output": (first + second + final).decode()}


def buffering():
    source = "import sys; print('PROMPT'); print('BOOT', file=sys.stderr, flush=True); sys.stdin.readline(); print('DONE')"
    observed = {}
    for terminal in (False, True):
        with Child(source, terminal) as child:
            before = child.expect(b"BOOT") + child.read()
            child.write(b"answer\n")
            after = child.expect(b"DONE")
            observed["pty" if terminal else "pipe"] = {
                "prompt_before_input": b"PROMPT" in before,
                "before": before.decode(),
                "after": after.decode(),
            }
    assert not observed["pipe"]["prompt_before_input"]
    assert observed["pty"]["prompt_before_input"]
    return observed


def pipe_control_byte():
    source = "import sys; print('READY', flush=True); print('hex=' + sys.stdin.buffer.readline().hex(), flush=True)"
    with Child(source) as child:
        child.expect(b"READY")
        child.write(b"\x03\n")
        result = child.expect(b"hex=030a")
    return {"output": result.decode(), "ctrl_c_is_signal": False}


def signal_and_terminal_modes():
    source = """import json, os, signal, sys, termios, tty
def interrupted(*_):
    print('SIGINT', flush=True)
    sys.exit(0)
signal.signal(signal.SIGINT, interrupted)
MODE
if os.isatty(0):
    attrs = termios.tcgetattr(0)
    intr = attrs[6][termios.VINTR]
    print('CONFIG=' + json.dumps({
        'canonical': bool(attrs[3] & termios.ICANON),
        'isig': bool(attrs[3] & termios.ISIG),
        'vintr_hex': bytes([intr]).hex() if isinstance(intr, int) else intr.hex(),
        'foreground_is_self': os.tcgetpgrp(0) == os.getpgrp(),
    }), flush=True)
print('READY', flush=True)
data = os.read(0, 1)
print('byte=' + data.hex(), flush=True)
"""
    result = {}
    for mode in ("pipe-signal", "pty-canonical", "pty-raw"):
        setup = "pass"
        if mode == "pty-raw":
            setup = "tty.setraw(0)"
        elif mode == "pty-canonical":
            setup = "attrs = termios.tcgetattr(0); attrs[3] |= termios.ICANON | termios.ISIG; attrs[6][termios.VINTR] = b'\\x03'; termios.tcsetattr(0, termios.TCSANOW, attrs)"
        with Child(source.replace("MODE", setup), mode != "pipe-signal") as child:
            ready = child.expect(b"READY")
            config = None
            if mode != "pipe-signal":
                config = json.loads(next(line[7:] for line in ready.decode().splitlines() if line.startswith("CONFIG=")))
                assert config["foreground_is_self"]
                assert config["isig"] == (mode == "pty-canonical")
                assert config["canonical"] == (mode == "pty-canonical")
                assert config["vintr_hex"] == "03"
            if mode == "pipe-signal":
                os.killpg(child.pid, signal.SIGINT)
            else:
                # VINTR generates SIGINT only with ISIG, targeting the foreground group.
                child.write(b"\x03")
            expected = b"byte=03" if mode == "pty-raw" else b"SIGINT"
            output = child.expect(expected).decode()
            exit_code = child.wait()
            assert exit_code == 0
            result[mode] = {"terminal_config": config, "output": output, "exit_code": exit_code}
    return result


def eof():
    source = "import sys; print('READY', flush=True); data = sys.stdin.buffer.read(); print('EOF hex=' + data.hex(), flush=True)"
    with Child(source) as child:
        child.expect(b"READY")
        child.write(b"\x04")
        before = child.read()
        assert child.alive() and b"EOF" not in before
        child.close_input()
        pipe_result = child.expect(b"EOF hex=04")
        assert child.wait() == 0
    canonical = """import os, termios
attrs = termios.tcgetattr(0)
attrs[3] |= termios.ICANON
attrs[6][termios.VEOF] = b'\\x04'
termios.tcsetattr(0, termios.TCSANOW, attrs)
assert os.tcgetpgrp(0) == os.getpgrp()
print('READY', flush=True)
print('first=' + repr(os.read(0, 10)), flush=True)
print('second=' + os.read(0, 10).hex(), flush=True)
print('third=' + os.read(0, 10).hex(), flush=True)
"""
    with Child(canonical, True) as child:
        child.expect(b"READY")
        # Empty-buffer VEOF ends this read, not the terminal session.
        child.write(b"\x04")
        first = child.expect(b"first=b''")
        child.write(b"again\n")
        second = child.expect(b"second=616761696e0a")
        child.write(b"partial\x04")
        third = child.expect(b"third=7061727469616c")
        assert child.wait() == 0
    with Child("import os,tty; tty.setraw(0); print('READY',flush=True); print('raw='+os.read(0,1).hex(),flush=True)", True) as child:
        child.expect(b"READY")
        child.write(b"\x04")
        raw = child.expect(b"raw=04")
        assert child.wait() == 0
    return {"pipe_after_close": pipe_result.decode(), "pty_empty_line_veof": first.decode(),
            "pty_read_after_veof": second.decode(), "pty_partial_line_veof": third.decode(),
            "pty_raw_byte": raw.decode(), "direct_child_exit_codes": [0, 0, 0]}


def secrets_without_pty():
    source = "import sys; print('credential?', flush=True); value = sys.stdin.readline().strip(); print('received_length=' + str(len(value)), flush=True)"
    with Child(source) as child:
        child.expect(b"credential?")
        child.write(b"FAKE-ONLY-TOKEN\n")
        output = child.expect(b"received_length=15")
        assert child.wait() == 0
        output += child.read()
        assert b"FAKE-ONLY-TOKEN" not in output
    return {"synthetic_only": True, "output": output.decode()}


def controlling_terminal():
    source = """import os
print('isatty=' + str(os.isatty(0)), flush=True)
try:
    fd = os.open('/dev/tty', os.O_RDWR)
    os.close(fd)
    print('devtty=open', flush=True)
except OSError as error:
    print('devtty=error:' + str(error.errno), flush=True)
"""
    result = {}
    for terminal in (False, True):
        with Child(source, terminal) as child:
            output = child.expect(b"devtty=")
            result["pty" if terminal else "pipe_new_session"] = output.decode()
    assert "isatty=False" in result["pipe_new_session"]
    assert "devtty=error:" in result["pipe_new_session"]
    assert "devtty=open" in result["pty"]
    return result


def silence_is_not_state():
    result = {}
    sources = {
        "waiting_for_input": "import sys; print('READY', flush=True); sys.stdin.readline()",
        "sleeping": "import time; print('READY', flush=True); time.sleep(30)",
        "computing": "print('READY', flush=True)\nwhile True: pass",
    }
    for name, source in sources.items():
        with Child(source) as child:
            child.expect(b"READY")
            data = child.read(0.1)
            result[name] = {"new_bytes": len(data), "alive": child.alive()}
    assert all(value == {"new_bytes": 0, "alive": True} for value in result.values())
    return result


def node_probe(source):
    completed = subprocess.run(["node", "--input-type=module", "-e", source], capture_output=True, text=True, timeout=6)
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def detached_unref():
    return node_probe("""
import {spawn} from 'node:child_process';
const child = spawn(process.execPath, ['-e', "process.stdin.on('data', b => { console.log('echo='+b.toString().trim()); process.exit(0) })"], {detached:true, stdio:['pipe','pipe','pipe']});
child.unref();
// unref changes host liveness, so the observer must stay alive until close.
const observer = setTimeout(() => { child.kill('SIGKILL'); process.exitCode=1; }, 3000);
let output=''; child.stdout.on('data', b => output += b);
child.stderr.resume();
child.stdin.end('still-writable\\n');
child.on('close', code => { clearTimeout(observer); if (code!==0 || !output.includes('echo=still-writable')) process.exitCode=1; console.log(JSON.stringify({code, output, detached:true, unref:true})); });
""")


def exit_before_close():
    # The descendant normally self-exits after 350 ms; timeout cleanup covers
    # only the Node runner. The gap assertion is timing-sensitive, not a protocol guarantee.
    return node_probe("""
import {spawn} from 'node:child_process';
const program = "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),350)'],{stdio:['ignore',1,2]}).unref(); process.exit(0)";
const child=spawn(process.execPath,['-e',program],{stdio:['ignore','pipe','pipe']});
const start=Date.now(), events=[];
child.stdout.resume(); child.stderr.resume();
child.on('exit',()=>events.push({event:'exit',ms:Date.now()-start}));
child.on('close',()=>{events.push({event:'close',ms:Date.now()-start}); const gap=events[1].ms-events[0].ms; if(gap<200)process.exitCode=1;console.log(JSON.stringify({events,gap_ms:gap}));});
""")


def incremental_and_decode():
    return node_probe("""
import {StringDecoder} from 'node:string_decoder';
const bytes=Buffer.from('你好'); const chunks=[bytes.subarray(0,1),bytes.subarray(1,4),bytes.subarray(4)];
const naive=chunks.map(b=>b.toString('utf8')).join('');const decoder=new StringDecoder('utf8');const decoded=chunks.map(b=>decoder.write(b)).join('')+decoder.end();
const records=['first','second'];let cursor=0;const poll=()=>{const out=records.slice(cursor);cursor=records.length;return out;};const polls=[poll(),poll()]; records.push('third');polls.push(poll());
if(decoded!=='你好'||naive===decoded||JSON.stringify(polls)!==JSON.stringify([['first','second'],[],['third']]))process.exitCode=1;
console.log(JSON.stringify({naive,decoded,polls,kind:'controller algorithm fixture, not product code'}));
""")


def eof_is_not_cancel():
    source = "import sys; print('READY', flush=True); data=sys.stdin.buffer.read(); print('WOULD_COMMIT bytes=' + str(len(data)), flush=True)"
    with Child(source) as child:
        child.expect(b"READY")
        child.write(b"draft")
        assert not child.read()
        child.close_input()
        result = child.expect(b"WOULD_COMMIT bytes=5")
    return {"output": result.decode(), "real_side_effects": False}


def main():
    probes = [multi_turn, buffering, pipe_control_byte, signal_and_terminal_modes, eof,
              secrets_without_pty, controlling_terminal, silence_is_not_state,
              detached_unref, exit_before_close, incremental_and_decode, eof_is_not_cancel]
    records = []
    for number, probe in enumerate(probes, 1):
        try:
            details = probe()
            records.append({"id": f"E{number:02}", "name": probe.__name__, "passed": True, "details": details})
        except Exception as error:
            records.append({"id": f"E{number:02}", "name": probe.__name__, "passed": False, "error": repr(error)})
    report = {
        "observed_at": datetime.now().astimezone().isoformat(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "scope": "POSIX mechanism fixtures; no products or model API calls executed",
        "results": records,
        "passed": sum(record["passed"] for record in records),
        "total": len(records),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
