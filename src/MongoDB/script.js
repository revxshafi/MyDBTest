/**
 * @project     MyDBTest
 * @version     2.0.0
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

// failed import()s get cached, resolve first to check without that side-effect
const _require = createRequire(import.meta.url)

const LABELS = JSON.parse(readFileSync(new URL('../tests.json', import.meta.url), 'utf8')).mongodb

const DB_NAME  = 'testdb'
const COL_NAME = 'testcol'
const TOTAL    = 10

async function resolveMongoClient() {
  try {
    _require.resolve('mongodb')
  } catch {
    status('run', 'installing mongodb driver')
    installNpmPackage('mongodb')
  }
  const { MongoClient } = await import('mongodb')
  return MongoClient
}

export async function run(url) {
  const MongoClient = await resolveMongoClient()

  const results = []
  const pass = (label, note) => results.push({ ok: true,  label, note })
  const fail = (label, note) => results.push({ ok: false, label, note })

  let client

  try {
    step(1, TOTAL, LABELS[0])
    const spin = spinner('Connecting to MongoDB...')
    try {
      client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 })
      await client.connect()
      spin.stop(statusLine('ok', 'connected successfully'))
      pass(LABELS[0], url)
    } catch (e) {
      spin.stop(statusLine('fail', `connection failed: ${e.message}`))
      fail(LABELS[0], e.message)
      return results
    }

    const db  = client.db(DB_NAME)
    const col = db.collection(COL_NAME)

    // wipe the db before each run so tests don't bleed into each other
    try {
      await db.dropDatabase()
    } catch (e) {
      if (!e.message.includes('ns not found') && e.codeName !== 'NamespaceNotFound') {
        throw new Error(`dropDatabase failed: ${e.message}`)
      }
    }

    step(2, TOTAL, LABELS[1])
    const ins = await col.insertOne({ name: 'tester', val: 1 })
    const got = await col.findOne({ _id: ins.insertedId })
    got
      ? pass(LABELS[1], `got doc: ${got.name}`)
      : fail(LABELS[1], 'findOne returned nothing')

    step(3, TOTAL, LABELS[2])
    const upRes = await col.updateOne({ _id: ins.insertedId }, { $set: { val: 99 } })
    const doc3  = await col.findOne({ _id: ins.insertedId })
    upRes.modifiedCount === 1 && doc3?.val === 99
      ? pass(LABELS[2], 'val flipped to 99')
      : fail(LABELS[2], `modifiedCount=${upRes.modifiedCount}, val=${doc3?.val}`)

    step(4, TOTAL, LABELS[3])
    const repRes = await col.replaceOne({ _id: ins.insertedId }, { newName: 'replaced', score: 42 })
    const doc4   = await col.findOne({ _id: ins.insertedId })
    repRes.modifiedCount === 1 && doc4?.score === 42
      ? pass(LABELS[3], 'doc fully replaced')
      : fail(LABELS[3], `modifiedCount=${repRes.modifiedCount}, score=${doc4?.score}`)

    step(5, TOTAL, LABELS[4])
    const bulkRes   = await col.insertMany([{ t: 'a', x: 1 }, { t: 'b', x: 2 }, { t: 'c', x: 3 }])
    const totalDocs = await col.countDocuments()
    bulkRes.insertedCount === 3 && totalDocs >= 3
      ? pass(LABELS[4], `inserted 3, total now ${totalDocs}`)
      : fail(LABELS[4], `insertedCount=${bulkRes.insertedCount}, totalDocs=${totalDocs}`)

    step(6, TOTAL, LABELS[5])
    const dvals = await col.distinct('t')
    dvals.length > 0
      ? pass(LABELS[5], `got: [${dvals.join(', ')}]`)
      : fail(LABELS[5], 'empty result')

    step(7, TOTAL, LABELS[6])
    const fup = await col.findOneAndUpdate({ t: 'a' }, { $set: { done: true } }, { returnDocument: 'after' })
    // driver v4 wraps the result in { value: doc }, v5+ returns the doc directly
    const fupDoc = fup?.value ?? fup
    fupDoc?.done === true
      ? pass(LABELS[6], 'doc updated and returned')
      : fail(LABELS[6], `done=${fupDoc?.done}`)

    step(8, TOTAL, LABELS[7])
    const fdel    = await col.findOneAndDelete({ t: 'b' })
    const fdelDoc  = fdel?.value ?? fdel
    const leftover = await col.countDocuments({ t: 'b' })
    fdelDoc && leftover === 0
      ? pass(LABELS[7], 'doc deleted and returned')
      : fail(LABELS[7], `fdelDoc=${!!fdelDoc}, leftover=${leftover}`)

    step(9, TOTAL, LABELS[8])
    await col.createIndex({ x: 1 })
    const indexes = await col.indexes()
    indexes.find(i => i.name === 'x_1')
      ? pass(LABELS[8], 'x_1 index confirmed')
      : fail(LABELS[8], 'index not found in list')

    step(10, TOTAL, LABELS[9])
    let txOk  = false
    let txErr = null
    try {
      const session = client.startSession()
      await session.withTransaction(async () => {
        await col.insertOne({ tx: true, note: 'from transaction' }, { session })
      })
      await session.endSession()
      txOk = true
    } catch (e) {
      txErr = e
    }

    if (txOk) {
      pass(LABELS[9], 'committed successfully')
    } else if (txErr?.code === 20 || txErr?.code === 263 || txErr?.message?.toLowerCase().includes('transaction')) {
      // standalone mongod doesn't support transactions => skip, not a failure
      status('skip', 'transactions not supported on standalone instances, skipping')
      pass(LABELS[9], 'skipped — not a replica set')
    } else {
      fail(LABELS[9], txErr?.message ?? 'unknown error')
    }

  } catch (e) {
    console.log()
    status('fail', `unexpected crash: ${e.message}`)
    fail('Unexpected error', e.message)
  } finally {
    if (client) {
      try { await client.db(DB_NAME).dropDatabase() } catch {}
      await client.close()
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
    status('info', 'usage: node src/MongoDB/script.js <url>')
    process.exit(1)
  }
  run(url)
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
