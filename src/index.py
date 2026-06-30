"""
@project     MyDBTest

@author      Reversal
@contributor Resilience
@license     MIT
@github      https://github.com/revxshafi/MyDBTest
"""

import sys
import re
import time
import json
import os
import subprocess
from urllib.parse import urlparse

sys.path.insert(0, '.')

from utils.ui import (
    print_banner, menu, ask, spinner, status,
    green, red, yellow, cyan, dim, bold,
)
from utils.runtime import detect_node, detect_python

VERSION = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'package.json')))['version']
ISSUES_URL = 'https://github.com/revxshafi/MyDBTest/issues'

# advanced runtime flags, passed through from CLI
RUNTIME_FLAGS = {'--private-node', '--system-node', '--private-python', '--system-python', '--yes'}

MONGO_RE    = re.compile(r'^mongodb(\+srv)?://.+', re.IGNORECASE)
POSTGRES_RE = re.compile(r'^(postgresql|postgres)://.+', re.IGNORECASE)
REDIS_RE    = re.compile(r'^rediss?://.+', re.IGNORECASE)

DB_NAMES = ['MongoDB', 'PostgreSQL', 'Redis']
DB_HINTS = [
    'A MongoDB URL starts with mongodb:// or mongodb+srv://',
    'A PostgreSQL URL starts with postgresql:// or postgres://',
    'A Redis URL starts with redis:// or rediss://',
]

HISTORY_DIR  = os.path.join(os.path.expanduser('~'), '.mydbtest')
HISTORY_FILE = os.path.join(HISTORY_DIR, 'history.json')

def load_history():
    try:
        with open(HISTORY_FILE) as f:
            data = json.load(f)
        return data[:5] if isinstance(data, list) else []
    except Exception as e:
        if os.environ.get('MYDBTEST_DEBUG'):
            print(dim(f'  could not load history: {e}'))
        return []

def save_to_history(url):
    try:
        os.makedirs(HISTORY_DIR, exist_ok=True)
        existing = load_history()
        updated  = [url] + [u for u in existing if u != url]
        updated  = updated[:5]
        with open(HISTORY_FILE, 'w') as f:
            json.dump(updated, f, indent=2)
    except Exception as e:
        if os.environ.get('MYDBTEST_DEBUG'):
            print(dim(f'  could not save history: {e}'))

def encode_credentials(raw_url):
    # encode user/pass so special chars like @, #, ? don't break URL parsing
    from urllib.parse import quote
    scheme_match = re.match(
        r'^(mongodb(?:\+srv)?|postgresql|postgres|rediss?)(://)(.*)',
        raw_url, re.IGNORECASE
    )
    if not scheme_match:
        return raw_url
    scheme, slashes, rest = scheme_match.group(1), scheme_match.group(2), scheme_match.group(3)
    at_idx = rest.rfind('@')
    if at_idx == -1:
        return raw_url
    credentials = rest[:at_idx]
    host_and_db = rest[at_idx + 1:]
    colon_idx   = credentials.find(':')
    if colon_idx == -1:
        return f'{scheme}{slashes}{quote(credentials, safe="")}@{host_and_db}'
    user = credentials[:colon_idx]
    pwd  = credentials[colon_idx + 1:]
    return f'{scheme}{slashes}{quote(user, safe="")}:{quote(pwd, safe="")}@{host_and_db}'

def mask_url(raw_url):
    try:
        p      = urlparse(raw_url)
        scheme = p.scheme
        host   = p.hostname + (f':{p.port}' if p.port else '')
        db     = p.path.lstrip('/')
        display = f'{host}/{db}' if db else host
        return f'{display}  ({scheme})'
    except Exception:
        # don't echo raw_url back, the password could be sitting in plaintext
        scheme_match = re.match(
            r'^(mongodb(?:\+srv)?|postgresql|postgres|rediss?)://',
            raw_url, re.IGNORECASE
        )
        scheme = scheme_match.group(1) if scheme_match else 'unknown'
        return f'[unparseable URL]  ({scheme})'

def validate_url(url, db_type):
    patterns = [MONGO_RE, POSTGRES_RE, REDIS_RE]
    if patterns[db_type].match(url):
        return {'valid': True}
    return {'valid': False, 'hint': DB_HINTS[db_type]}

def prompt_for_url(db_type):
    history = load_history()

    if history:
        options = [mask_url(u) for u in history] + ['Enter a new URL']
        choice  = menu('Recent connections', options)

        if choice < len(history):
            url    = history[choice]
            result = validate_url(url, db_type)
            if result['valid']:
                status('ok', 'url format accepted')
                return url
            status('warn', f"that url is not compatible with {DB_NAMES[db_type]}, enter a new one")

    while True:
        print()
        raw = ask(f'Enter your {bold(DB_NAMES[db_type])} connection URL')

        spin = spinner('Checking URL...')
        time.sleep(0.3)
        spin.stop()

        url = encode_credentials(raw.strip())

        result = validate_url(url, db_type)
        if result['valid']:
            status('ok', 'url format accepted')
            return url

        status('fail', 'invalid url format')
        status('info', result['hint'])

def run_python_test_suite(db_type, url, python_bin=None):
    if python_bin is None:
        python_bin = sys.executable
    scripts = [
        'src/MongoDB/script.py',
        'src/Postgres/script.py',
        'src/Redis/script.py',
    ]
    result = subprocess.run([python_bin, scripts[db_type], url])
    if result.returncode not in (0, None):
        status('fail', f'script exited with code {result.returncode}')
    return result

def run_js_test_suite(db_type, url, node_bin='node'):
    scripts = [
        'src/MongoDB/script.js',
        'src/Postgres/script.js',
        'src/Redis/script.js',
    ]
    result = subprocess.run([node_bin, scripts[db_type], url])
    if result.returncode not in (0, None):
        status('fail', f'script exited with code {result.returncode}')

def main():
    if '--version' in sys.argv or '-v' in sys.argv:
        print(f'MyDBTest v{VERSION}')
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == 'uninstall':
        from utils.uninstall import run_uninstall
        run_uninstall()
        return

    print_banner()

    # pick the first recognised runtime flag from argv, if any
    flag = next((a for a in sys.argv[1:] if a in RUNTIME_FLAGS), None)

    db_type = menu('Which database do you want to test?', ['MongoDB', 'PostgreSQL', 'Redis'])
    lang    = menu('Which language do you want to use?', ['JavaScript (Node.js)', 'Python'])

    print()

    node_bin   = 'node'
    python_bin = sys.executable

    if lang == 1:
        result = detect_python(flag)
        if result and result.get('ok') and result.get('bin'):
            python_bin = result['bin']
    else:
        result = detect_node(flag)
        if result and result.get('ok') and result.get('bin'):
            node_bin = result['bin']

    url = prompt_for_url(db_type)

    status('run', f'starting {bold(DB_NAMES[db_type])} test suite')
    print()

    if lang == 1:
        result = run_python_test_suite(db_type, url, python_bin)
        if result is not None and result.returncode == 0:
            save_to_history(url)
    else:
        run_js_test_suite(db_type, url, node_bin)
        save_to_history(url)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print(dim('\n  Interrupted.\n'))
        sys.exit(0)
    except SystemExit:
        raise
    except Exception as e:
        status('fail', f'unexpected error: {e}')
        print(dim('  Something unexpected happened. If this keeps happening, please report it at:'))
        print(dim(f'  {ISSUES_URL}'))
        sys.exit(1)

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
