"""
@project     MyDBTest
@version     2.0.0

@author      Reversal
@contributor Resilience
@license     MIT
@github      https://github.com/revxshafi/MyDBTest
"""

import sys
import time
import threading

C = {
    'reset':  '\x1b[0m',
    'bold':   '\x1b[1m',
    'dim':    '\x1b[2m',
    'green':  '\x1b[32m',
    'red':    '\x1b[31m',
    'yellow': '\x1b[33m',
    'cyan':   '\x1b[36m',
    'white':  '\x1b[37m',
    'grey':   '\x1b[90m',
}

def green(t):  return f"{C['green']}{t}{C['reset']}"
def red(t):    return f"{C['red']}{t}{C['reset']}"
def yellow(t): return f"{C['yellow']}{t}{C['reset']}"
def cyan(t):   return f"{C['cyan']}{t}{C['reset']}"
def dim(t):    return f"{C['dim']}{t}{C['reset']}"
def bold(t):   return f"{C['bold']}{t}{C['reset']}"

# fixed-width tag column => everything aligns, colour on tag only
_STATUS = {
    'ok':   ('OK',   green),
    'warn': ('WARN', yellow),
    'fail': ('FAIL', red),
    'run':  ('>>',   cyan),
    'info': ('INFO', dim),
    'skip': ('--',   dim),
}

def status_line(kind, msg=''):
    label, colour = _STATUS.get(kind, _STATUS['info'])
    pad   = max(0, 6 - len(label))
    inside = ' ' * (pad // 2) + label + ' ' * (pad - pad // 2)
    return f'  [{colour(inside)}] {msg}'

def status(kind, msg=''):
    print(status_line(kind, msg))

def print_banner():
    print(cyan('\n  ─────────────────────────────────────────────'))
    print(cyan(''))
    print(cyan(r'    ___  ___     ____________ _____         _   '))
    print(cyan(r'    |  \/  |     |  _  \ ___ \_   _|       | |  '))
    print(cyan(r'    | .  . |_   _| | | | |_/ / | | ___  ___| |_ '))
    print(cyan(r'    | |\/| | | | | | | | ___ \ | |/ _ \/ __| __|'))
    print(cyan(r'    | |  | | |_| | |/ /| |_/ / | |  __/\__ \ |_ '))
    print(cyan(r'    \_|  |_/\__, |___/ \____/  \_/\___||___/\__|'))
    print(cyan(r'             __/ |'))
    print(cyan(r'            |___/'))
    print(cyan(''))
    print(dim('    MyDBTest  —  Database connection & operation tester  —  v2.0.0'))
    print(cyan('\n  ─────────────────────────────────────────────\n'))

# non-TTY => plain static line, \r rewrites would be noise
def spinner(label):
    is_tty = hasattr(sys.stdout, 'isatty') and sys.stdout.isatty()

    if not is_tty:
        sys.stdout.write(f'  {label}\n')
        sys.stdout.flush()

        class _Static:
            def stop(self, final_msg=None):
                if final_msg:
                    print(final_msg)

        return _Static()

    frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    stop_event = threading.Event()

    def _spin():
        i = 0
        while not stop_event.is_set():
            frame = frames[i % len(frames)]
            sys.stdout.write(f'\r  {cyan(frame)}  {label}')
            sys.stdout.flush()
            i += 1
            stop_event.wait(0.08)

    thread = threading.Thread(target=_spin, daemon=True)
    thread.start()

    class _Spinner:
        def stop(self, final_msg=None):
            stop_event.set()
            thread.join()
            sys.stdout.write('\r\x1b[2K')
            sys.stdout.flush()
            if final_msg:
                print(final_msg)

    return _Spinner()

def countdown(label, seconds):
    is_tty = hasattr(sys.stdout, 'isatty') and sys.stdout.isatty()

    if not is_tty:
        print(f'  {label}')
        time.sleep(seconds)
        return

    remaining = seconds

    def write():
        sys.stdout.write(f'\r  {cyan("v")}  {label} {dim(f"({remaining}s)")}  ')
        sys.stdout.flush()

    write()
    for _ in range(seconds):
        time.sleep(1)
        remaining -= 1
        if remaining <= 0:
            break
        write()

    sys.stdout.write('\r\x1b[2K')
    sys.stdout.flush()

# single keypress, no Enter. ESC exits, non-TTY falls back to input()
def menu(prompt, options):
    print(f'\n  {bold(prompt)}\n')
    for i, opt in enumerate(options):
        print(f'    {cyan(f"# {i + 1}.")}  {opt}')
    print(dim('\n  // Press a number key to select. Press Escape to quit.\n'))

    is_tty = hasattr(sys.stdin, 'isatty') and sys.stdin.isatty()

    if not is_tty:
        answer = input('  Selection: ').strip()
        try:
            n = int(answer)
            if 1 <= n <= len(options):
                print(f'  {dim(">")}  {options[n - 1]}\n')
                return n - 1
        except ValueError:
            pass
        # no silent default => could kick off real test in CI
        sys.stderr.write(status_line('fail', 'Invalid selection in non-TTY mode. Use --json for scripted runs.') + '\n')
        sys.exit(1)

    if sys.platform == 'win32':
        import msvcrt
        while True:
            ch = msvcrt.getwch()
            if ch == '\x1b':
                print(dim('\n  Goodbye.\n'))
                sys.exit(0)
            if ch == '\x03':
                print(dim('\n  Interrupted.\n'))
                sys.exit(0)
            try:
                n = int(ch)
                if 1 <= n <= len(options):
                    print(f'  {dim(">")}  {options[n - 1]}\n')
                    return n - 1
            except ValueError:
                pass
    else:
        import tty
        import termios
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            while True:
                ch = sys.stdin.read(1)
                if ch == '\x1b':
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    print(dim('\n  Goodbye.\n'))
                    sys.exit(0)
                # raw mode disables ISIG => ctrl+c is a byte, handle it or menu loops forever 😭
                if ch == '\x03':
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    print(dim('\n  Interrupted.\n'))
                    sys.exit(0)
                try:
                    n = int(ch)
                    if 1 <= n <= len(options):
                        termios.tcsetattr(fd, termios.TCSADRAIN, old)
                        print(f'  {dim(">")}  {options[n - 1]}\n')
                        return n - 1
                except ValueError:
                    pass
        except Exception:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
            raise

def ask(prompt):
    return input(f'  {cyan(">")}  {prompt}: ').strip()

def step(n, total, label):
    status('run', f'{dim(f"[{n:02d}/{total}]")}  {label}')

def print_results(results):
    print()
    for r in results:
        note = f"  {dim(r['note'])}" if r.get('note') else ''
        status('ok' if r['ok'] else 'fail', f"{r['label']}{note}")

    passed = sum(1 for r in results if r['ok'])
    total  = len(results)

    print()
    if passed == total:
        status('ok', f"{bold(f'{passed}/{total} passed')}{dim('  ·  healthy')}")
    else:
        status('fail', f"{bold(f'{passed}/{total} passed')}{dim(f'  ·  {total - passed} failed')}")
    print()

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
