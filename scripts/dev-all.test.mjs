// Run with: node --test scripts/dev-all.test.mjs
// Covers the pure parts of `pnpm dev:all`; starting Docker, Supabase and the dev servers is
// checked by running it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockerDesktopLauncher, isSupabaseStillStarting, labelFor, PROCESSES, spawnArgs } from './dev-all.mjs'

test('isSupabaseStillStarting: a database container still starting is retried', () => {
  assert.equal(
    isSupabaseStillStarting(
      '{"_tag":"Error","error":{"code":"StatusDbNotReadyError","message":"supabase_db_tabmerger container is not ready: starting"}}'
    ),
    true
  )
})

test('isSupabaseStillStarting: other failures are not retried', () => {
  assert.equal(isSupabaseStillStarting('failed to bind host port 0.0.0.0:54322: address already in use'), false)
  assert.equal(isSupabaseStillStarting('Cannot connect to the Docker daemon'), false)
})

test('spawnArgs: Windows gets one command string and no args array (DEP0190)', () => {
  assert.deepEqual(spawnArgs('pnpm', ['exec', 'supabase', 'start'], true), ['pnpm exec supabase start', []])
})

test('spawnArgs: elsewhere the args stay separate', () => {
  assert.deepEqual(spawnArgs('pnpm', ['exec', 'supabase', 'start'], false), ['pnpm', ['exec', 'supabase', 'start']])
})

test('dockerDesktopLauncher: Windows starts Docker Desktop from Program Files', () => {
  assert.deepEqual(dockerDesktopLauncher('win32', { ProgramFiles: 'D:\\Apps' }), {
    command: 'D:\\Apps\\Docker\\Docker\\Docker Desktop.exe',
    args: [],
  })
})

test('dockerDesktopLauncher: Windows falls back to C:\\Program Files', () => {
  assert.equal(dockerDesktopLauncher('win32', {}).command, 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')
})

test('dockerDesktopLauncher: macOS opens the Docker app', () => {
  assert.deepEqual(dockerDesktopLauncher('darwin', {}), { command: 'open', args: ['-a', 'Docker'] })
})

test('dockerDesktopLauncher: Linux has no launcher (the daemon is a system service)', () => {
  assert.equal(dockerDesktopLauncher('linux', {}), null)
})

test('labelFor: pads every label to the same width', () => {
  const visible = (name) => labelFor(name).replace(/\x1b\[\d+m/g, '')
  const widths = new Set(['db', 'web', 'ext', 'stripe', 'dev'].map((name) => visible(name).length))
  assert.equal(widths.size, 1)
  assert.equal(visible('web'), '[web   ] ')
})

test('labelFor: colours the label and resets after it', () => {
  assert.match(labelFor('web'), /^\x1b\[36m\[web\s*\]\x1b\[0m $/)
})

test('PROCESSES: runs web, ext and stripe, and only stripe is optional', () => {
  assert.deepEqual(
    PROCESSES.map((p) => p.name),
    ['web', 'ext', 'stripe']
  )
  assert.deepEqual(
    PROCESSES.filter((p) => p.optional).map((p) => p.name),
    ['stripe']
  )
})

test('PROCESSES: stripe forwards to the web app webhook route', () => {
  const stripe = PROCESSES.find((p) => p.name === 'stripe')
  assert.deepEqual(stripe.args, ['listen', '--forward-to', 'localhost:3000/api/webhooks/stripe'])
})
