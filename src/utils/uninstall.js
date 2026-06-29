/**
 * @project     MyDBTest
 * @version     2.0.0
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import { join } from 'path'
import { existsSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir, platform, tmpdir } from 'os'
import { menu, status, green, yellow, dim, bold } from './ui.js'
import { MYDBTEST_DIR, readRuntimeJson } from './runtime.js'

const UNIX_BIN    = join(homedir(), '.local', 'bin', 'mydbtest')
const WIN_WRAPPER = 'mydbtest.ps1'
const WIN_SCRIPT_DIRS = [
  join(homedir(), 'Documents', 'PowerShell', 'Scripts'),
  join(homedir(), 'Documents', 'WindowsPowerShell', 'Scripts'),
]

function safeRemove(path) {
  try {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true })
      return true
    }
  } catch {}
  return false
}

function pkgManagerHint(runtime) {
  const os = platform()
  if (runtime === 'node') {
    if (os === 'darwin') return 'brew uninstall node'
    if (os === 'win32')  return 'winget uninstall OpenJS.NodeJS.LTS'
    return 'sudo apt-get remove nodejs'
  }
  if (runtime === 'python') {
    if (os === 'darwin') return 'brew uninstall python3'
    if (os === 'win32')  return 'https://www.python.org/downloads/'
    return 'sudo apt-get remove python3'
  }
  return null
}

// remove the PATH export line that install.sh added to shell profiles.
// if the line isn't there, this is a no-op — safe to call regardless.
function removePathLineFromShellProfiles() {
  const BIN_DIR = join(homedir(), '.local', 'bin')
  const profiles = [
    join(homedir(), '.bashrc'),
    join(homedir(), '.bash_profile'),
    join(homedir(), '.zshrc'),
    join(homedir(), '.config', 'fish', 'config.fish'),
  ]

  let removed = false
  for (const p of profiles) {
    if (!existsSync(p)) continue
    try {
      const original = readFileSync(p, 'utf8')
      // match the exact line the installer adds, with or without trailing comment
      const updated = original
        .split('\n')
        .filter(line => !line.includes(BIN_DIR) || !line.includes('mydbtest'))
        .join('\n')
      if (updated !== original) {
        writeFileSync(p, updated, 'utf8')
        status('ok', `removed path entry from ${p}`)
        removed = true
      }
    } catch {}
  }
  return removed
}

export async function runUninstall() {
  console.log()

  const first = await menu('Do you want to uninstall MyDBTest?', [
    'Yes, uninstall',
    'Cancel',
  ])
  if (first !== 0) {
    console.log(dim('\n  //  Cancelled.\n'))
    return
  }

  console.log()
  status('info', 'checking what MyDBTest owns')
  console.log()

  const rt          = readRuntimeJson()
  const nodeEntry   = rt.node   || { source: 'none' }
  const pythonEntry = rt.python || { source: 'none' }

  const toDelete = []
  const toSkip   = []
  const hints    = []

  toDelete.push(`application files  (${MYDBTEST_DIR})`)

  const histFile = join(MYDBTEST_DIR, 'history.json')
  if (existsSync(histFile)) {
    toDelete.push(`connection history  (${histFile})`)
  }

  const nodeDir = join(MYDBTEST_DIR, 'runtimes', 'node')
  if (nodeEntry.source === 'private') {
    toDelete.push(`private node runtime  (${nodeDir})`)
  } else if (nodeEntry.source === 'system-existing' && nodeEntry.version) {
    toSkip.push(`node ${nodeEntry.version}  (was already installed before mydbtest)`)
  } else if (nodeEntry.source === 'system-installed-by-tool' && nodeEntry.version) {
    toSkip.push(`node ${nodeEntry.version}  (system-wide install — not removed automatically)`)
    hints.push({ runtime: 'node', version: nodeEntry.version })
  }

  const pyDir = join(MYDBTEST_DIR, 'runtimes', 'python')
  if (pythonEntry.source === 'private') {
    toDelete.push(`private python runtime  (${pyDir})`)
  } else if (pythonEntry.source === 'system-existing' && pythonEntry.version) {
    toSkip.push(`python ${pythonEntry.version}  (was already installed before mydbtest)`)
  } else if (pythonEntry.source === 'system-installed-by-tool' && pythonEntry.version) {
    toSkip.push(`python ${pythonEntry.version}  (system-wide install — not removed automatically)`)
    hints.push({ runtime: 'python', version: pythonEntry.version })
  }

  const wrapperPath = platform() === 'win32'
    ? WIN_SCRIPT_DIRS.map(d => join(d, WIN_WRAPPER)).find(p => existsSync(p)) || null
    : UNIX_BIN
  if (wrapperPath && existsSync(wrapperPath)) {
    toDelete.push(`mydbtest command  (${wrapperPath})`)
  }

  toDelete.push('PATH entry in shell profiles  (.bashrc / .zshrc / fish)')

  console.log('  will be removed:')
  toDelete.forEach(l => console.log(green('     ' + l)))

  if (toSkip.length > 0) {
    console.log()
    console.log('  will not be removed:')
    toSkip.forEach(l => console.log(dim('     ' + l)))
  }

  console.log()

  const go = await menu('Continue?', [
    'Yes, delete everything listed above',
    'Cancel',
  ])
  if (go !== 0) {
    console.log(dim('\n  //  Cancelled.\n'))
    return
  }

  console.log()
  status('run', 'uninstalling mydbtest')
  console.log()

  if (safeRemove(histFile)) {
    status('ok', 'removed connection history')
  }

  if (nodeEntry.source === 'private') {
    if (safeRemove(nodeDir)) status('ok', 'removed private node runtime')
  } else if (nodeEntry.source === 'system-existing') {
    status('skip', `node ${nodeEntry.version} was already installed before mydbtest — not removed`)
  } else if (nodeEntry.source === 'system-installed-by-tool') {
    status('warn', `node ${nodeEntry.version} was installed system-wide — not removed automatically`)
  }

  if (pythonEntry.source === 'private') {
    if (safeRemove(pyDir)) status('ok', 'removed private python runtime')
  } else if (pythonEntry.source === 'system-existing') {
    status('skip', `python ${pythonEntry.version} was already installed before mydbtest — not removed`)
  } else if (pythonEntry.source === 'system-installed-by-tool') {
    status('warn', `python ${pythonEntry.version} was installed system-wide — not removed automatically`)
  }

  if (platform() === 'win32') {
    WIN_SCRIPT_DIRS.forEach(dir => {
      if (safeRemove(join(dir, WIN_WRAPPER))) {
        status('ok', `removed mydbtest command from ${dir}`)
      }
    })
  } else {
    if (safeRemove(UNIX_BIN)) status('ok', 'removed mydbtest command from path')
    // remove the PATH line the installer wrote to shell profiles so the user
    // doesn't get "no such file or directory" every time they open a new terminal
    removePathLineFromShellProfiles()
  }

  // can't delete our own parent directory while we're running inside it 🥀
  // hand off to a tiny script that sleeps 1s and then does the actual rm -rf
  if (platform() === 'win32') {
    const bat = join(tmpdir(), 'mydbtest-cleanup.bat')
    writeFileSync(bat, [
      '@echo off',
      'ping -n 2 127.0.0.1 >nul',
      `rmdir /s /q "${MYDBTEST_DIR}"`,
      `del /f /q "${bat}"`,
    ].join('\r\n'))
    try { execSync(`start "" /b cmd /c "${bat}"`) } catch {}
  } else {
    const sh = join(tmpdir(), 'mydbtest-cleanup.sh')
    writeFileSync(sh, [
      '#!/bin/bash',
      'sleep 1',
      `rm -rf "${MYDBTEST_DIR}"`,
      `rm -f "${sh}"`,
    ].join('\n'))
    try {
      execSync(`chmod +x "${sh}"`)
      execSync(`nohup "${sh}" > /dev/null 2>&1 &`)
    } catch {}
  }

  status('ok', 'removed application files')

  if (hints.length > 0) {
    console.log()
    hints.forEach(({ runtime, version }) => {
      const hint = pkgManagerHint(runtime)
      const name = runtime === 'node' ? `node ${version}` : `python ${version}`
      if (hint) console.log(dim(`  to remove ${name}: ${hint}`))
    })
  }

  console.log()
  status('ok', 'mydbtest uninstalled')
  console.log()
  process.exit(0)
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
