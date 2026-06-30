/**
 * @project     MyDBTest
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import { homedir, platform, arch, tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync,
} from 'fs'
import { execSync, spawnSync } from 'child_process'
import { get } from 'https'
import { menu, status, green, red, yellow, cyan, dim } from './ui.js'

export const MYDBTEST_DIR = process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'mydbtest')
  : join(homedir(), '.mydbtest')

export const RUNTIME_JSON = join(MYDBTEST_DIR, 'runtime.json')
export const RUNTIMES_DIR = join(MYDBTEST_DIR, 'runtimes')

// current LTS, installs v22 by default, minimum required is v20
const DEFAULT_NODE_MAJOR = '22'

const ISSUES_URL = 'https://github.com/revxshafi/MyDBTest/issues'

export function readRuntimeJson() {
  // missing file is fine, treat it as everything being "none"
  try {
    if (!existsSync(RUNTIME_JSON)) return { node: { source: 'none' }, python: { source: 'none' } }
    return JSON.parse(readFileSync(RUNTIME_JSON, 'utf8'))
  } catch {
    return { node: { source: 'none' }, python: { source: 'none' } }
  }
}

export function writeRuntimeJson(data) {
  mkdirSync(MYDBTEST_DIR, { recursive: true })
  writeFileSync(RUNTIME_JSON, JSON.stringify(data, null, 2), 'utf8')
}

export function patchRuntime(field, entry) {
  const data = readRuntimeJson()
  data[field] = entry
  writeRuntimeJson(data)
}

// curl first, wget as fallback, no pure-JS stream here
function downloadFile(url, dest) {
  if (spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0) {
    const r = spawnSync('curl', ['-fsSL', '-o', dest, '--progress-bar', url], {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 120000,
    })
    if (r.status !== 0) throw new Error('curl download failed')
    return
  }
  if (spawnSync('wget', ['--version'], { stdio: 'ignore' }).status === 0) {
    const r = spawnSync('wget', ['-q', '--show-progress', '-O', dest, url], {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 120000,
    })
    if (r.status !== 0) throw new Error('wget download failed')
    return
  }
  throw new Error('Neither curl nor wget found — cannot download')
}

function extractArchive(file, dest, ext) {
  mkdirSync(dest, { recursive: true })
  if (ext === 'zip') {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$t=(New-TemporaryFile).FullName; Remove-Item $t; New-Item -Type Directory $t | Out-Null; ` +
        `Expand-Archive -LiteralPath '${file}' -DestinationPath $t -Force; ` +
        `Get-ChildItem $t | Select-Object -First 1 | ForEach-Object { ` +
        `Get-ChildItem $_.FullName | ForEach-Object { Move-Item $_.FullName '${dest}' -Force } }`,
      ], { stdio: 'inherit', timeout: 120000 })
      if (r.status !== 0) throw new Error('Zip extraction failed')
    } else {
      const r = spawnSync('unzip', ['-q', '-o', file, '-d', dest], { stdio: 'inherit', timeout: 120000 })
      if (r.status !== 0) throw new Error('Zip extraction failed')
    }
  } else {
    // --strip-components=1 unwraps the node-vX.Y.Z-os-arch/ top directory
    const r = spawnSync('tar', ['-xf', file, '-C', dest, '--strip-components=1'], {
      stdio: 'inherit',
      timeout: 120000,
    })
    if (r.status !== 0) throw new Error('Tar extraction failed')
  }
}

async function fetchLatestNodeVersion(major) {
  return new Promise((resolve_v, reject) => {
    const req = get('https://nodejs.org/dist/index.json', { timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        try {
          const releases = JSON.parse(data)
          const latest   = releases.find(r => r.version.startsWith(`v${major}.`))
          resolve_v(latest?.version || `v${major}.0.0`)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => reject(new Error('Timed out fetching Node.js release info')))
  })
}

async function installNodePrivate() {
  const os  = platform()
  const cpu = arch()

  const spin = status('run', `fetching latest node v${DEFAULT_NODE_MAJOR} release info`)
  let version
  try {
    version = await fetchLatestNodeVersion(DEFAULT_NODE_MAJOR)
  } catch {
    version = `v${DEFAULT_NODE_MAJOR}.0.0`
  }

  const nodeOs  = os === 'win32' ? 'win' : os === 'darwin' ? 'darwin' : 'linux'
  // os.arch() already normalises aarch64 => arm64 on Linux/macOS, so this is correct for Termux too
  const nodeCpu = cpu === 'arm64' ? 'arm64' : 'x64'
  const ext     = os === 'win32' ? 'zip' : os === 'linux' ? 'tar.xz' : 'tar.gz'
  const filename = `node-${version}-${nodeOs}-${nodeCpu}.${ext}`
  const url      = `https://nodejs.org/dist/${version}/${filename}`

  const nodeDir     = join(RUNTIMES_DIR, 'node')
  const resolvedDir = resolve(nodeDir)
  const tmpFile     = join(tmpdir(), filename)

  status('run', `downloading node ${version}  ${nodeOs}-${nodeCpu}`)

  try {
    downloadFile(url, tmpFile)
  } catch (e) {
    // clean up any partial download so we don't leave a corrupt file lying around
    try { unlinkSync(tmpFile) } catch {}
    status('fail', `download failed: ${e.message}`)
    console.log(dim('  check your internet connection and try again'))
    console.log(dim('  to retry: mydbtest --private-node'))
    return { ok: false }
  }

  status('run', 'extracting runtime')
  try {
    extractArchive(tmpFile, resolvedDir, ext)
  } catch (e) {
    try { unlinkSync(tmpFile) } catch {}
    // partial extraction dir could be left behind, remove it so the next attempt is clean
    try { rmSync(resolvedDir, { recursive: true, force: true }) } catch {}
    status('fail', `extraction failed: ${e.message}`)
    console.log(dim('  to retry: mydbtest --private-node'))
    return { ok: false }
  }

  try { unlinkSync(tmpFile) } catch {}

  const binPath = os === 'win32'
    ? join(resolvedDir, 'node.exe')
    : join(resolvedDir, 'bin', 'node')

  patchRuntime('node', { source: 'private', version: version.replace('v', ''), path: binPath })
  status('ok', `node ${version} installed`)
  console.log(dim(`  binary: ${binPath}`))
  return { ok: true, bin: binPath }
}

function installNodeSystem() {
  const os = platform()
  let cmd

  if (os === 'darwin') {
    cmd = 'brew install node'
  } else if (os === 'win32') {
    cmd = 'winget install OpenJS.NodeJS.LTS -e --source winget'
  } else {
    if (spawnSync('apt-get', ['--version'], { stdio: 'ignore' }).status === 0) {
      // sudo is required for system-wide install, this is the expected path
      cmd = `curl -fsSL https://deb.nodesource.com/setup_${DEFAULT_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs`
    } else if (spawnSync('dnf', ['--version'], { stdio: 'ignore' }).status === 0) {
      cmd = `sudo dnf module install -y nodejs:${DEFAULT_NODE_MAJOR}`
    } else {
      cmd = null
    }
  }

  if (!cmd) {
    status('fail', 'could not detect a supported package manager for system-wide install')
    console.log(dim('  visit https://nodejs.org to install manually'))
    return { ok: false }
  }

  status('run', 'installing node system-wide')
  console.log(dim(`  command: ${cmd}`))
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 180000 })
  } catch (e) {
    status('fail', `system install failed: ${e.message}`)
    return { ok: false }
  }

  const r   = spawnSync('node', ['--version'], { encoding: 'utf8' })
  const ver = r.status === 0 ? (r.stdout || '').trim().replace('v', '') : 'unknown'
  patchRuntime('node', { source: 'system-installed-by-tool', version: ver, path: null })
  status('ok', 'node installed system-wide')
  return { ok: true, bin: 'node' }
}

async function installPythonPrivate() {
  const os  = platform()
  const cpu = arch()

  const PY_VERSION  = '3.12.9'
  const RELEASE_TAG = '20250529'
  // os.arch() returns arm64 on Apple Silicon and arm64 Linux, x64 elsewhere
  const cpuTag = cpu === 'arm64' ? 'aarch64' : 'x86_64'

  let filename
  if (os === 'darwin') {
    filename = `cpython-${PY_VERSION}+${RELEASE_TAG}-${cpuTag}-apple-darwin-install_only_stripped.tar.gz`
  } else if (os === 'win32') {
    filename = `cpython-${PY_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
  } else {
    filename = `cpython-${PY_VERSION}+${RELEASE_TAG}-${cpuTag}-unknown-linux-gnu-install_only_stripped.tar.gz`
  }

  const url = `https://github.com/indygreg/python-build-standalone/releases/download/${RELEASE_TAG}/${filename}`

  const pyDir       = join(RUNTIMES_DIR, 'python')
  const resolvedDir = resolve(pyDir)
  const tmpFile     = join(tmpdir(), filename)

  status('run', `downloading python ${PY_VERSION}`)

  try {
    downloadFile(url, tmpFile)
  } catch (e) {
    try { unlinkSync(tmpFile) } catch {}
    status('fail', `download failed: ${e.message}`)
    console.log(dim('  check your internet connection and try again'))
    console.log(dim('  to retry: mydbtest --private-python'))
    return { ok: false }
  }

  status('run', 'extracting runtime')
  try {
    mkdirSync(resolvedDir, { recursive: true })
    // python-build-standalone is nested two levels: archive → python/ → install/...
    // strip=2 lands us at the install root where bin/ lives 🥀
    const r = spawnSync('tar', ['-xf', tmpFile, '-C', resolvedDir, '--strip-components=2'], {
      stdio: 'inherit', timeout: 120000,
    })
    if (r.status !== 0) throw new Error('tar failed')
  } catch (e) {
    try { unlinkSync(tmpFile) } catch {}
    try { rmSync(resolvedDir, { recursive: true, force: true }) } catch {}
    status('fail', `extraction failed: ${e.message}`)
    console.log(dim('  to retry: mydbtest --private-python'))
    return { ok: false }
  }

  try { unlinkSync(tmpFile) } catch {}

  const binPath = os === 'win32'
    ? join(resolvedDir, 'python.exe')
    : join(resolvedDir, 'bin', 'python3')

  patchRuntime('python', { source: 'private', version: PY_VERSION, path: binPath })
  status('ok', `python ${PY_VERSION} installed`)
  console.log(dim(`  binary: ${binPath}`))
  return { ok: true, bin: binPath }
}

function installPythonSystem() {
  const os = platform()

  if (os === 'darwin') {
    status('run', 'installing python system-wide via brew')
    try {
      execSync('brew install python3', { stdio: 'inherit', timeout: 180000 })
    } catch (e) {
      status('fail', `brew install failed: ${e.message}`)
      return { ok: false }
    }
  } else if (os === 'win32') {
    console.log(dim('  windows python install requires a terminal restart to take effect'))
    status('info', 'visit https://www.python.org/downloads/ and install python 3.8+')
    patchRuntime('python', { source: 'system-installed-by-tool', version: 'unknown', path: null })
    return { ok: false }
  } else {
    let cmd = null
    if (spawnSync('apt-get', ['--version'], { stdio: 'ignore' }).status === 0) {
      cmd = 'sudo apt-get install -y python3'
    } else if (spawnSync('dnf', ['--version'], { stdio: 'ignore' }).status === 0) {
      cmd = 'sudo dnf install -y python3'
    } else if (spawnSync('pacman', ['--version'], { stdio: 'ignore' }).status === 0) {
      cmd = 'sudo pacman -S --noconfirm python'
    }
    if (!cmd) {
      status('fail', 'could not detect a package manager, install python 3.8+ manually')
      return { ok: false }
    }
    status('run', 'installing python system-wide')
    console.log(dim(`  command: ${cmd}`))
    try {
      execSync(cmd, { stdio: 'inherit', timeout: 180000 })
    } catch (e) {
      status('fail', `system install failed: ${e.message}`)
      return { ok: false }
    }
  }

  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) {
      const ver = (r.stdout || r.stderr || '').trim().replace('Python ', '')
      patchRuntime('python', { source: 'system-installed-by-tool', version: ver, path: null })
      status('ok', `python ${ver} installed system-wide`)
      return { ok: true, bin }
    }
  }

  return { ok: false }
}

/**
 * Checks that Node.js is available and meets the version minimum.
 * Shows an install prompt (private into ~/.mydbtest/runtimes/, or system-wide)
 * when it isn't. Pass `flag` to skip the prompt for CI/scripted use.
 *
 * @param {{ flag?: string | null }} [opts]
 * @returns {Promise<{ ok: boolean, bin?: string }>}
 */
