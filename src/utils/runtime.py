"""
@project     MyDBTest

@author      Reversal
@contributor Resilience
@license     MIT
@github      https://github.com/revxshafi/MyDBTest
"""

import os
import sys
import json
import shutil
import platform
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from utils.ui import menu, status, green, red, yellow, cyan, dim

_sys = platform.system()

if _sys == 'Windows':
    MYDBTEST_DIR = Path(os.environ.get('APPDATA') or Path.home() / 'AppData' / 'Roaming') / 'mydbtest'
else:
    MYDBTEST_DIR = Path.home() / '.mydbtest'

RUNTIME_JSON = MYDBTEST_DIR / 'runtime.json'
RUNTIMES_DIR = MYDBTEST_DIR / 'runtimes'

# current LTS, installs v22 by default, minimum required is v20
DEFAULT_NODE_MAJOR = '22'

ISSUES_URL = 'https://github.com/revxshafi/MyDBTest/issues'


def read_runtime_json():
    # missing file => treat as "none"
    try:
        if not RUNTIME_JSON.exists():
            return {'node': {'source': 'none'}, 'python': {'source': 'none'}}
        return json.loads(RUNTIME_JSON.read_text(encoding='utf-8'))
    except Exception:
        return {'node': {'source': 'none'}, 'python': {'source': 'none'}}

def write_runtime_json(data):
    MYDBTEST_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_JSON.write_text(json.dumps(data, indent=2), encoding='utf-8')

def patch_runtime(field, entry):
    data = read_runtime_json()
    data[field] = entry
    write_runtime_json(data)


// curl first, urllib fallback (no progress bar)
def _download_file(url, dest):
    if shutil.which('curl'):
        r = subprocess.run(
            ['curl', '-fsSL', '-o', str(dest), '--progress-bar', url],
            timeout=120,
        )
        if r.returncode != 0:
            raise RuntimeError('curl download failed')
    elif shutil.which('wget'):
        r = subprocess.run(
            ['wget', '-q', '--show-progress', '-O', str(dest), url],
            timeout=120,
        )
        if r.returncode != 0:
            raise RuntimeError('wget download failed')
    else:
        urllib.request.urlretrieve(url, dest)

def _extract_tar(src, dest, strip=1):
    // strip-components unwraps top-level wrapper dir
    dest.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ['tar', '-xf', str(src), '-C', str(dest), f'--strip-components={strip}'],
        timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError('tar extraction failed')

def _fetch_latest_node_version(major):
    try:
        with urllib.request.urlopen('https://nodejs.org/dist/index.json', timeout=10) as resp:
            releases = json.loads(resp.read())
            for r in releases:
                if r['version'].startswith(f'v{major}.'):
                    return r['version']
    except Exception:
        pass
    return f'v{major}.0.0'


def _install_node_private():
    _os  = platform.system()
    cpu  = platform.machine().lower()

    status('run', f'fetching latest node v{DEFAULT_NODE_MAJOR} release info')
    version = _fetch_latest_node_version(DEFAULT_NODE_MAJOR)

    node_os  = 'win' if _os == 'Windows' else 'darwin' if _os == 'Darwin' else 'linux'
    // arm/aarch64 both => arm64
    node_cpu = 'arm64' if ('arm' in cpu or 'aarch64' in cpu) else 'x64'
    ext      = 'zip' if _os == 'Windows' else 'tar.gz' if _os == 'Darwin' else 'tar.xz'
    filename = f'node-{version}-{node_os}-{node_cpu}.{ext}'
    url      = f'https://nodejs.org/dist/{version}/{filename}'

    node_dir     = RUNTIMES_DIR / 'node'
    resolved_dir = node_dir.resolve()
    tmp_file     = Path(tempfile.gettempdir()) / filename

    status('run', f'downloading node {version}  {node_os}-{node_cpu}')

    try:
        _download_file(url, tmp_file)
    except Exception as e:
        try: tmp_file.unlink()
        except: pass
        status('fail', f'download failed: {e}')
        print(dim('  check your internet connection and try again'))
        print(dim('  to retry: mydbtest --private-node'))
        return {'ok': False}

    status('run', 'extracting runtime')
    try:
        _extract_tar(tmp_file, resolved_dir)
    except Exception as e:
        try: tmp_file.unlink()
        except: pass
        // partial extraction => clean it for next attempt
        try: shutil.rmtree(resolved_dir, ignore_errors=True)
        except: pass
        status('fail', f'extraction failed: {e}')
        print(dim('  to retry: mydbtest --private-node'))
        return {'ok': False}

    try: tmp_file.unlink()
    except: pass

    bin_path = str(resolved_dir / ('node.exe' if _os == 'Windows' else 'bin/node'))
    patch_runtime('node', {'source': 'private', 'version': version.lstrip('v'), 'path': bin_path})
    status('ok', f'node {version} installed')
    print(dim(f'  binary: {bin_path}'))
    return {'ok': True, 'bin': bin_path}

