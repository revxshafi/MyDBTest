/**
 * @project     MyDBTest
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import { execSync, spawnSync } from 'child_process'
import { statusLine, dim } from './ui.js'

export function detectOS() {
  switch (process.platform) {
    case 'win32':  return 'windows'
    case 'darwin': return 'macos'
    default:       return 'linux'
  }
}

export function getNodeMajorVersion() {
  return parseInt(process.versions.node.split('.')[0], 10)
}

// tries python3 first, then python as a fallback for envs that alias it
export function getPythonVersion() {
  for (const bin of ['python3', 'python']) {
    const result = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    if (result.status === 0) {
      const raw = (result.stdout || result.stderr || '').trim()
      return raw.replace('Python ', '')
    }
  }
  return null
}

export function commandExists(cmd) {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`
    execSync(check, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function installNpmPackage(pkg) {
  try {
    // --no-save so drivers don't get written into package.json
    execSync(`npm install ${pkg} --no-save`, { stdio: 'inherit', timeout: 30000 })
  } catch (e) {
    process.stderr.write('\r\x1b[2K')
    if (e.killed) {
      process.stderr.write(statusLine('fail', 'driver install timed out after 30s.') + '\n')
    } else if (e.code === 'ENOENT' || (e.message && e.message.includes('npm: not found'))) {
      process.stderr.write(statusLine('fail', 'npm not found on PATH.') + '\n')
      process.stderr.write(dim('  make sure npm is on your PATH and try again.') + '\n')
    } else {
      process.stderr.write(statusLine('fail', `driver install failed: ${e.message}`) + '\n')
    }
    process.stderr.write(dim(`  run manually: npm install ${pkg}`) + '\n')
    process.exit(1)
  }
}

export function installPipPackage(pkg) {
  try {
    execSync(`pip3 install ${pkg} --quiet`, { stdio: 'inherit', timeout: 30000 })
  } catch (e) {
    process.stderr.write('\r\x1b[2K')
    if (e.killed) {
      process.stderr.write(statusLine('fail', 'driver install timed out after 30s.') + '\n')
    } else {
      process.stderr.write(statusLine('fail', `driver install failed: ${e.message}`) + '\n')
    }
    process.stderr.write(dim(`  run manually: pip install ${pkg}`) + '\n')
    process.exit(1)
  }
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
