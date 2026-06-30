/**
 * @project     MyDBTest
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import {
  spinner, step, printResults, status, statusLine,
} from '../utils/ui.js'
import { installNpmPackage } from '../utils/env.js'

// 🫠 failed import() calls get cached even when they throw => use _require.resolve() to probe first, avoids locking out a retry
const _require = createRequire(import.meta.url)

const LABELS = JSON.parse(readFileSync(new URL('../tests.json', import.meta.url), 'utf8')).postgresql

const SCHEMA = 'dbtester_tmp'
const TABLE  = `${SCHEMA}.test_items`
const TOTAL  = 10

async function resolvePgClient() {
  try {
    _require.resolve('pg')
  } catch {
    status('run', 'installing pg driver')
    installNpmPackage('pg')
  }
  const mod = await import('pg')
  return mod.default.Client
}

export async function run(url) {
  const PgClient = await resolvePgClient()

  const results = []
  const pass = (label, note) => results.push({ ok: true,  label, note })
  const fail = (label, note) => results.push({ ok: false, label, note })

  let client

  try {
    step(1, TOTAL, LABELS[0])
    const spin = spinner('Connecting to PostgreSQL...')
    try {
      client = new PgClient({ connectionString: url, connectionTimeoutMillis: 5000 })
      await client.connect()
      spin.stop(statusLine('ok', 'connected successfully'))
      pass(LABELS[0], url)
    } catch (e) {
      spin.stop(statusLine('fail', `connection failed: ${e.message}`))
      fail(LABELS[0], e.message)
      return results
    }

    // drop first so a previous crashed run doesn't leave dirty state
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id     SERIAL PRIMARY KEY,
        name   TEXT NOT NULL,
        value  INTEGER,
        tag    TEXT,
        active BOOLEAN DEFAULT FALSE
      )
    `)

    step(2, TOTAL, LABELS[1])
    const insRes = await client.query(
      `INSERT INTO ${TABLE} (name, value, tag) VALUES ($1, $2, $3) RETURNING id`,
      ['tester', 1, 'alpha']
    )
    const rowId  = insRes.rows[0].id
    const selRes = await client.query(`SELECT * FROM ${TABLE} WHERE id = $1`, [rowId])
    selRes.rows[0]?.name === 'tester'
      ? pass(LABELS[1], `got row: name=${selRes.rows[0].name}`)
      : fail(LABELS[1], 'SELECT returned wrong or no row')

    step(3, TOTAL, LABELS[2])
    const updRes = await client.query(
      `UPDATE ${TABLE} SET value = $1 WHERE id = $2 RETURNING *`,
      [99, rowId]
    )
    updRes.rows[0]?.value === 99
      ? pass(LABELS[2], 'value flipped to 99')
      : fail(LABELS[2], `value=${updRes.rows[0]?.value}`)

    step(4, TOTAL, LABELS[3])
    const repRes = await client.query(
      `UPDATE ${TABLE} SET name = $1, value = $2, tag = $3, active = $4 WHERE id = $5 RETURNING *`,
      ['replaced', 42, 'beta', true, rowId]
    )
    const repRow = repRes.rows[0]
    repRow?.name === 'replaced' && repRow?.value === 42 && repRow?.active === true
      ? pass(LABELS[3], 'all columns updated correctly')
      : fail(LABELS[3], `name=${repRow?.name}, value=${repRow?.value}, active=${repRow?.active}`)

    step(5, TOTAL, LABELS[4])
    await client.query(
      `INSERT INTO ${TABLE} (name, value, tag) VALUES ($1,$2,$3), ($4,$5,$6), ($7,$8,$9)`,
      ['row_a', 10, 'gamma', 'row_b', 20, 'gamma', 'row_c', 30, 'delta']
    )
    const countRes = await client.query(`SELECT COUNT(*) FROM ${TABLE}`)
    const total    = parseInt(countRes.rows[0].count, 10)
    total >= 4
      ? pass(LABELS[4], `total rows now ${total}`)
      : fail(LABELS[4], `expected >= 4 rows, got ${total}`)

    step(6, TOTAL, LABELS[5])
    const distRes = await client.query(`SELECT DISTINCT tag FROM ${TABLE}`)
    distRes.rows.length > 0
      ? pass(LABELS[5], `got ${distRes.rows.length} distinct tag(s)`)
      : fail(LABELS[5], 'no distinct values returned')

    step(7, TOTAL, LABELS[6])
    const updRetRes = await client.query(
      `UPDATE ${TABLE} SET active = $1 WHERE tag = $2 RETURNING *`,
      [true, 'gamma']
    )
    updRetRes.rows.length > 0 && updRetRes.rows[0].active === true
      ? pass(LABELS[6], `${updRetRes.rows.length} row(s) updated and returned`)
      : fail(LABELS[6], `rows=${updRetRes.rows.length}`)

    step(8, TOTAL, LABELS[7])
    const delRes  = await client.query(
      `DELETE FROM ${TABLE} WHERE name = $1 RETURNING *`,
      ['row_a']
    )
    const afterDel = await client.query(`SELECT * FROM ${TABLE} WHERE name = $1`, ['row_a'])
    delRes.rows.length > 0 && afterDel.rows.length === 0
      ? pass(LABELS[7], 'row deleted and confirmed gone')
      : fail(LABELS[7], `deleted=${delRes.rows.length}, remaining=${afterDel.rows.length}`)

    step(9, TOTAL, LABELS[8])
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tag ON ${TABLE} (tag)`)
    const idxRes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
      [SCHEMA, 'idx_tag']
    )
    idxRes.rows.length > 0
      ? pass(LABELS[8], 'idx_tag confirmed in pg_indexes')
      : fail(LABELS[8], 'index not found in pg_indexes')

    step(10, TOTAL, LABELS[9])
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO ${TABLE} (name, value, tag) VALUES ($1, $2, $3)`,
      ['tx_row', 999, 'tx']
    )
    await client.query('COMMIT')
    const txCheck = await client.query(`SELECT * FROM ${TABLE} WHERE tag = $1`, ['tx'])
    txCheck.rows.length > 0
      ? pass(LABELS[9], 'row committed and verified')
      : fail(LABELS[9], 'committed row not found after COMMIT')

  } catch (e) {
    console.log()
    status('fail', `unexpected crash: ${e.message}`)
    fail('Unexpected error', e.message)
  } finally {
    if (client) {
      try { await client.query('ROLLBACK') } catch {}
      try { await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`) } catch (e) {
        status('info', `cleanup warning: ${e.message}`)
      }
      await client.end()
      console.log()
      status('info', 'connection closed')
    }
  }

  printResults(results)
  return results
}

if (process.argv[1]?.endsWith('script.js')) {
  const url = process.argv[2]
  if (!url) {
    status('info', 'usage: node src/Postgres/script.js <url>')
    process.exit(1)
  }
  run(url)
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