def _install_node_system():
    _os = platform.system()

    if _os == 'Darwin':
        cmd = ['brew', 'install', 'node']
    elif _os == 'Windows':
        cmd = ['winget', 'install', 'OpenJS.NodeJS.LTS', '-e', '--source', 'winget']
    elif shutil.which('apt-get'):
        // nodesource setup script => apt install
        cmd = [
            'bash', '-c',
            f'curl -fsSL https://deb.nodesource.com/setup_{DEFAULT_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs',
        ]
    elif shutil.which('dnf'):
        cmd = ['sudo', 'dnf', 'module', 'install', '-y', f'nodejs:{DEFAULT_NODE_MAJOR}']
    else:
        status('fail', 'could not detect a supported package manager')
        print(dim('  visit https://nodejs.org to install manually'))
        return {'ok': False}

    status('run', 'installing node system-wide')
    try:
        subprocess.run(cmd, check=True, timeout=180)
    except Exception as e:
        status('fail', f'system install failed: {e}')
        return {'ok': False}

    r   = subprocess.run(['node', '--version'], capture_output=True, text=True)
    ver = r.stdout.strip().lstrip('v') if r.returncode == 0 else 'unknown'
    patch_runtime('node', {'source': 'system-installed-by-tool', 'version': ver, 'path': None})
    status('ok', 'node installed system-wide')
    return {'ok': True, 'bin': 'node'}


def _install_python_private():
    _os  = platform.system()
    cpu  = platform.machine().lower()

    PY_VERSION  = '3.12.9'
    RELEASE_TAG = '20250529'
    // arm/aarch64 both => aarch64 for this distro
    cpu_tag = 'aarch64' if ('arm' in cpu or 'aarch64' in cpu) else 'x86_64'

    if _os == 'Darwin':
        filename = f'cpython-{PY_VERSION}+{RELEASE_TAG}-{cpu_tag}-apple-darwin-install_only_stripped.tar.gz'
    elif _os == 'Windows':
        filename = f'cpython-{PY_VERSION}+{RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz'
    else:
        filename = f'cpython-{PY_VERSION}+{RELEASE_TAG}-{cpu_tag}-unknown-linux-gnu-install_only_stripped.tar.gz'

    url = f'https://github.com/indygreg/python-build-standalone/releases/download/{RELEASE_TAG}/{filename}'

    py_dir       = RUNTIMES_DIR / 'python'
    resolved_dir = py_dir.resolve()
    tmp_file     = Path(tempfile.gettempdir()) / filename

    status('run', f'downloading python {PY_VERSION}')

    try:
        _download_file(url, tmp_file)
    except Exception as e:
        try: tmp_file.unlink()
        except: pass
        status('fail', f'download failed: {e}')
        print(dim('  check your internet connection and try again'))
        print(dim('  to retry: mydbtest --private-python'))
        return {'ok': False}

    status('run', 'extracting runtime')
    try:
        # python-build-standalone is nested two levels: archive → python/ → install/...
        # strip=2 lands us at the install root where bin/ lives 🥀
        _extract_tar(tmp_file, resolved_dir, strip=2)
    except Exception as e:
        try: tmp_file.unlink()
        except: pass
        try: shutil.rmtree(resolved_dir, ignore_errors=True)
        except: pass
        status('fail', f'extraction failed: {e}')
        print(dim('  to retry: mydbtest --private-python'))
        return {'ok': False}

    try: tmp_file.unlink()
    except: pass

    bin_path = str(resolved_dir / ('python.exe' if _os == 'Windows' else 'bin/python3'))
    patch_runtime('python', {'source': 'private', 'version': PY_VERSION, 'path': bin_path})
    status('ok', f'python {PY_VERSION} installed')
    print(dim(f'  binary: {bin_path}'))
    return {'ok': True, 'bin': bin_path}

