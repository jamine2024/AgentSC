import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@main': path.resolve(__dirname, './src/main'),
    },
  },
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(__dirname, 'src/main/main.ts'),
        // 远程调试端口改用 0（由 Chromium 自动分配空闲端口），避免硬编码 9222 在
        // 多实例/残留进程下触发 WSAEADDRINUSE(0x2740) 与 devtools_http_handler 绑定失败。
        // 内部 webContents.openDevTools() 不受影响；仅外部 CDP 客户端连接端口变为随机。
        onstart: (options) => options.startup(['.', '--remote-debugging-port=0', '--remote-allow-origins=*', '--no-sandbox']),
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: path.resolve(__dirname, 'out/main'),
            rollupOptions: {
              external: ['better-sqlite3', 'chokidar', 'node-schedule', 'node-global-key-listener'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'src/preload/preload.ts'),
        onstart: (options) => options.reload(),
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: path.resolve(__dirname, 'out/preload'),
            lib: {
              entry: path.resolve(__dirname, 'src/preload/preload.ts'),
              formats: ['cjs'],
              // 必须使用 .cjs 扩展名：package.json 含 "type": "module"，
              // 普通 .js 会被 Node 当作 ES module，而 Electron 以 CommonJS 加载 preload，导致报错。
              // 注意：vite-plugin-electron 在 type:module 下默认给 preload 用 es 格式，
              // 且 mergeConfig 会把默认 ['es'] 与这里的 ['cjs'] 拼接成 ['es','cjs']，
              // 两种格式写入同一文件名时最终落盘成 ESM，Electron 加载即报
              // "Cannot use import statement outside a module"。
              // 因此用 fileName 按格式区分：cjs 产物固定输出 preload.cjs（纯 CommonJS，Electron 加载它），
              // es 产物改名避免覆盖。
              fileName: (format) => (format === 'cjs' ? 'preload.cjs' : 'preload.es.js'),
            },
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'chokidar', 'node-schedule'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
  },
})
