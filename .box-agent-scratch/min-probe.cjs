// 最小复现：只创建窗口，观察是否也会在 ~30s 内被关闭
const { app, BrowserWindow } = require('electron')
const t0 = Date.now()
const log = (...a) => console.log(`[min +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

app.whenReady().then(() => {
  log('ready')
  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.on('close', () => log('window close'))
  win.on('closed', () => log('window closed'))
  win.on('hide', () => log('window hide'))
  win.once('ready-to-show', () => { log('ready-to-show'); win.show(); log('shown, visible=' + win.isVisible()) })
  setTimeout(() => log('t+5s visible=' + win.isVisible() + ' destroyed=' + win.isDestroyed()), 5000)
  win.loadURL('data:text/html,<h1>probe</h1>')
})

app.on('window-all-closed', () => log('window-all-closed'))
app.on('before-quit', () => log('before-quit'))
process.on('uncaughtException', (e) => log('uncaught', e && e.stack))
