const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const http = require('node:http')

let mainWindow = null
let serverProcess = null
const SERVER_PORT = process.env.PORT || 3001
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`

// Ensure single instance of YanXiDao Desktop App
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(`${url}/api/health`, res => {
          if (res.statusCode === 200) {
            resolve()
          } else if (Date.now() - start > timeoutMs) {
            reject(new Error('Server health check timed out'))
          } else {
            setTimeout(check, 250)
          }
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Server failed to start within timeout'))
          } else {
            setTimeout(check, 250)
          }
        })
    }
    check()
  })
}

function startEmbeddedServer() {
  const isPackaged = app.isPackaged
  const projectRoot = path.resolve(__dirname, '..')
  const userDataDir = isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(projectRoot, 'data')

  const serverEntry = path.join(projectRoot, 'dist-server', 'index.mjs')
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(SERVER_PORT),
      YANXIDAO_DATA_DIR: userDataDir,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
}

function stopEmbeddedServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM')
    } catch {}
    serverProcess = null
  }
}

async function createWindow() {
  startEmbeddedServer()
  try {
    await waitForServer(SERVER_URL)
  } catch (err) {
    console.error('Wait for embedded server warning:', err)
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: '研习岛 - 英语精听与打字口语研习平台',
    backgroundColor: '#0b0e17',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(SERVER_URL)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  stopEmbeddedServer()
  app.quit()
})

app.on('before-quit', () => {
  stopEmbeddedServer()
})

process.on('exit', () => {
  stopEmbeddedServer()
})
