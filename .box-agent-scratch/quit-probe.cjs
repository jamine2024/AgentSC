// 临时诊断脚本：先挂监听，再动态 import 正式 main.js（后者是 ESM）
const { app } = require('electron')

const t0 = Date.now()
const log = (...a) => console.log(`[probe +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

app.on('browser-window-created', (_e, win) => {
  log('window created')
  win.on('close', () => log('window close'))
  win.on('closed', () => log('window closed'))
  win.on('hide', () => log('window hide'))
  win.webContents.on('render-process-gone', (_e2, d) => log('render-process-gone', JSON.stringify(d)))
  win.webContents.on('unresponsive', () => log('renderer unresponsive'))
})
app.on('window-all-closed', () => log('window-all-closed'))
app.on('before-quit', () => log('before-quit'))
app.on('will-quit', () => log('will-quit'))
app.on('quit', (_e, code) => console.log(`[probe] quit code=${code}`))
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack))
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e)))

log('loading main.js')
import('file:///E:/X9/OPC项目/AgentSC/out/main/main.js')
  .then(() => log('main.js loaded'))
  .catch((e) => log('main.js load failed', e && e.stack))
