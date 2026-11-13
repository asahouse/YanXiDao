import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from '../server/index'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

function findDesktopBrowserExecutable(): string | null {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
  ].filter(Boolean)

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function launchDesktopApp() {
  console.log('====================================================')
  console.log('  研习岛 (YanXiDao) Windows 桌面端启动中...')
  console.log('  架构: 嵌入式 SQLite + 本地内置服务 + 窗口生命周期绑定')
  console.log('====================================================')

  const { port } = await startServer(Number(process.env.PORT || 3001), '127.0.0.1')
  const appUrl = `http://127.0.0.1:${port}`

  const browserExe = findDesktopBrowserExecutable()
  if (!browserExe) {
    console.log(`未检测到 Edge/Chrome，请手动在浏览器访问: ${appUrl}`)
    return
  }

  // Dedicated profile directory ensures the window runs as an isolated desktop process
  // so that closing the window immediately triggers server & SQLite shutdown.
  const profileDir = path.join(PROJECT_ROOT, 'data', 'desktop-shell-profile')
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true })
  }

  const args = [
    `--app=${appUrl}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ]

  console.log(`已打开研习岛桌面窗口 (${appUrl})，关闭窗口将自动停止所有后台服务。`)

  const uiProcess = spawn(browserExe, args, {
    stdio: 'ignore',
    detached: false,
  })

  let shuttingDown = false
  const shutdownAll = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n检测到研习岛窗口已关闭，正在安全关闭本地服务与嵌入式 SQLite 数据库...')
    try {
      await stopServer()
    } catch {}
    console.log('所有相关服务已彻底退出，无后台残留。')
    process.exit(0)
  }

  uiProcess.on('exit', () => {
    shutdownAll()
  })

  process.on('SIGINT', () => {
    try {
      uiProcess.kill()
    } catch {}
    shutdownAll()
  })

  process.on('SIGTERM', () => {
    try {
      uiProcess.kill()
    } catch {}
    shutdownAll()
  })
}

launchDesktopApp().catch(err => {
  console.error('研习岛桌面版启动失败:', err)
  process.exit(1)
})
