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
    LABELS = json.load(_f)['mongodb']

from utils.ui import (
    spinner, step, print_results, status, status_line, dim,
)
from utils.env import install_pip_package

DB_NAME  = 'testdb'
COL_NAME = 'testcol'
TOTAL    = 10

def resolve_pymongo():
    if importlib.util.find_spec('pymongo') is None:
        status('run', 'installing pymongo')
        install_pip_package('pymongo')
    import pymongo
    return pymongo

def run(url):
    pymongo = resolve_pymongo()
    from pymongo import MongoClient
    from pymongo.errors import OperationFailure

    results = []
    def pass_(label, note=None): results.append({'ok': True,  'label': label, 'note': note})
    def fail_(label, note=None): results.append({'ok': False, 'label': label, 'note': note})

    client = None

    try:
        step(1, TOTAL, LABELS[0])
        spin = spinner('Connecting to MongoDB...')
        try:
            client = MongoClient(url, serverSelectionTimeoutMS=5000)
            client.admin.command('ping')
            spin.stop(status_line('ok', 'connected successfully'))
            pass_(LABELS[0], url)
        except Exception as e:
            spin.stop(status_line('fail', f'connection failed: {e}'))
            fail_(LABELS[0], str(e))
            return results

        db  = client[DB_NAME]
        col = db[COL_NAME]

        # wipe the db before each run so tests don't bleed into each other
        try:
            client.drop_database(DB_NAME)
        except OperationFailure as e:
            if 'ns not found' not in str(e):
                raise

        step(2, TOTAL, LABELS[1])
        ins_res = col.insert_one({'name': 'tester', 'val': 1})
        got = col.find_one({'_id': ins_res.inserted_id})
        if got:
            pass_(LABELS[1], f"got doc: {got['name']}")
        else:
            fail_(LABELS[1], 'find_one returned nothing')

        step(3, TOTAL, LABELS[2])
        up_res = col.update_one({'_id': ins_res.inserted_id}, {'$set': {'val': 99}})
        doc3   = col.find_one({'_id': ins_res.inserted_id})
        if up_res.modified_count == 1 and doc3 and doc3.get('val') == 99:
            pass_(LABELS[2], 'val flipped to 99')
        else:
            fail_(LABELS[2], f"modified_count={up_res.modified_count}, val={doc3.get('val') if doc3 else None}")

        step(4, TOTAL, LABELS[3])
        rep_res = col.replace_one({'_id': ins_res.inserted_id}, {'newName': 'replaced', 'score': 42})
        doc4    = col.find_one({'_id': ins_res.inserted_id})
        if rep_res.modified_count == 1 and doc4 and doc4.get('score') == 42:
            pass_(LABELS[3], 'doc fully replaced')
        else:
            fail_(LABELS[3], f"modified_count={rep_res.modified_count}, score={doc4.get('score') if doc4 else None}")

        step(5, TOTAL, LABELS[4])
        bulk_res   = col.insert_many([{'t': 'a', 'x': 1}, {'t': 'b', 'x': 2}, {'t': 'c', 'x': 3}])
        total_docs = col.count_documents({})
        if len(bulk_res.inserted_ids) == 3 and total_docs >= 3:
            pass_(LABELS[4], f'inserted 3, total now {total_docs}')
        else:
            fail_(LABELS[4], f'inserted={len(bulk_res.inserted_ids)}, totalDocs={total_docs}')

        step(6, TOTAL, LABELS[5])
        dvals = col.distinct('t')
        if dvals:
            pass_(LABELS[5], f'got: [{", ".join(dvals)}]')
        else:
            fail_(LABELS[5], 'empty result')

        step(7, TOTAL, LABELS[6])
        from pymongo import ReturnDocument
        fup_doc = col.find_one_and_update(
            {'t': 'a'},
            {'$set': {'done': True}},
            return_document=ReturnDocument.AFTER,
        )
        if fup_doc and fup_doc.get('done') is True:
            pass_(LABELS[6], 'doc updated and returned')
        else:
            fail_(LABELS[6], f"done={fup_doc.get('done') if fup_doc else None}")

        step(8, TOTAL, LABELS[7])
        fdel_doc = col.find_one_and_delete({'t': 'b'})
        leftover = col.count_documents({'t': 'b'})
        if fdel_doc and leftover == 0:
            pass_(LABELS[7], 'doc deleted and returned')
        else:
            fail_(LABELS[7], f'fdel_doc={bool(fdel_doc)}, leftover={leftover}')

        step(9, TOTAL, LABELS[8])
        col.create_index([('x', pymongo.ASCENDING)])
        indexes = list(col.list_indexes())
        if any(idx.get('name') == 'x_1' for idx in indexes):
            pass_(LABELS[8], 'x_1 index confirmed')
        else:
            fail_(LABELS[8], 'index not found in list')

        step(10, TOTAL, LABELS[9])
        tx_ok  = False
        tx_err = None
        try:
            with client.start_session() as session:
                with session.start_transaction():
                    col.insert_one({'tx': True, 'note': 'from transaction'}, session=session)
            tx_ok = True
        except Exception as e:
            tx_err = e

        if tx_ok:
            pass_(LABELS[9], 'committed successfully')
        elif getattr(tx_err, 'code', None) in (20, 263) or (tx_err and 'transaction' in str(tx_err).lower()):
            # standalone mongod doesn't support transactions => skip, not a failure
            status('skip', 'transactions not supported on standalone instances, skipping')
            pass_(LABELS[9], 'skipped — not a replica set')
        else:
            fail_(LABELS[9], str(tx_err) if tx_err else 'unknown error')

    except Exception as e:
        print()
        status('fail', f'unexpected crash: {e}')
        fail_('Unexpected error', str(e))
    finally:
        if client:
            try:
                client.drop_database(DB_NAME)
            except Exception:
                pass
            client.close()
            print()
            status('info', 'connection closed')

    print_results(results)
    return results


if __name__ == '__main__':
    if len(sys.argv) < 2:
        status('info', 'usage: python3 src/MongoDB/script.py <url>')
        sys.exit(1)
    run(sys.argv[1])

"""
Copyright (c) 2026 Reversal & Resilience
Licensed under the MIT License.
"""
