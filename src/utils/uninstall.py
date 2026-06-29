"""
@project     MyDBTest
@version     2.0.0

@author      Reversal
@contributor Resilience
@license     MIT
@github      https://github.com/revxshafi/MyDBTest
"""

import sys
import shutil
import platform
import subprocess
import tempfile
from pathlib import Path

from utils.ui import menu, status, green, yellow, dim
from utils.runtime import MYDBTEST_DIR, read_runtime_json

_sys = platform.system()

UNIX_BIN = Path.home() / '.local' / 'bin' / 'mydbtest'
WIN_WRAPPER     = 'mydbtest.ps1'
WIN_SCRIPT_DIRS = [
    Path.home() / 'Documents' / 'PowerShell' / 'Scripts',
    Path.home() / 'Documents' / 'WindowsPowerShell' / 'Scripts',
]


def _safe_remove(path):
    path = Path(path)
    try:
        if path.exists():
            shutil.rmtree(path) if path.is_dir() else path.unlink()
            return True
    except Exception:
        pass
    return False

def _pkg_manager_hint(runtime):
    if runtime == 'node':
        if _sys == 'Darwin':  return 'brew uninstall node'
        if _sys == 'Windows': return 'winget uninstall OpenJS.NodeJS.LTS'
        return 'sudo apt-get remove nodejs'
    if runtime == 'python':
        if _sys == 'Darwin':  return 'brew uninstall python3'
        if _sys == 'Windows': return 'https://www.python.org/downloads/'
        return 'sudo apt-get remove python3'
    return None

def _remove_path_lines_from_shell_profiles():
    """strip PATH export line install.sh added"""
    bin_dir = str(Path.home() / '.local' / 'bin')
    profiles = [
        Path.home() / '.bashrc',
        Path.home() / '.bash_profile',
        Path.home() / '.zshrc',
        Path.home() / '.config' / 'fish' / 'config.fish',
    ]

    for p in profiles:
        if not p.exists():
            continue
        try:
            original = p.read_text(encoding='utf-8')
            lines = [
                l for l in original.split('\n')
                if not (bin_dir in l and 'mydbtest' in l)
            ]
            updated = '\n'.join(lines)
            if updated != original:
                p.write_text(updated, encoding='utf-8')
                status('ok', f'removed path entry from {p}')
        except Exception:
            pass


