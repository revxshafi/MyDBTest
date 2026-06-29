"""
@project     MyDBTest
@version     2.0.0

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
    LABELS = json.load(_f)['postgresql']

from utils.ui import (
    spinner, step, print_results, status, status_line, dim,
)
from utils.env import install_pip_package

SCHEMA = 'dbtester_tmp'
TABLE  = f'{SCHEMA}.test_items'
TOTAL  = 10

def resolve_psycopg2():
    if importlib.util.find_spec('psycopg2') is None:
        status('run', 'installing psycopg2-binary')
        install_pip_package('psycopg2-binary')
    import psycopg2
    import psycopg2.extras
    return psycopg2

def run(url):
    psycopg2 = resolve_psycopg2()
    import psycopg2.extras

    results = []
    def pass_(label, note=None): results.append({'ok': True,  'label': label, 'note': note})
    def fail_(label, note=None): results.append({'ok': False, 'label': label, 'note': note})

    conn = None

    try:
        step(1, TOTAL, LABELS[0])
        spin = spinner('Connecting to PostgreSQL...')
        try:
            # RealDictCursor => rows come back as dicts, no more row[1] guessing
            conn = psycopg2.connect(
                url,
                connect_timeout=5,
                cursor_factory=psycopg2.extras.RealDictCursor,
            )
            spin.stop(status_line('ok', 'connected successfully'))
            pass_(LABELS[0], url)
        except Exception as e:
            spin.stop(status_line('fail', f'connection failed: {e}'))
            fail_(LABELS[0], str(e))
            return results

        # 💔 psycopg2 opens a transaction on connect automatically, but DDL (CREATE SCHEMA/TABLE)
        # can't run inside one => flip autocommit on for the setup block, then back off
        conn.autocommit = True
        with conn.cursor() as cur:
            # drop first so a previous crashed run doesn't leave dirty state
            cur.execute(f'DROP SCHEMA IF EXISTS {SCHEMA} CASCADE')
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS {SCHEMA}')
            cur.execute(f'''
                CREATE TABLE IF NOT EXISTS {TABLE} (
                    id     SERIAL PRIMARY KEY,
                    name   TEXT NOT NULL,
                    value  INTEGER,
                    tag    TEXT,
                    active BOOLEAN DEFAULT FALSE
                )
            ''')
        conn.autocommit = False

        step(2, TOTAL, LABELS[1])
        with conn.cursor() as cur:
            cur.execute(
                f'INSERT INTO {TABLE} (name, value, tag) VALUES (%s, %s, %s) RETURNING id',
                ('tester', 1, 'alpha')
            )
            row_id = cur.fetchone()['id']
            cur.execute(f'SELECT * FROM {TABLE} WHERE id = %s', (row_id,))
            row = cur.fetchone()
        conn.commit()
        if row and row['name'] == 'tester':
            pass_(LABELS[1], f"got row: name={row['name']}")
        else:
            fail_(LABELS[1], 'SELECT returned wrong or no row')

        step(3, TOTAL, LABELS[2])
        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE {TABLE} SET value = %s WHERE id = %s RETURNING *',
                (99, row_id)
            )
            upd_row = cur.fetchone()
        conn.commit()
        if upd_row and upd_row['value'] == 99:
            pass_(LABELS[2], 'value flipped to 99')
        else:
            fail_(LABELS[2], f"value={upd_row['value'] if upd_row else None}")

        step(4, TOTAL, LABELS[3])
        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE {TABLE} SET name = %s, value = %s, tag = %s, active = %s WHERE id = %s RETURNING *',
                ('replaced', 42, 'beta', True, row_id)
            )
            rep_row = cur.fetchone()
        conn.commit()
        if rep_row and rep_row['name'] == 'replaced' and rep_row['value'] == 42 and rep_row['active'] is True:
            pass_(LABELS[3], 'all columns updated correctly')
        else:
            fail_(LABELS[3], f"name={rep_row['name'] if rep_row else None}, value={rep_row['value'] if rep_row else None}")

        step(5, TOTAL, LABELS[4])
        with conn.cursor() as cur:
            cur.execute(
                f'INSERT INTO {TABLE} (name, value, tag) VALUES (%s,%s,%s), (%s,%s,%s), (%s,%s,%s)',
                ('row_a', 10, 'gamma', 'row_b', 20, 'gamma', 'row_c', 30, 'delta')
            )
            cur.execute(f'SELECT COUNT(*) FROM {TABLE}')
            total_count = cur.fetchone()['count']
        conn.commit()
        if total_count >= 4:
            pass_(LABELS[4], f'total rows now {total_count}')
        else:
            fail_(LABELS[4], f'expected >= 4 rows, got {total_count}')

        step(6, TOTAL, LABELS[5])
        with conn.cursor() as cur:
            cur.execute(f'SELECT DISTINCT tag FROM {TABLE}')
            dist_rows = cur.fetchall()
        if dist_rows:
            pass_(LABELS[5], f'got {len(dist_rows)} distinct tag(s)')
        else:
            fail_(LABELS[5], 'no distinct values returned')

        step(7, TOTAL, LABELS[6])
        with conn.cursor() as cur:
            cur.execute(
                f'UPDATE {TABLE} SET active = %s WHERE tag = %s RETURNING *',
                (True, 'gamma')
            )
            upd_ret_rows = cur.fetchall()
        conn.commit()
        if upd_ret_rows and upd_ret_rows[0]['active'] is True:
            pass_(LABELS[6], f'{len(upd_ret_rows)} row(s) updated and returned')
        else:
            fail_(LABELS[6], f'rows={len(upd_ret_rows)}')

        step(8, TOTAL, LABELS[7])
        with conn.cursor() as cur:
            cur.execute(f'DELETE FROM {TABLE} WHERE name = %s RETURNING *', ('row_a',))
            del_rows = cur.fetchall()
            cur.execute(f'SELECT * FROM {TABLE} WHERE name = %s', ('row_a',))
            after_del = cur.fetchall()
        conn.commit()
        if del_rows and not after_del:
            pass_(LABELS[7], 'row deleted and confirmed gone')
        else:
            fail_(LABELS[7], f'deleted={len(del_rows)}, remaining={len(after_del)}')

        step(9, TOTAL, LABELS[8])
        conn.autocommit = True  # same deal — CREATE INDEX won't run inside a transaction
        with conn.cursor() as cur:
            cur.execute(f'CREATE INDEX IF NOT EXISTS idx_tag ON {TABLE} (tag)')
            cur.execute(
                "SELECT indexname FROM pg_indexes WHERE schemaname = %s AND indexname = %s",
                (SCHEMA, 'idx_tag')
            )
            idx_rows = cur.fetchall()
        conn.autocommit = False
        if idx_rows:
            pass_(LABELS[8], 'idx_tag confirmed in pg_indexes')
        else:
            fail_(LABELS[8], 'index not found in pg_indexes')

        step(10, TOTAL, LABELS[9])
        with conn.cursor() as cur:
            cur.execute(
                f'INSERT INTO {TABLE} (name, value, tag) VALUES (%s, %s, %s)',
                ('tx_row', 999, 'tx')
            )
        conn.commit()
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM {TABLE} WHERE tag = %s", ('tx',))
            tx_rows = cur.fetchall()
        if tx_rows:
            pass_(LABELS[9], 'row committed and verified')
        else:
            fail_(LABELS[9], 'committed row not found after COMMIT')

    except Exception as e:
        print()
        status('fail', f'unexpected crash: {e}')
        fail_('Unexpected error', str(e))
    finally:
        if conn:
            try:
                conn.rollback()
                conn.autocommit = True
                with conn.cursor() as cur:
                    cur.execute(f'DROP SCHEMA IF EXISTS {SCHEMA} CASCADE')
            except Exception as e:
                status('info', f'cleanup warning: {e}')
            conn.close()
            print()
            status('info', 'connection closed')

    print_results(results)
    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        status('info', 'usage: python3 src/Postgres/script.py <url>')
        sys.exit(1)
    run(sys.argv[1])

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
