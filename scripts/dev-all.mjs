#!/usr/bin/env node
// `pnpm dev:all`: the whole local stack in one terminal, with every line labelled by the process
// that printed it.
//
//   1. Docker: starts Docker Desktop if the daemon isn't up (Windows and macOS) and waits for it.
//   2. [db] local Supabase (`supabase start`, idempotent: a running stack is left as it is).
//   3. [web] Next.js, [ext] the WXT extension (both with HMR), and [stripe] `stripe listen`
//      forwarding webhooks to the local web app. Stripe is skipped with a hint when its CLI isn't
//      installed; the web app still runs, but local checkouts won't update the plan.
//
// Ctrl+C stops web, ext and stripe. Supabase keeps running so the next start is instant and its
// data stays put; `pnpm exec supabase stop` stops it.
//
// Not Docker Compose on purpose: on Windows, file changes in a bind mount don't reach a Linux
// container as change events (HMR falls back to slow polling), and `wxt` opens a desktop Chrome
// with the dev extension loaded, which a container can't do.

import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const IS_WINDOWS = process.platform === 'win32'
const DOCKER_WAIT_MS = 180_000
const DOCKER_POLL_MS = 2_000
const SUPABASE_ATTEMPTS = 10
const SUPABASE_RETRY_MS = 5_000

const COLORS = { dev: 90, db: 32, web: 36, ext: 35, stripe: 33 }
const LABEL_WIDTH = Math.max(...Object.keys(COLORS).map((name) => name.length))

/** The long-running processes, started once the database is up. */
export const PROCESSES = [
  { name: 'web', command: 'pnpm', args: ['--filter', '@tabmerger/web', 'dev'] },
  { name: 'ext', command: 'pnpm', args: ['--filter', '@tabmerger/extension', 'dev'] },
  {
    name: 'stripe',
    command: 'stripe',
    args: ['listen', '--forward-to', 'localhost:3000/api/webhooks/stripe'],
    optional: true,
    missingHint:
      'Stripe CLI not found, so webhooks are not forwarded (local checkouts will not update the plan). Install it from https://docs.stripe.com/stripe-cli and run `stripe login`.',
  },
]

/**
 * How to start Docker Desktop on this platform, or null where it can't be started for you
 * (Linux: the daemon is a system service).
 *
 * @param {NodeJS.Platform} platform
 * @param {Record<string, string | undefined>} env
 * @returns {{ command: string, args: string[] } | null}
 */
export function dockerDesktopLauncher(platform, env) {
  if (platform === 'win32') {
    return { command: join(env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'), args: [] }
  }
  if (platform === 'darwin') return { command: 'open', args: ['-a', 'Docker'] }
  return null
}

/**
 * The coloured `[name]` label put before each line a process prints, padded so the output lines up.
 *
 * @param {string} name
 * @returns {string}
 */
export function labelFor(name) {
  const color = COLORS[name] ?? 0
  return `\x1b[${color}m[${name.padEnd(LABEL_WIDTH)}]\x1b[0m `
}

function log(name, message) {
  process.stdout.write(`${labelFor(name)}${message}\n`)
}

/**
 * Windows needs a shell to find `pnpm.cmd` and `stripe.exe` on the PATH, and Node deprecates
 * passing an args array alongside `shell: true` (DEP0190), so there the command goes as one string.
 * Every argument here is a fixed literal, so nothing needs escaping.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} isWindows
 * @returns {[string, string[]]}
 */
export function spawnArgs(command, args, isWindows) {
  return isWindows ? [[command, ...args].join(' '), []] : [command, args]
}

/** Runs a short command quietly and reports whether it succeeded. */
function succeeds(command, args) {
  const result = spawnSync(...spawnArgs(command, args, IS_WINDOWS), { stdio: 'ignore', shell: IS_WINDOWS })
  return !result.error && result.status === 0
}

const running = new Set()
let stopping = false

/**
 * Starts a process with its stdout and stderr labelled line by line. Resolves with its exit code and
 * everything it printed. stdin is closed, so a `.cmd` wrapper's "Terminate batch job?" prompt can't
 * hang on Ctrl+C.
 *
 * @returns {Promise<{ code: number, output: string }>}
 */
function run(name, command, args) {
  return new Promise((resolve) => {
    const lines = []
    const child = spawn(...spawnArgs(command, args, IS_WINDOWS), {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WINDOWS,
      // Its own process group, so stopping it also stops what it started (POSIX).
      detached: !IS_WINDOWS,
      env: { ...process.env, FORCE_COLOR: '1' },
    })
    running.add(child)
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        lines.push(line)
        process.stdout.write(`${labelFor(name)}${line}\n`)
      })
    }
    child.on('error', (err) => log(name, `failed to start: ${err.message}`))
    child.on('close', (code) => {
      running.delete(child)
      if (!stopping && code !== 0) log(name, `exited with code ${code}`)
      resolve({ code: code ?? 1, output: lines.join('\n') })
    })
  })
}

