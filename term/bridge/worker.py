"""One PTY per worker. JSON lines on stdin/stdout; terminal bytes are base64."""
import base64
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios

shell = sys.argv[1]
pid, master = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execv(shell, [shell, '-i'])


def emit(value):
    print(json.dumps(value), flush=True)


def resize(cols, rows):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def stop(*_):
    raise SystemExit()


signal.signal(signal.SIGTERM, stop)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ)
selector.register(sys.stdin.fileno(), selectors.EVENT_READ)
pending = b''
try:
    resize(int(sys.argv[2]), int(sys.argv[3]))
    while True:
        for key, _ in selector.select():
            if key.fd == master:
                try:
                    data = os.read(master, 16384)
                except OSError:
                    data = b''
                if not data:
                    raise SystemExit()
                emit({'data': base64.b64encode(data).decode('ascii')})
            else:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if not chunk:
                    raise SystemExit()
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    message = json.loads(line)
                    if message['op'] == 'input':
                        data = memoryview(base64.b64decode(message['data'], validate=True))
                        while data:
                            data = data[os.write(master, data):]
                    elif message['op'] == 'resize':
                        resize(message['cols'], message['rows'])
                    elif message['op'] == 'close':
                        raise SystemExit()
finally:
    # Terminate both the foreground job and the shell's process group.
    groups = {pid}
    try:
        foreground = os.tcgetpgrp(master)
        if foreground > 0 and foreground != os.getpgrp():
            groups.add(foreground)
    except OSError:
        pass
    for group in groups:
        try:
            os.killpg(group, signal.SIGHUP)
        except ProcessLookupError:
            pass
    os.close(master)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
