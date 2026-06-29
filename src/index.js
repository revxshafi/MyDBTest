/**
 * @project     MyDBTest
 * @version     2.0.0
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import { spawnSync } from 'child_process'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  printBanner, menu, ask, spinner, status,
  green, red, yellow, cyan, dim, bold,
} from './utils/ui.js'
import { detectAndEnsureNode, detectAndEnsurePython } from './utils/runtime.js'

const ISSUES_URL = 'https://github.com/revxshafi/MyDBTest/issues'

process.on('uncaughtException', (e) => {
  status('fail', `unexpected error: ${e.message}`)
  console.log(dim('  Something unexpected happened. If this keeps happening, please report it at:'))
  console.log(dim(`  ${ISSUES_URL}`))
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log(dim('\n  Interrupted.\n'))
  process.exit(0)
})

const VERSION  = '2.0.0'
const JSON_MODE = process.argv.includes('--json')

// runtime flags passed through from run.sh
const RUNTIME_FLAGS = ['--private-node', '--system-node', '--private-python', '--system-python', '--yes']

const MONGO_RE    = /^mongodb(\+srv)?:\/\/.+/i
const POSTGRES_RE = /^(postgresql|postgres):\/\/.+/i
const REDIS_RE    = /^rediss?:\/\/.+/i

const DB_NAMES = ['MongoDB', 'PostgreSQL', 'Redis']
const DB_HINTS = [
  'A MongoDB URL starts with mongodb:// or mongodb+srv://',
  'A PostgreSQL URL starts with postgresql:// or postgres://',
  'A Redis URL starts with redis:// or rediss://',
]

const HISTORY_DIR  = join(homedir(), '.mydbtest')
const HISTORY_FILE = join(HISTORY_DIR, 'history.json')

function loadHistory() {
  try {
    if (!existsSync(HISTORY_FILE)) return []
    const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(data) ? data.slice(0, 5) : []
  } catch (e) {
    if (process.env.MYDBTEST_DEBUG) console.log(dim(`  could not load history: ${e.message}`))
    return []
  }
}

function saveToHistory(url) {
  try {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true })
    const existing = loadHistory()
    const updated  = [url, ...existing.filter(u => u !== url)].slice(0, 5)
    writeFileSync(HISTORY_FILE, JSON.stringify(updated, null, 2), 'utf8')
  } catch (e) {
    if (process.env.MYDBTEST_DEBUG) console.log(dim(`  could not save history: ${e.message}`))
  }
}

function maskUrl(rawUrl) {
  try {
    const parsed  = new URL(rawUrl)
    const scheme  = parsed.protocol.replace(':', '')
    const host    = parsed.hostname + (parsed.port ? `:${parsed.port}` : '')
    const db      = parsed.pathname.replace(/^\//, '')
    const display = db ? `${host}/${db}` : host
    return `${display}  (${scheme})`
  } catch {
    // don't echo rawUrl back, password could be plaintext
    const schemeMatch = rawUrl.match(/^(mongodb(?:\+srv)?|postgresql|postgres|rediss?):\/\//i)
    const scheme = schemeMatch ? schemeMatch[1] : 'unknown'
    return `[unparseable URL]  (${scheme})`
  }
}

function validateUrl(url, dbType) {
  const patterns = [MONGO_RE, POSTGRES_RE, REDIS_RE]
  if (patterns[dbType].test(url)) return { valid: true }
  return { valid: false, hint: DB_HINTS[dbType] }
}

async function promptForUrl(dbType) {
  const history = loadHistory()

  if (history.length > 0) {
    const options = [...history.map(maskUrl), 'Enter a new URL']
    const choice  = await menu('Recent connections', options)

    if (choice < history.length) {
      const url    = history[choice]
      const result = validateUrl(url, dbType)
      if (result.valid) {
        status('ok', 'url format accepted')
        return url
      }
      status('warn', `that url is not compatible with ${DB_NAMES[dbType]}, enter a new one`)
    }
  }

  while (true) {
    console.log()
    const raw = await ask(`Enter your ${bold(DB_NAMES[dbType])} connection URL`)

    const spin = spinner('Checking URL...')
    await new Promise(r => setTimeout(r, 300))
    spin.stop()

    const url = raw.trim()

    const result = validateUrl(url, dbType)
    if (result.valid) {
      status('ok', 'url format accepted')
      return url
    }

    status('fail', 'invalid url format')
    status('info', result.hint)
  }
}

async function runJsTestSuite(dbType, url) {
  const scriptPaths = [
    './MongoDB/script.js',
    './Postgres/script.js',
    './Redis/script.js',
  ]

  const { run } = await import(scriptPaths[dbType])
  return run(url)
}

function runPythonTestSuite(dbType, url, pythonBin = 'python3') {
  const scriptPaths = [
    'src/MongoDB/script.py',
    'src/Postgres/script.py',
    'src/Redis/script.py',
  ]

  const result = spawnSync(pythonBin, [scriptPaths[dbType], url], { stdio: 'inherit' })
  if (result.status !== 0 && result.status !== null) {
    status('fail', `python script exited with code ${result.status}`)
  }
}

async function runJsonMode() {
  process.env.MYDBTEST_JSON = '1'
  const args   = process.argv.slice(2).filter(a => a !== '--json')
  const dbArg  = args[0]?.toLowerCase()
  const urlArg = args[1]

  const DB_MAP  = { mongodb: 0, postgresql: 1, postgres: 1, redis: 2 }
  const DB_KEY  = ['mongodb', 'postgresql', 'redis']
  const SCRIPTS = ['./MongoDB/script.js', './Postgres/script.js', './Redis/script.js']

  if (!dbArg || !(dbArg in DB_MAP) || !urlArg) {
    process.stderr.write(
      'Usage: node src/index.js --json <mongodb|postgresql|redis> <url>\n'
    )
    process.exit(1)
  }

  const dbType = DB_MAP[dbArg]

  // silence all console output so only the JSON object reaches stdout
  console.log   = () => {}
  console.error = () => {}
  console.warn  = () => {}

  let results
  try {
    const { run } = await import(SCRIPTS[dbType])
    results = await run(urlArg)
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`)
    process.exit(1)
  }

  const passed = results.filter(r => r.ok).length
  const output = {
    database: DB_KEY[dbType],
    language: 'javascript',
    passed,
    failed: results.length - passed,
    tests: results.map(r => ({ name: r.label, passed: r.ok, note: r.note ?? null })),
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
  process.exit(passed === results.length ? 0 : 1)
}

async function main() {
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(`MyDBTest v${VERSION}`)
    process.exit(0)
  }

  // uninstall before banner => screen stays clean
  if (process.argv.includes('uninstall')) {
    const { runUninstall } = await import('./utils/uninstall.js')
    await runUninstall()
    return
  }

  if (JSON_MODE) {
    await runJsonMode()
    return
  }

  const flag = process.argv.find(a => RUNTIME_FLAGS.includes(a)) || null

  printBanner()

  const dbType = await menu('Which database do you want to test?', [
    'MongoDB',
    'PostgreSQL',
    'Redis',
  ])

  const lang = await menu('Which language do you want to use?', [
    'JavaScript (Node.js)',
    'Python',
  ])

  console.log()

  let pythonBin = 'python3'

  if (lang === 0) {
    await detectAndEnsureNode({ flag })
  } else {
    const result = await detectAndEnsurePython({ flag })
    if (result?.ok && result.bin !== 'python3') pythonBin = result.bin
  }

  const url = await promptForUrl(dbType)

  status('run', `starting ${bold(DB_NAMES[dbType])} test suite`)
  console.log()

  if (lang === 0) {
    const results = await runJsTestSuite(dbType, url)
    // only save after real connection, not just valid format
    if (results && results[0]?.ok) saveToHistory(url)
  } else {
    runPythonTestSuite(dbType, url, pythonBin)
    saveToHistory(url)
  }
}

main()

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