/**
 * Whether `supabase start` failed only because the stack's containers are still coming up. Docker
 * Desktop restarts the previous stack's containers as it starts, so a start right after Docker is
 * up can find the database container `starting` (StatusDbNotReadyError); waiting and retrying works.
 *
 * @param {string} output
 * @returns {boolean}
 */
export function isSupabaseStillStarting(output) {
  return /NotReady|is not ready/i.test(output)
}

async function startSupabase() {
  for (let attempt = 1; ; attempt++) {
    const { code, output } = await run('db', 'pnpm', ['exec', 'supabase', 'start'])
    if (code === 0 || stopping) return code
    if (attempt >= SUPABASE_ATTEMPTS || !isSupabaseStillStarting(output)) return code
    log('db', `containers are still starting, retrying in ${SUPABASE_RETRY_MS / 1000}s (${attempt}/${SUPABASE_ATTEMPTS - 1})`)
    await new Promise((resolve) => setTimeout(resolve, SUPABASE_RETRY_MS))
  }
}

function killTree(child) {
  if (child.pid === undefined) return
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

function stop() {
  if (stopping) return
  stopping = true
  log('dev', 'stopping web, ext and stripe (Supabase keeps running; `pnpm exec supabase stop` stops it)')
  for (const child of running) killTree(child)
  setTimeout(() => process.exit(0), 5_000).unref()
}

async function ensureDocker() {
  if (succeeds('docker', ['info'])) return
  if (!succeeds('docker', ['--version'])) {
    throw new Error('Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/')
  }
  const launcher = dockerDesktopLauncher(process.platform, process.env)
  if (!launcher) throw new Error('The Docker daemon is not running. Start it (e.g. `sudo systemctl start docker`) and retry.')

  log('db', 'starting Docker Desktop…')
  spawn(launcher.command, launcher.args, { detached: true, stdio: 'ignore' }).unref()
  const deadline = Date.now() + DOCKER_WAIT_MS
  while (!succeeds('docker', ['info'])) {
    if (stopping) return
    if (Date.now() > deadline) throw new Error(`Docker did not start within ${DOCKER_WAIT_MS / 1000}s.`)
    await new Promise((resolve) => setTimeout(resolve, DOCKER_POLL_MS))
  }
  log('db', 'Docker is up')
}

async function main() {
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  await ensureDocker()
  if (stopping) return
  log('db', 'starting local Supabase…')
  const supabaseCode = await startSupabase()
  if (stopping) return
  if (supabaseCode !== 0) throw new Error(`supabase start failed (exit code ${supabaseCode}).`)
  log('db', 'Supabase is up: Studio at http://localhost:54323')

  const started = []
  for (const proc of PROCESSES) {
    if (proc.optional && !succeeds(proc.command, ['--version'])) {
      log(proc.name, proc.missingHint)
      continue
    }
    started.push(run(proc.name, proc.command, proc.args))
  }
  log('dev', 'web app at http://localhost:3000. Ctrl+C stops everything but Supabase.')
  await Promise.all(started)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    log('dev', `\x1b[31m${err.message}\x1b[0m`)
    for (const child of running) killTree(child)
    process.exit(1)
  })
}
