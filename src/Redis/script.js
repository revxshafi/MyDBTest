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

// failed import()s get cached — resolve first to check without that side-effect
const _require = createRequire(import.meta.url)

const LABELS = JSON.parse(readFileSync(new URL('../tests.json', import.meta.url), 'utf8')).redis

const PREFIX = 'mydbtest:'
const TOTAL  = 10

async function resolveRedis() {
  try {
    _require.resolve('ioredis')
  } catch {
    status('run', 'installing ioredis driver')
    installNpmPackage('ioredis')
  }
  const { default: Redis } = await import('ioredis')
  return Redis
}

export async function run(url) {
  const Redis = await resolveRedis()

  const results = []
  const pass = (label, note) => results.push({ ok: true,  label, note })
  const fail = (label, note) => results.push({ ok: false, label, note })

  // suppress the default error event so unhandled-rejection doesn't fire on connect failure
  const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false })
  client.on('error', () => {})

  try {
    step(1, TOTAL, LABELS[0])
    const spin = spinner('Connecting to Redis...')
    try {
      await client.connect()
      const pong = await client.ping()
      spin.stop(statusLine('ok', 'connected successfully'))
      pass(LABELS[0], `PING => ${pong}`)
    } catch (e) {
      spin.stop(statusLine('fail', `connection failed: ${e.message}`))
      fail(LABELS[0], e.message)
      return results
    }

    // namespace all keys so cleanup is a single KEYS + DEL call
    const k = (name) => `${PREFIX}${name}`

    step(2, TOTAL, LABELS[1])
    await client.set(k('str'), 'hello')
    const got = await client.get(k('str'))
    got === 'hello'
      ? pass(LABELS[1], `got: ${got}`)
      : fail(LABELS[1], `expected 'hello', got '${got}'`)

    step(3, TOTAL, LABELS[2])
    await client.set(k('ttl'), 'temp', 'EX', 30)
    const ttl = await client.ttl(k('ttl'))
    ttl > 0 && ttl <= 30
      ? pass(LABELS[2], `TTL = ${ttl}s`)
      : fail(LABELS[2], `unexpected TTL: ${ttl}`)

    step(4, TOTAL, LABELS[3])
    await client.set(k('counter'), 0)
    const after_incr = await client.incr(k('counter'))
    const after_decr = await client.decr(k('counter'))
    after_incr === 1 && after_decr === 0
      ? pass(LABELS[3], `incr => ${after_incr}, decr => ${after_decr}`)
      : fail(LABELS[3], `incr=${after_incr}, decr=${after_decr}`)

    step(5, TOTAL, LABELS[4])
    await client.set(k('app'), 'foo')
    await client.append(k('app'), 'bar')
    const appVal = await client.get(k('app'))
    appVal === 'foobar'
      ? pass(LABELS[4], `got: ${appVal}`)
      : fail(LABELS[4], `expected 'foobar', got '${appVal}'`)

    step(6, TOTAL, LABELS[5])
    await client.del(k('list'))
    await client.lpush(k('list'), 'c', 'b', 'a')
    const list = await client.lrange(k('list'), 0, -1)
    list.length === 3
      ? pass(LABELS[5], `list: [${list.join(', ')}]`)
      : fail(LABELS[5], `expected 3 elements, got ${list.length}`)

    step(7, TOTAL, LABELS[6])
    await client.del(k('set'))
    await client.sadd(k('set'), 'x', 'y', 'z', 'x')
    const members = await client.smembers(k('set'))
    // duplicate 'x' should be deduplicated => 3 unique members
    members.length === 3
      ? pass(LABELS[6], `members: [${members.sort().join(', ')}]`)
      : fail(LABELS[6], `expected 3 unique members, got ${members.length}`)

    step(8, TOTAL, LABELS[7])
    await client.del(k('hash'))
    await client.hset(k('hash'), 'name', 'tester', 'score', '42')
    const hash = await client.hgetall(k('hash'))
    hash?.name === 'tester' && hash?.score === '42'
      ? pass(LABELS[7], `name=${hash.name}, score=${hash.score}`)
      : fail(LABELS[7], `name=${hash?.name}, score=${hash?.score}`)

    step(9, TOTAL, LABELS[8])
    await client.set(k('del_me'), '1')
    const before = await client.exists(k('del_me'))
    await client.del(k('del_me'))
    const after = await client.exists(k('del_me'))
    before === 1 && after === 0
      ? pass(LABELS[8], 'key existed, deleted, confirmed gone')
      : fail(LABELS[8], `before=${before}, after=${after}`)

    step(10, TOTAL, LABELS[9])
    const pipe = client.pipeline()
    pipe.set(k('p1'), 'alpha')
    pipe.set(k('p2'), 'beta')
    pipe.get(k('p1'))
    pipe.get(k('p2'))
    const pipeRes = await pipe.exec()
    const p1 = pipeRes[2][1]
    const p2 = pipeRes[3][1]
    p1 === 'alpha' && p2 === 'beta'
      ? pass(LABELS[9], `p1=${p1}, p2=${p2}`)
      : fail(LABELS[9], `p1=${p1}, p2=${p2}`)

  } catch (e) {
    console.log()
    status('fail', `unexpected crash: ${e.message}`)
    fail('Unexpected error', e.message)
  } finally {
    try {
      const keys = await client.keys(`${PREFIX}*`)
      // array form, no spread => avoids stack overflow if keyspace is huge
      if (keys.length) await client.del(keys)
    } catch (e) {
      status('info', `cleanup warning: ${e.message}`)
    }
    try { await client.quit() } catch { client.disconnect() }
    console.log()
    status('info', 'connection closed')
  }

  printResults(results)
  return results
}

if (process.argv[1]?.endsWith('script.js')) {
  const url = process.argv[2]
  if (!url) {
    status('info', 'usage: node src/Redis/script.js <url>')
    process.exit(1)
  }
  run(url)
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