def run_uninstall():
    print()

    first = menu('Do you want to uninstall MyDBTest?', [
        'Yes, uninstall',
        'Cancel',
    ])
    if first != 0:
        print(dim('\n  //  Cancelled.\n'))
        return

    print()
    status('info', 'checking what MyDBTest owns')
    print()

    rt           = read_runtime_json()
    node_entry   = rt.get('node',   {'source': 'none'})
    python_entry = rt.get('python', {'source': 'none'})

    to_delete = []
    to_skip   = []
    hints     = []

    to_delete.append(f'     application files  ({MYDBTEST_DIR})')

    hist_file = MYDBTEST_DIR / 'history.json'
    if hist_file.exists():
        to_delete.append(f'     connection history  ({hist_file})')

    node_dir = MYDBTEST_DIR / 'runtimes' / 'node'
    if node_entry.get('source') == 'private':
        to_delete.append(f'     private node runtime  ({node_dir})')
    elif node_entry.get('source') == 'system-existing' and node_entry.get('version'):
        to_skip.append(f"     node {node_entry['version']}  (was already installed before mydbtest)")
    elif node_entry.get('source') == 'system-installed-by-tool' and node_entry.get('version'):
        to_skip.append(f"     node {node_entry['version']}  (system-wide install — not removed automatically)")
        hints.append({'runtime': 'node', 'version': node_entry['version']})

    py_dir = MYDBTEST_DIR / 'runtimes' / 'python'
    if python_entry.get('source') == 'private':
        to_delete.append(f'     private python runtime  ({py_dir})')
    elif python_entry.get('source') == 'system-existing' and python_entry.get('version'):
        to_skip.append(f"     python {python_entry['version']}  (was already installed before mydbtest)")
    elif python_entry.get('source') == 'system-installed-by-tool' and python_entry.get('version'):
        to_skip.append(f"     python {python_entry['version']}  (system-wide install — not removed automatically)")
        hints.append({'runtime': 'python', 'version': python_entry['version']})

    if _sys == 'Windows':
        wrapper_path = next(
            (d / WIN_WRAPPER for d in WIN_SCRIPT_DIRS if (d / WIN_WRAPPER).exists()),
            None,
        )
    else:
        wrapper_path = UNIX_BIN if UNIX_BIN.exists() else None

    if wrapper_path:
        to_delete.append(f'     mydbtest command  ({wrapper_path})')

    to_delete.append('     PATH entry in shell profiles  (.bashrc / .zshrc / fish)')

    print('  will be removed:')
    for line in to_delete:
        print(green(line))

    if to_skip:
        print()
        print('  will not be removed:')
        for line in to_skip:
            print(dim(line))

    print()

    go = menu('Continue?', [
        'Yes, delete everything listed above',
        'Cancel',
    ])
    if go != 0:
        print(dim('\n  //  Cancelled.\n'))
        return

    print()
    status('run', 'uninstalling mydbtest')
    print()

    if _safe_remove(hist_file):
        status('ok', 'removed connection history')

    if node_entry.get('source') == 'private':
        if _safe_remove(node_dir): status('ok', 'removed private node runtime')
    elif node_entry.get('source') == 'system-existing':
        status('skip', f"node {node_entry.get('version')} was already installed before mydbtest — not removed")
    elif node_entry.get('source') == 'system-installed-by-tool':
        status('warn', f"node {node_entry.get('version')} was installed system-wide — not removed automatically")

    if python_entry.get('source') == 'private':
        if _safe_remove(py_dir): status('ok', 'removed private python runtime')
    elif python_entry.get('source') == 'system-existing':
        status('skip', f"python {python_entry.get('version')} was already installed before mydbtest — not removed")
    elif python_entry.get('source') == 'system-installed-by-tool':
        status('warn', f"python {python_entry.get('version')} was installed system-wide — not removed automatically")

    if _sys == 'Windows':
        for d in WIN_SCRIPT_DIRS:
            wp = d / WIN_WRAPPER
            if _safe_remove(wp):
                status('ok', f'removed mydbtest command from {d}')
    else:
        if _safe_remove(UNIX_BIN):
            status('ok', 'removed mydbtest command from path')
        # strip PATH line => won't get "no such file" on every new terminal 💔
        _remove_path_lines_from_shell_profiles()

    # can't delete parent dir while running inside it 🥀
    # => hand off to tiny script that sleeps then deletes
    if _sys == 'Windows':
        bat = Path(tempfile.gettempdir()) / 'mydbtest-cleanup.bat'
        bat.write_text('\r\n'.join([
            '@echo off',
            'ping -n 2 127.0.0.1 >nul',
            f'rmdir /s /q "{MYDBTEST_DIR}"',
            f'del /f /q "{bat}"',
        ]))
        try:
            subprocess.Popen(f'start "" /b cmd /c "{bat}"', shell=True)
        except Exception:
            pass
    else:
        sh = Path(tempfile.gettempdir()) / 'mydbtest-cleanup.sh'
        sh.write_text('\n'.join([
            '#!/bin/bash',
            'sleep 1',
            f'rm -rf "{MYDBTEST_DIR}"',
            f'rm -f "{sh}"',
        ]))
        try:
            sh.chmod(0o755)
            subprocess.Popen(
                ['nohup', str(sh)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    status('ok', 'removed application files')

    if hints:
        print()
        for h in hints:
            hint = _pkg_manager_hint(h['runtime'])
            name = f"node {h['version']}" if h['runtime'] == 'node' else f"python {h['version']}"
            if hint:
                print(dim(f'  to remove {name}: {hint}'))

    print()
    status('ok', 'mydbtest uninstalled')
    print()
    sys.exit(0)


"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
