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
import subprocess

from utils.ui import status_line, dim

def detect_os():
    if sys.platform == 'win32':
        return 'windows'
    if sys.platform == 'darwin':
        return 'macos'
    return 'linux'

def get_python_version():
    v = sys.version_info
    return f'{v.major}.{v.minor}.{v.micro}'

def command_exists(cmd):
    return shutil.which(cmd) is not None

# use the current interpreter's pip so we don't hit a wrong env
def install_pip_package(pkg):
    try:
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', pkg, '--quiet'],
            stdout=subprocess.DEVNULL,
            # stderr stays open so pip errors are actually visible
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        sys.stdout.write('\r\x1b[2K')
        sys.stdout.flush()
        sys.stderr.write(status_line('fail', 'driver install timed out after 30s.') + '\n')
        sys.stderr.write(dim(f'  run manually: pip install {pkg}') + '\n')
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        sys.stdout.write('\r\x1b[2K')
        sys.stdout.flush()
        sys.stderr.write(status_line('fail', f'driver install failed (exit code {e.returncode}).') + '\n')
        sys.stderr.write(dim(f'  run manually: pip install {pkg}') + '\n')
        sys.exit(1)

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