export async function detectAndEnsureNode({ flag } = {}) {
  const rt = readRuntimeJson()

  // 1. private install from a previous run, verify the binary is still there
  if (rt.node?.source === 'private' && rt.node?.path) {
    if (existsSync(rt.node.path)) {
      status('ok', `node v${rt.node.version} detected` + dim('  (private)'))
      return { ok: true, bin: rt.node.path }
    }
    // path is gone, fall through and re-detect
  }

  // 2. system node
  const sys = spawnSync('node', ['--version'], { encoding: 'utf8' })
  if (sys.status === 0) {
    const raw   = (sys.stdout || '').trim().replace('v', '')
    const major = parseInt(raw.split('.')[0], 10) || 0
    if (major >= 20) {
      patchRuntime('node', { source: 'system-existing', version: raw, path: null })
      status('ok', `node v${raw} detected`)
      return { ok: true, bin: 'node' }
    }
    status('warn', `node v${major} found — v20 or higher is required`)
  } else {
    status('skip', 'node not found on PATH')
  }

  // 3. non-interactive flags skip the prompt
  if (flag === '--yes' || flag === '--private-node') return installNodePrivate()
  if (flag === '--system-node')                       return installNodeSystem()

  // 4. interactive
  console.log()
  const choice = await menu('node v20 or higher is required.', [
    'Install private runtime (recommended) — removed automatically on uninstall',
    'Install system-wide — MyDBTest will not remove it on uninstall',
    'Cancel',
  ])

  if (choice === 0) return installNodePrivate()
  if (choice === 1) return installNodeSystem()

  status('skip', 'continuing without node, javascript tests will not be available')
  patchRuntime('node', { source: 'none', version: null, path: null })
  return { ok: false }
}