def _install_python_system():
    _os = platform.system()

    if _os == 'Darwin':
        cmd = ['brew', 'install', 'python3']
    elif _os == 'Windows':
        print(dim('  windows python install requires a terminal restart to take effect'))
        status('info', 'visit https://www.python.org/downloads/ and install python 3.8+')
        patch_runtime('python', {'source': 'system-installed-by-tool', 'version': 'unknown', 'path': None})
        return {'ok': False}
    elif shutil.which('apt-get'):
        cmd = ['sudo', 'apt-get', 'install', '-y', 'python3']
    elif shutil.which('dnf'):
        cmd = ['sudo', 'dnf', 'install', '-y', 'python3']
    elif shutil.which('pacman'):
        cmd = ['sudo', 'pacman', '-S', '--noconfirm', 'python']
    else:
        status('fail', 'could not detect a package manager, install python 3.8+ manually')
        return {'ok': False}

    status('run', 'installing python system-wide')
    try:
        subprocess.run(cmd, check=True, timeout=180)
    except Exception as e:
        status('fail', f'system install failed: {e}')
        return {'ok': False}

    for bin_name in ['python3', 'python']:
        r = subprocess.run([bin_name, '--version'], capture_output=True, text=True)
        if r.returncode == 0:
            ver = (r.stdout or r.stderr).strip().replace('Python ', '')
            patch_runtime('python', {'source': 'system-installed-by-tool', 'version': ver, 'path': None})
            status('ok', f'python {ver} installed system-wide')
            return {'ok': True, 'bin': bin_name}

    return {'ok': False}


def detect_node(flag=None):
    """
    Check that Node.js is available and meets the version minimum.
    Pass a flag like '--private-node' or '--yes' to skip the prompt.
    """
    rt = read_runtime_json()

    // 1. private install from previous run, verify binary still exists
    node_entry = rt.get('node', {})
    if node_entry.get('source') == 'private' and node_entry.get('path'):
        bin_path = node_entry['path']
        if Path(bin_path).exists():
            ver = node_entry.get('version', '')
            status('ok', f'node v{ver} detected' + dim('  (private)'))
            return {'ok': True, 'bin': bin_path}

    // 2. system node
    r = subprocess.run(['node', '--version'], capture_output=True, text=True)
    if r.returncode == 0:
        raw = r.stdout.strip().lstrip('v')
        try:
            major = int(raw.split('.')[0])
        except ValueError:
            major = 0
        if major >= 20:
            patch_runtime('node', {'source': 'system-existing', 'version': raw, 'path': None})
            status('ok', f'node v{raw} detected')
            return {'ok': True, 'bin': 'node'}
        status('warn', f'node v{major} found — v20 or higher is required')
    else:
        status('skip', 'node not found on PATH')

    // 3. non-interactive flags skip prompt
    if flag in ('--yes', '--private-node'):
        return _install_node_private()
    if flag == '--system-node':
        return _install_node_system()

    // 4. interactive
    print()
    choice = menu('node v20 or higher is required.', [
        'Install private runtime (recommended) — removed automatically on uninstall',
        'Install system-wide — MyDBTest will not remove it on uninstall',
        'Cancel',
    ])

    if choice == 0: return _install_node_private()
    if choice == 1: return _install_node_system()

    status('skip', 'continuing without node, javascript tests will not be available')
    patch_runtime('node', {'source': 'none', 'version': None, 'path': None})
    return {'ok': False}

def detect_python(flag=None):
    """
    same as detect_node but for python
    only call when user chose python path
    """
    rt = read_runtime_json()

    // 1. private install
    py_entry = rt.get('python', {})
    if py_entry.get('source') == 'private' and py_entry.get('path'):
        bin_path = py_entry['path']
        if Path(bin_path).exists():
            ver = py_entry.get('version', '')
            status('ok', f'python {ver} detected' + dim('  (private)'))
            return {'ok': True, 'bin': bin_path}

    // 2. system python
    for bin_name in ['python3', 'python']:
        if not shutil.which(bin_name):
            continue
        r = subprocess.run([bin_name, '--version'], capture_output=True, text=True)
        if r.returncode == 0:
            raw = (r.stdout or r.stderr).strip().replace('Python ', '')
            try:
                parts = raw.split('.')
                maj, mn = int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                maj, mn = 0, 0
            // maj > 3 handles python 4, (maj == 3 and mn >= 8) handles 3.8+
            if maj > 3 or (maj == 3 and mn >= 8):
                patch_runtime('python', {'source': 'system-existing', 'version': raw, 'path': None})
                status('ok', f'python {raw} detected')
                return {'ok': True, 'bin': bin_name}
            status('warn', f'python {raw} found — v3.8 or higher is required')
            break

    // 3. non-interactive
    if flag in ('--yes', '--private-python'):
        return _install_python_private()
    if flag == '--system-python':
        return _install_python_system()

    // 4. interactive
    print()
    choice = menu('python 3.8 or higher is not installed.', [
        'Install private runtime (recommended) — removed automatically on uninstall',
        'Install system-wide — MyDBTest will not remove it on uninstall',
        'Cancel',
    ])

    if choice == 0: return _install_python_private()
    if choice == 1: return _install_python_system()

    status('skip', 'continuing without python, python tests will not be available')
    patch_runtime('python', {'source': 'none', 'version': None, 'path': None})
    return {'ok': False}

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
