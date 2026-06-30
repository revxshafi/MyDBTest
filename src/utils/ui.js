/**
 * @project     MyDBTest
 *
 * @author      Reversal
 * @contributor Resilience
 * @license     MIT
 * @github      https://github.com/revxshafi/MyDBTest
 */

import readline from 'readline'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
}

export function green(t)  { return `${C.green}${t}${C.reset}` }
export function red(t)    { return `${C.red}${t}${C.reset}` }
export function yellow(t) { return `${C.yellow}${t}${C.reset}` }
export function cyan(t)   { return `${C.cyan}${t}${C.reset}` }
export function dim(t)    { return `${C.dim}${t}${C.reset}` }
export function bold(t)   { return `${C.bold}${t}${C.reset}` }

// structured status lines, fixed-width tag column on the left so everything
// aligns down the page. colour goes on the tag content only, body stays plain.
const STATUS = {
  ok:   { label: 'OK',   colour: green  },
  warn: { label: 'WARN', colour: yellow },
  fail: { label: 'FAIL', colour: red    },
  run:  { label: '>>',   colour: cyan   },
  info: { label: 'INFO', colour: dim    },
  skip: { label: '--',   colour: dim    },
}

export function statusLine(kind, msg = '') {
  const s   = STATUS[kind] || STATUS.info
  const pad = Math.max(0, 6 - s.label.length)
  const left  = ' '.repeat(Math.floor(pad / 2))
  const right = ' '.repeat(Math.ceil(pad / 2))
  return `  [${s.colour(left + s.label + right)}] ${msg}`
}

export function status(kind, msg = '') {
  console.log(statusLine(kind, msg))
}

export function printBanner() {
  console.log(cyan('\n  ─────────────────────────────────────────────'))
  console.log(cyan(''))
  console.log(cyan('    ___  ___     ____________ _____         _   '))
  console.log(cyan('    |  \\/  |     |  _  \\ ___ \\_   _|       | |  '))
  console.log(cyan('    | .  . |_   _| | | | |_/ / | | ___  ___| |_ '))
  console.log(cyan('    | |\\/| | | | | | | | ___ \\ | |/ _ \\/ __| __|'))
  console.log(cyan('    | |  | | |_| | |/ /| |_/ / | |  __/\\__ \\ |_ '))
  console.log(cyan('    \\_|  |_/\\__, |___/ \\____/  \\_/\\___||___/\\__|'))
  console.log(cyan('             __/ |'))
  console.log(cyan('            |___/'))
  console.log(cyan(''))
  console.log(dim(`    MyDBTest  —  Database connection & operation tester  —  v${version}`))
  console.log(cyan('\n  ─────────────────────────────────────────────\n'))
}

// \r rewrites look broken in piped output, plain static line for non-TTY
export function spinner(label) {
  if (process.env.MYDBTEST_JSON === '1') {
    return { stop() {} }
  }
  if (!process.stdout.isTTY) {
    process.stdout.write(`  ${label}\n`)
    return { stop(finalMsg) { if (finalMsg) console.log(finalMsg) } }
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const id = setInterval(() => {
    process.stdout.write(`\r  ${cyan(frames[i++ % frames.length])}  ${label}`)
  }, 80)

  return {
    stop(finalMsg) {
      clearInterval(id)
      process.stdout.write('\r\x1b[2K')
      if (finalMsg) console.log(finalMsg)
    }
  }
}

export function countdown(label, seconds) {
  return new Promise(resolve => {
    if (process.env.MYDBTEST_JSON === '1') { resolve(); return }
    if (!process.stdout.isTTY) {
      console.log(`  ${label}`)
      setTimeout(resolve, seconds * 1000)
      return
    }

    let remaining = seconds
    const write = () => {
      process.stdout.write(`\r  ${cyan('v')}  ${label} ${dim(`(${remaining}s)`)}  `)
    }
    write()
    const id = setInterval(() => {
      remaining--
      write()
      if (remaining <= 0) {
        clearInterval(id)
        process.stdout.write('\r\x1b[2K')
        resolve()
      }
    }, 1000)
  })
}

// raw mode keypress so the user doesn't have to hit Enter.
// ESC => exit. falls back to readline when stdin isn't a TTY.
export function menu(prompt, options) {
  return new Promise((resolve, reject) => {
    console.log(`\n  ${bold(prompt)}\n`)
    options.forEach((opt, i) => {
      console.log(`    ${cyan(`# ${i + 1}.`)}  ${opt}`)
    })
    console.log(dim('\n  // Press a number key to select. Press Escape to quit.\n'))

    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      rl.question('  Selection: ', answer => {
        rl.close()
        const n = parseInt(answer.trim(), 10)
        if (!isNaN(n) && n >= 1 && n <= options.length) {
          console.log(`  ${dim('>')}  ${options[n - 1]}\n`)
          resolve(n - 1)
        } else {
          // don't silently default => that could kick off a real test run in CI
          process.stderr.write(
            statusLine('fail', 'Invalid selection in non-TTY mode. Use --json for scripted runs.') + '\n'
          )
          process.exit(1)
        }
      })
      return
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const handler = (key) => {
      if (key === '') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        console.log(dim('\n  Goodbye.\n'))
        process.exit(0)
      }
      // raw mode swallows SIGINT, so handle ctrl+c by hand or it hangs the menu
      if (key === '') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        console.log(dim('\n  Interrupted.\n'))
        process.exit(0)
      }

      const n = parseInt(key, 10)
      if (!isNaN(n) && n >= 1 && n <= options.length) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', handler)
        console.log(`  ${dim('>')}  ${options[n - 1]}\n`)
        resolve(n - 1)
      }
    }

    process.stdin.on('data', handler)
  })
}

export function ask(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`  ${cyan('>')}  ${prompt}: `, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function step(n, total, label) {
  status('run', `${dim(`[${String(n).padStart(2, '0')}/${total}]`)}  ${label}`)
}

export function printResults(results) {
  console.log()
  results.forEach(r => {
    const note = r.note ? `  ${dim(r.note)}` : ''
    status(r.ok ? 'ok' : 'fail', `${r.label}${note}`)
  })

  const passed = results.filter(r => r.ok).length
  const total  = results.length

  console.log()
  if (passed === total) {
    status('ok', `${bold(`${passed}/${total} passed`)}${dim('  ·  healthy')}`)
  } else {
    status('fail', `${bold(`${passed}/${total} passed`)}${dim(`  ·  ${total - passed} failed`)}`)
  }
  console.log()
}

/**
 * Copyright (c) 2026 Reversal & Resilience
 * Licensed under the MIT License.
 */