/**
 * Same as detectAndEnsureNode but for Python.
 * Only call this when the user has actually chosen the Python path.
 *
 * @param {{ flag?: string | null }} [opts]
 * @returns {Promise<{ ok: boolean, bin?: string }>}
 */
export async function detectAndEnsurePython({ flag } = {}) {
  const rt = readRuntimeJson()

  // 1. private install
  if (rt.python?.source === 'private' && rt.python?.path) {
    if (existsSync(rt.python.path)) {
      status('ok', `python ${rt.python.version} detected` + dim('  (private)'))
      return { ok: true, bin: rt.python.path }
    }
  }

  // 2. system python
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) {
      const raw = (r.stdout || r.stderr || '').trim().replace('Python ', '')
      const parts = raw.split('.')
      const maj = parseInt(parts[0], 10) || 0
      const min = parseInt(parts[1], 10) || 0
      // maj > 3 handles a hypothetical python 4, (maj === 3 && min >= 8) handles 3.8+
      if (maj > 3 || (maj === 3 && min >= 8)) {
        patchRuntime('python', { source: 'system-existing', version: raw, path: null })
        status('ok', `python ${raw} detected`)
        return { ok: true, bin }
      }
      status('warn', `python ${raw} found — v3.8 or higher is required`)
      break
    }
  }

  // 3. non-interactive
  if (flag === '--yes' || flag === '--private-python') return installPythonPrivate()
  if (flag === '--system-python')                       return installPythonSystem()

  // 4. interactive
  console.log()
  const choice = await menu('python 3.8 or higher is not installed.', [
    'Install private runtime (recommended) — removed automatically on uninstall',
    'Install system-wide — MyDBTest will not remove it on uninstall',
    'Cancel',
  ])

  if (choice === 0) return installPythonPrivate()
  if (choice === 1) return installPythonSystem()

  status('skip', 'continuing without python, python tests will not be available')
  patchRuntime('python', { source: 'none', version: null, path: null })
  return { ok: false }
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
