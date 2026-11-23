import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

test('만료된 쿠키로 재등록하면 기존 구독 충돌만 한 번 복구한다', async t => {
  const key = new Uint8Array(65)
  key[0] = 4
  const calls = []
  let errorCode = 'SUBSCRIPTION_CONFLICT'
  const subscription = endpoint => ({
    endpoint,
    options: { applicationServerKey: key.buffer },
    unsubscribe: async () => { calls.push('unsubscribe') },
    toJSON: () => ({ endpoint }),
  })
  const manager = {
    getSubscription: async () => subscription('old'),
    subscribe: async () => { calls.push('subscribe'); return subscription('new') },
  }
  const registration = { pushManager: manager }
  const notification = { requestPermission: async () => 'granted' }
  const globals = {
    Notification: notification,
    window: { Notification: notification, PushManager: {} },
    navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    fetch: async (path, options) => {
      if (path.endsWith('/public-key')) return Response.json({ public_key: Buffer.from(key).toString('base64url') })
      const { endpoint } = JSON.parse(options.body)
      calls.push(endpoint)
      if (endpoint === 'old') return Response.json({ error: { code: errorCode } }, { status: 409 })
      return Response.json({ success: true })
    },
  }
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : Reflect.deleteProperty(globalThis, name))
  }
  const source = await readFile(new URL('../api.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const { enablePush } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
  await enablePush()
  assert.deepEqual(calls, ['old', 'unsubscribe', 'subscribe', 'new'])
  calls.length = 0
  errorCode = 'STATE_CONFLICT'
  await assert.rejects(enablePush, { code: 'STATE_CONFLICT' })
  assert.deepEqual(calls, ['old'])
})
