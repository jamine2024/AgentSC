// 临时诊断脚本：加载正式 main.js，并额外记录窗口/退出相关事件
const { app, BrowserWindow } = require('electron')

const t0 = Date.now()
const log = (...a) => console.log(`[probe +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

require('../out/main/main.js')

app.on('browser-window-created', (_e, win) => {
  log('window created')
  win.on('close', () => log('window close'))
  win.on('closed', () => log('window closed'))
  win.on('hide', () => log('window hide'))
  win.on('show', () => log('window show'))
  win.webContents.on('render-process-gone', (_e2, d) => log('render-process-gone', JSON.stringify(d)))
  win.webContents.on('unresponsive', () => log('renderer unresponsive'))
})

app.on('window-all-closed', () => log('window-all-closed'))
app.on('before-quit', () => log('before-quit'))
app.on('will-quit', () => log('will-quit'))
app.on('quit', (_e, code) => console.log(`[probe] quit code=${code}`))
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack))
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e)))
