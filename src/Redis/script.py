"""
@project     MyDBTest

@author      Reversal
@contributor Resilience
@license     MIT
@github      https://github.com/revxshafi/MyDBTest
"""

import sys
import json
import os
import importlib.util

sys.path.insert(0, '.')

_here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_here, '../tests.json')) as _f:
    LABELS = json.load(_f)['redis']

from utils.ui import (
    spinner, step, print_results, status, status_line,
)
from utils.env import install_pip_package

PREFIX = 'mydbtest:'
TOTAL  = 10

def resolve_redis():
    if importlib.util.find_spec('redis') is None:
        status('run', 'installing redis driver')
        install_pip_package('redis')
    import redis
    return redis

def run(url):
    redis_mod = resolve_redis()

    results = []
    def pass_(label, note=None): results.append({'ok': True,  'label': label, 'note': note})
    def fail_(label, note=None): results.append({'ok': False, 'label': label, 'note': note})

    client = None

    # namespace all keys so cleanup is a single keys() + delete() call
    def k(name):
        return f'{PREFIX}{name}'

    try:
        step(1, TOTAL, LABELS[0])
        spin = spinner('Connecting to Redis...')
        try:
            client = redis_mod.from_url(url, socket_connect_timeout=5, decode_responses=True)
            pong = client.ping()
            spin.stop(status_line('ok', 'connected successfully'))
            pass_(LABELS[0], f'PING => {"PONG" if pong else pong}')
        except Exception as e:
            spin.stop(status_line('fail', f'connection failed: {e}'))
            fail_(LABELS[0], str(e))
            return results

        step(2, TOTAL, LABELS[1])
        client.set(k('str'), 'hello')
        got = client.get(k('str'))
        if got == 'hello':
            pass_(LABELS[1], f'got: {got}')
        else:
            fail_(LABELS[1], f"expected 'hello', got '{got}'")

        step(3, TOTAL, LABELS[2])
        client.set(k('ttl'), 'temp', ex=30)
        ttl = client.ttl(k('ttl'))
        if 0 < ttl <= 30:
            pass_(LABELS[2], f'TTL = {ttl}s')
        else:
            fail_(LABELS[2], f'unexpected TTL: {ttl}')

        step(4, TOTAL, LABELS[3])
        client.set(k('counter'), 0)
        after_incr = client.incr(k('counter'))
        after_decr = client.decr(k('counter'))
        if after_incr == 1 and after_decr == 0:
            pass_(LABELS[3], f'incr => {after_incr}, decr => {after_decr}')
        else:
            fail_(LABELS[3], f'incr={after_incr}, decr={after_decr}')

        step(5, TOTAL, LABELS[4])
        client.set(k('app'), 'foo')
        client.append(k('app'), 'bar')
        app_val = client.get(k('app'))
        if app_val == 'foobar':
            pass_(LABELS[4], f'got: {app_val}')
        else:
            fail_(LABELS[4], f"expected 'foobar', got '{app_val}'")

        step(6, TOTAL, LABELS[5])
        client.delete(k('list'))
        client.lpush(k('list'), 'c', 'b', 'a')
        lst = client.lrange(k('list'), 0, -1)
        if len(lst) == 3:
            pass_(LABELS[5], f'list: [{", ".join(lst)}]')
        else:
            fail_(LABELS[5], f'expected 3 elements, got {len(lst)}')

        step(7, TOTAL, LABELS[6])
        client.delete(k('set'))
        client.sadd(k('set'), 'x', 'y', 'z', 'x')
        members = client.smembers(k('set'))
        # duplicate 'x' should be deduplicated => 3 unique members
        if len(members) == 3:
            pass_(LABELS[6], f'members: [{", ".join(sorted(members))}]')
        else:
            fail_(LABELS[6], f'expected 3 unique members, got {len(members)}')

        step(8, TOTAL, LABELS[7])
        client.delete(k('hash'))
        client.hset(k('hash'), mapping={'name': 'tester', 'score': '42'})
        hsh = client.hgetall(k('hash'))
        if hsh.get('name') == 'tester' and hsh.get('score') == '42':
            pass_(LABELS[7], f"name={hsh['name']}, score={hsh['score']}")
        else:
            fail_(LABELS[7], f"name={hsh.get('name')}, score={hsh.get('score')}")

        step(9, TOTAL, LABELS[8])
        client.set(k('del_me'), '1')
        before = client.exists(k('del_me'))
        client.delete(k('del_me'))
        after = client.exists(k('del_me'))
        if before == 1 and after == 0:
            pass_(LABELS[8], 'key existed, deleted, confirmed gone')
        else:
            fail_(LABELS[8], f'before={before}, after={after}')

        step(10, TOTAL, LABELS[9])
        pipe = client.pipeline()
        pipe.set(k('p1'), 'alpha')
        pipe.set(k('p2'), 'beta')
        pipe.get(k('p1'))
        pipe.get(k('p2'))
        pipe_res = pipe.execute()
        p1 = pipe_res[2]
        p2 = pipe_res[3]
        if p1 == 'alpha' and p2 == 'beta':
            pass_(LABELS[9], f'p1={p1}, p2={p2}')
        else:
            fail_(LABELS[9], f'p1={p1}, p2={p2}')

    except Exception as e:
        print()
        status('fail', f'unexpected crash: {e}')
        fail_('Unexpected error', str(e))
    finally:
        if client:
            try:
                keys = client.keys(f'{PREFIX}*')
                if keys:
                    # pipeline delete => no *args unpacking, safe on large keyspaces
                    pipe = client.pipeline()
                    for key in keys:
                        pipe.delete(key)
                    pipe.execute()
            except Exception as e:
                status('info', f'cleanup warning: {e}')
            client.close()
            print()
            status('info', 'connection closed')

    print_results(results)
    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        status('info', 'usage: python3 src/Redis/script.py <url>')
        sys.exit(1)
    run(sys.argv[1])

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
