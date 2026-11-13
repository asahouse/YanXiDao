import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('Electron desktop app launches embedded server, renders main window, and blocks non-http(s) external links', async () => {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxd-pw-electron-'))
  const electronApp = await electron.launch({
    args: [path.resolve(process.cwd(), 'electron/main.cjs')],
    env: {
      ...process.env,
      PORT: '3095',
      YANXIDAO_DATA_DIR: tmpDataDir,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))

    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('#app')).not.toBeEmpty({ timeout: 15_000 })

    // Verify embedded server is healthy
    const health = await page.evaluate(async () => {
      const r = await fetch('/api/health')
      return { ok: r.ok, status: r.status }
    })
    expect(health.ok).toBe(true)
    expect(health.status).toBe(200)

    // Verify window.open with non-http protocol is denied (only 1 window remains)
    await page.evaluate(() => {
      window.open('file:///C:/Windows/System32/calc.exe', '_blank')
    })
    expect(electronApp.windows()).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await electronApp.close()
    try {
      fs.rmSync(tmpDataDir, { recursive: true, force: true })
    } catch {}
  }
})
