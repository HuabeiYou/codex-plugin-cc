#!/usr/bin/env python3
"""Test-only terminal driver. Operates only its own CLI and background hosts."""
import fcntl, json, os, pathlib, select, signal, struct, subprocess, sys, termios, time, tty

request = json.loads(pathlib.Path(sys.argv[1]).read_text())
trace = pathlib.Path(request['trace'])
master, slave = os.openpty()
tty.setraw(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))
child = subprocess.Popen(request['argv'], cwd=request['cwd'], env=request['env'], stdin=slave, stdout=slave, stderr=slave, start_new_session=True, preexec_fn=lambda: fcntl.ioctl(0, termios.TIOCSCTTY, 0))
os.close(slave)
started = time.monotonic()
sent_prompt = False
confirmed_trust = False
trust_selected_at = None
trust_seen_at = None
raw_screen = ''
sent_arrow = None
ready_seen_at = None
screen = ''
rows = []
try:
    while time.monotonic() - started < 50:
        if select.select([master], [], [], .1)[0]:
            try:
                chunk = os.read(master, 65536).decode(errors='replace')
                screen += chunk
                raw_screen += chunk
            except OSError: break
            screen = screen[-20000:]
        if trace.exists():
            rows = [json.loads(line) for line in trace.read_text().splitlines() if line]
        if child.poll() is not None: break
        if trust_seen_at is None and 'Accessing' in screen and 'No,' in screen: trust_seen_at = time.monotonic()
        if not confirmed_trust and trust_seen_at is not None and time.monotonic() - trust_seen_at > 1.5:
            os.write(master, b'\x1b[B')
            trust_selected_at = time.monotonic()
            confirmed_trust = True
            screen = ''
        if trust_selected_at is not None and time.monotonic() - trust_selected_at > .3:
            os.write(master, b'\r')
            trust_selected_at = None
        if not sent_prompt and any(row['type'] == 'session.start' for row in rows):
            os.write(master, b'Navigation acceptance\r')
            sent_prompt = True
        if ready_seen_at is None and any(row['type'] == 'bridge.chunk' and '"kind":"ready"' in row['text'] for row in rows): ready_seen_at = time.monotonic()
        if sent_arrow is None and ready_seen_at is not None and time.monotonic() - ready_seen_at > 1 and any(row['type'] == 'turn.complete' and not row.get('agentId') for row in rows):
            os.write(master, b'\x1b[D')
            sent_arrow = time.monotonic()
        if any(row['type'] == 'parent.read' for row in rows):
            print(json.dumps({'navigated': sent_arrow is not None, 'wallMs': round((time.monotonic() - started) * 1000)}))
            break
    else:
        raise RuntimeError('Navigation acceptance exceeded 50 seconds; inspect its trace.')
    if not any(row['type'] == 'parent.read' for row in rows):
        raise RuntimeError('The parent did not read the resumed worker report.')
finally:
    if not any(row['type'] == 'parent.read' for row in rows): trace.with_suffix('.screen.txt').write_text(raw_screen)
    # Stop the foreground fleet view first, so it cannot respawn a host that
    # cleanup is trying to stop. This PID was created by this controller.
    try: os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    try: child.wait(timeout=3)
    except subprocess.TimeoutExpired: pass
    processes = {}
    for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,command='], text=True).splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3: processes[int(parts[0])] = (int(parts[1]), parts[2])
    daemons = {pid for pid, (_, command) in processes.items()
               if 'claude daemon run' in command and request['cwd'] in command}
    owned = set(daemons)
    while True:
        children = {pid for pid, (parent, _) in processes.items() if parent in owned}
        if children <= owned: break
        owned |= children
    # Kill only this test's isolated service first, preventing replacements.
    for pid in daemons:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
    for pid in owned - daemons:
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
    # Background handoffs start another CLI. Only kill a traced PID whose
    # command still contains this test's unique driver directory.
    hosts = {row['hostPid'] for row in rows} | {child.pid}
    for line in subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and request['driver'] in parts[1] and ('/claude ' in parts[1] or parts[1].startswith('claude ') or '/versions/' in parts[1]): hosts.add(int(parts[0]))
    for pid in hosts:
        try:
            command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True)
            if request['driver'] in command:
                os.kill(pid, signal.SIGTERM)
                parent = int(subprocess.check_output(['ps', '-p', str(pid), '-o', 'ppid='], text=True))
                parent_cmd = subprocess.check_output(['ps', '-p', str(parent), '-o', 'command='], text=True)
                if request['driver'] in parent_cmd and '--bg-pty-host' in parent_cmd: os.kill(parent, signal.SIGTERM)
        except (subprocess.CalledProcessError, ProcessLookupError): pass
    os.close(master)
