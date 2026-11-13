import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 3096
const BASE_URL = `http://127.0.0.1:${PORT}`

let serverProc: ChildProcess | null = null
let tmpDataDir = ''

test.beforeAll(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxd-pw-web-'))
  serverProc = spawn(process.execPath, ['dist-server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), YANXIDAO_DATA_DIR: tmpDataDir },
    stdio: 'ignore',
  })

  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`)
      if (r.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('Test server did not become healthy in time')
})

test.afterAll(async () => {
  if (serverProc) {
    serverProc.kill()
    await new Promise(r => serverProc!.once('exit', r))
  }
  if (tmpDataDir) {
    try {
      fs.rmSync(tmpDataDir, { recursive: true, force: true })
    } catch {}
  }
})

test('Web client renders cleanly without runtime errors and supports demo login + dual-context session kick', async ({ browser }) => {
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  const errors: string[] = []
  pageA.on('pageerror', err => errors.push(err.message))

  await pageA.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await expect(pageA.locator('#app')).not.toBeEmpty()

  // Trigger demo-login via browser API in contextA
  const loginA = await pageA.evaluate(async () => {
    const r = await fetch('/api/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientType: 'web' }),
    })
    const data = await r.json()
    localStorage.setItem('yxd_user_token', data.token)
    return data
  })
  expect(loginA.success).toBe(true)
  await pageA.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })

  // Second web context logs in as same account -> kicks contextA
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await pageB.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  const loginB = await pageB.evaluate(async () => {
    const r = await fetch('/api/auth/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientType: 'web' }),
    })
    return r.json()
  })
  expect(loginB.success).toBe(true)

  // ContextA's old web token must now receive 401 SESSION_KICKED
  const kickedStatus = await pageA.evaluate(async () => {
    const token = localStorage.getItem('yxd_user_token')
    const r = await fetch('/api/user/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await r.json()
    return { status: r.status, code: body.code }
  })
  expect(kickedStatus.status).toBe(401)
  expect(kickedStatus.code).toBe('SESSION_KICKED')
  expect(errors).toEqual([])

  await contextA.close()
  await contextB.close()
})
