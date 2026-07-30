// vite.config.ts
import { defineConfig } from "file:///E:/X9/OPC%E9%A1%B9%E7%9B%AE/AgentSC/node_modules/vite/dist/node/index.js";
import path from "node:path";
import react from "file:///E:/X9/OPC%E9%A1%B9%E7%9B%AE/AgentSC/node_modules/@vitejs/plugin-react/dist/index.js";
import electron from "file:///E:/X9/OPC%E9%A1%B9%E7%9B%AE/AgentSC/node_modules/vite-plugin-electron/dist/index.mjs";
import renderer from "file:///E:/X9/OPC%E9%A1%B9%E7%9B%AE/AgentSC/node_modules/vite-plugin-electron-renderer/dist/index.mjs";
var __vite_injected_original_dirname = "E:\\X9\\OPC\u9879\u76EE\\AgentSC";
var vite_config_default = defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src/renderer"),
      "@main": path.resolve(__vite_injected_original_dirname, "./src/main")
    }
  },
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(__vite_injected_original_dirname, "src/main/main.ts"),
        // 远程调试端口改用 0（由 Chromium 自动分配空闲端口），避免硬编码 9222 在
        // 多实例/残留进程下触发 WSAEADDRINUSE(0x2740) 与 devtools_http_handler 绑定失败。
        // 内部 webContents.openDevTools() 不受影响；仅外部 CDP 客户端连接端口变为随机。
        onstart: (options) => options.startup([".", "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-sandbox"]),
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: path.resolve(__vite_injected_original_dirname, "out/main"),
            rollupOptions: {
              external: ["better-sqlite3", "chokidar", "node-schedule", "node-global-key-listener"]
            }
          }
        }
      },
      {
        entry: path.resolve(__vite_injected_original_dirname, "src/preload/preload.ts"),
        onstart: (options) => options.reload(),
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: path.resolve(__vite_injected_original_dirname, "out/preload"),
            lib: {
              entry: path.resolve(__vite_injected_original_dirname, "src/preload/preload.ts"),
              formats: ["cjs"],
              // 必须使用 .cjs 扩展名：package.json 含 "type": "module"，
              // 普通 .js 会被 Node 当作 ES module，而 Electron 以 CommonJS 加载 preload，导致报错。
              // 注意：vite-plugin-electron 在 type:module 下默认给 preload 用 es 格式，
              // 且 mergeConfig 会把默认 ['es'] 与这里的 ['cjs'] 拼接成 ['es','cjs']，
              // 两种格式写入同一文件名时最终落盘成 ESM，Electron 加载即报
              // "Cannot use import statement outside a module"。
              // 因此用 fileName 按格式区分：cjs 产物固定输出 preload.cjs（纯 CommonJS，Electron 加载它），
              // es 产物改名避免覆盖。
              fileName: (format) => format === "cjs" ? "preload.cjs" : "preload.es.js"
            },
            rollupOptions: {
              external: ["electron", "better-sqlite3", "chokidar", "node-schedule"]
            }
          }
        }
      }
    ]),
    renderer()
  ],
  root: path.resolve(__vite_injected_original_dirname, "src/renderer"),
  build: {
    outDir: path.resolve(__vite_injected_original_dirname, "out/renderer"),
    emptyOutDir: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxYOVxcXFxPUENcdTk4NzlcdTc2RUVcXFxcQWdlbnRTQ1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcWDlcXFxcT1BDXHU5ODc5XHU3NkVFXFxcXEFnZW50U0NcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L1g5L09QQyVFOSVBMSVCOSVFNyU5QiVBRS9BZ2VudFNDL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCBlbGVjdHJvbiBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbidcbmltcG9ydCByZW5kZXJlciBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlcidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYy9yZW5kZXJlcicpLFxuICAgICAgJ0BtYWluJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL21haW4nKSxcbiAgICB9LFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBlbGVjdHJvbihbXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL21haW4vbWFpbi50cycpLFxuICAgICAgICAvLyBcdThGRENcdTdBMEJcdThDMDNcdThCRDVcdTdBRUZcdTUzRTNcdTY1MzlcdTc1MjggMFx1RkYwOFx1NzUzMSBDaHJvbWl1bSBcdTgxRUFcdTUyQThcdTUyMDZcdTkxNERcdTdBN0FcdTk1RjJcdTdBRUZcdTUzRTNcdUZGMDlcdUZGMENcdTkwN0ZcdTUxNERcdTc4NkNcdTdGMTZcdTc4MDEgOTIyMiBcdTU3MjhcbiAgICAgICAgLy8gXHU1OTFBXHU1QjlFXHU0RjhCL1x1NkI4Qlx1NzU1OVx1OEZEQlx1N0EwQlx1NEUwQlx1ODlFNlx1NTNEMSBXU0FFQUREUklOVVNFKDB4Mjc0MCkgXHU0RTBFIGRldnRvb2xzX2h0dHBfaGFuZGxlciBcdTdFRDFcdTVCOUFcdTU5MzFcdThEMjVcdTMwMDJcbiAgICAgICAgLy8gXHU1MTg1XHU5MEU4IHdlYkNvbnRlbnRzLm9wZW5EZXZUb29scygpIFx1NEUwRFx1NTNEN1x1NUY3MVx1NTRDRFx1RkYxQlx1NEVDNVx1NTkxNlx1OTBFOCBDRFAgXHU1QkEyXHU2MjM3XHU3QUVGXHU4RkRFXHU2M0E1XHU3QUVGXHU1M0UzXHU1M0Q4XHU0RTNBXHU5NjhGXHU2NzNBXHUzMDAyXG4gICAgICAgIG9uc3RhcnQ6IChvcHRpb25zKSA9PiBvcHRpb25zLnN0YXJ0dXAoWycuJywgJy0tcmVtb3RlLWRlYnVnZ2luZy1wb3J0PTAnLCAnLS1yZW1vdGUtYWxsb3ctb3JpZ2lucz0qJywgJy0tbm8tc2FuZGJveCddKSxcbiAgICAgICAgdml0ZToge1xuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgb3V0RGlyOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnb3V0L21haW4nKSxcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsnYmV0dGVyLXNxbGl0ZTMnLCAnY2hva2lkYXInLCAnbm9kZS1zY2hlZHVsZScsICdub2RlLWdsb2JhbC1rZXktbGlzdGVuZXInXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3ByZWxvYWQvcHJlbG9hZC50cycpLFxuICAgICAgICBvbnN0YXJ0OiAob3B0aW9ucykgPT4gb3B0aW9ucy5yZWxvYWQoKSxcbiAgICAgICAgdml0ZToge1xuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgb3V0RGlyOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnb3V0L3ByZWxvYWQnKSxcbiAgICAgICAgICAgIGxpYjoge1xuICAgICAgICAgICAgICBlbnRyeTogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wcmVsb2FkL3ByZWxvYWQudHMnKSxcbiAgICAgICAgICAgICAgZm9ybWF0czogWydjanMnXSxcbiAgICAgICAgICAgICAgLy8gXHU1RkM1XHU5ODdCXHU0RjdGXHU3NTI4IC5janMgXHU2MjY5XHU1QzU1XHU1NDBEXHVGRjFBcGFja2FnZS5qc29uIFx1NTQyQiBcInR5cGVcIjogXCJtb2R1bGVcIlx1RkYwQ1xuICAgICAgICAgICAgICAvLyBcdTY2NkVcdTkwMUEgLmpzIFx1NEYxQVx1ODhBQiBOb2RlIFx1NUY1M1x1NEY1QyBFUyBtb2R1bGVcdUZGMENcdTgwMEMgRWxlY3Ryb24gXHU0RUU1IENvbW1vbkpTIFx1NTJBMFx1OEY3RCBwcmVsb2FkXHVGRjBDXHU1QkZDXHU4MUY0XHU2MkE1XHU5NTE5XHUzMDAyXG4gICAgICAgICAgICAgIC8vIFx1NkNFOFx1NjEwRlx1RkYxQXZpdGUtcGx1Z2luLWVsZWN0cm9uIFx1NTcyOCB0eXBlOm1vZHVsZSBcdTRFMEJcdTlFRDhcdThCQTRcdTdFRDkgcHJlbG9hZCBcdTc1MjggZXMgXHU2ODNDXHU1RjBGXHVGRjBDXG4gICAgICAgICAgICAgIC8vIFx1NEUxNCBtZXJnZUNvbmZpZyBcdTRGMUFcdTYyOEFcdTlFRDhcdThCQTQgWydlcyddIFx1NEUwRVx1OEZEOVx1OTFDQ1x1NzY4NCBbJ2NqcyddIFx1NjJGQ1x1NjNBNVx1NjIxMCBbJ2VzJywnY2pzJ11cdUZGMENcbiAgICAgICAgICAgICAgLy8gXHU0RTI0XHU3OUNEXHU2ODNDXHU1RjBGXHU1MTk5XHU1MTY1XHU1NDBDXHU0RTAwXHU2NTg3XHU0RUY2XHU1NDBEXHU2NUY2XHU2NzAwXHU3RUM4XHU4NDNEXHU3NkQ4XHU2MjEwIEVTTVx1RkYwQ0VsZWN0cm9uIFx1NTJBMFx1OEY3RFx1NTM3M1x1NjJBNVxuICAgICAgICAgICAgICAvLyBcIkNhbm5vdCB1c2UgaW1wb3J0IHN0YXRlbWVudCBvdXRzaWRlIGEgbW9kdWxlXCJcdTMwMDJcbiAgICAgICAgICAgICAgLy8gXHU1NkUwXHU2QjY0XHU3NTI4IGZpbGVOYW1lIFx1NjMwOVx1NjgzQ1x1NUYwRlx1NTMzQVx1NTIwNlx1RkYxQWNqcyBcdTRFQTdcdTcyNjlcdTU2RkFcdTVCOUFcdThGOTNcdTUxRkEgcHJlbG9hZC5janNcdUZGMDhcdTdFQUYgQ29tbW9uSlNcdUZGMENFbGVjdHJvbiBcdTUyQTBcdThGN0RcdTVCODNcdUZGMDlcdUZGMENcbiAgICAgICAgICAgICAgLy8gZXMgXHU0RUE3XHU3MjY5XHU2NTM5XHU1NDBEXHU5MDdGXHU1MTREXHU4OTg2XHU3NkQ2XHUzMDAyXG4gICAgICAgICAgICAgIGZpbGVOYW1lOiAoZm9ybWF0KSA9PiAoZm9ybWF0ID09PSAnY2pzJyA/ICdwcmVsb2FkLmNqcycgOiAncHJlbG9hZC5lcy5qcycpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgZXh0ZXJuYWw6IFsnZWxlY3Ryb24nLCAnYmV0dGVyLXNxbGl0ZTMnLCAnY2hva2lkYXInLCAnbm9kZS1zY2hlZHVsZSddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICBdKSxcbiAgICByZW5kZXJlcigpLFxuICBdLFxuICByb290OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3JlbmRlcmVyJyksXG4gIGJ1aWxkOiB7XG4gICAgb3V0RGlyOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnb3V0L3JlbmRlcmVyJyksXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFtUSxTQUFTLG9CQUFvQjtBQUNoUyxPQUFPLFVBQVU7QUFDakIsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sY0FBYztBQUNyQixPQUFPLGNBQWM7QUFKckIsSUFBTSxtQ0FBbUM7QUFNekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsZ0JBQWdCO0FBQUEsTUFDN0MsU0FBUyxLQUFLLFFBQVEsa0NBQVcsWUFBWTtBQUFBLElBQy9DO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sU0FBUztBQUFBLE1BQ1A7QUFBQSxRQUNFLE9BQU8sS0FBSyxRQUFRLGtDQUFXLGtCQUFrQjtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBSWpELFNBQVMsQ0FBQyxZQUFZLFFBQVEsUUFBUSxDQUFDLEtBQUssNkJBQTZCLDRCQUE0QixjQUFjLENBQUM7QUFBQSxRQUNwSCxNQUFNO0FBQUEsVUFDSixPQUFPO0FBQUEsWUFDTCxXQUFXO0FBQUEsWUFDWCxRQUFRO0FBQUEsWUFDUixRQUFRLEtBQUssUUFBUSxrQ0FBVyxVQUFVO0FBQUEsWUFDMUMsZUFBZTtBQUFBLGNBQ2IsVUFBVSxDQUFDLGtCQUFrQixZQUFZLGlCQUFpQiwwQkFBMEI7QUFBQSxZQUN0RjtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLE1BQ0E7QUFBQSxRQUNFLE9BQU8sS0FBSyxRQUFRLGtDQUFXLHdCQUF3QjtBQUFBLFFBQ3ZELFNBQVMsQ0FBQyxZQUFZLFFBQVEsT0FBTztBQUFBLFFBQ3JDLE1BQU07QUFBQSxVQUNKLE9BQU87QUFBQSxZQUNMLFdBQVc7QUFBQSxZQUNYLFFBQVE7QUFBQSxZQUNSLFFBQVEsS0FBSyxRQUFRLGtDQUFXLGFBQWE7QUFBQSxZQUM3QyxLQUFLO0FBQUEsY0FDSCxPQUFPLEtBQUssUUFBUSxrQ0FBVyx3QkFBd0I7QUFBQSxjQUN2RCxTQUFTLENBQUMsS0FBSztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxjQVNmLFVBQVUsQ0FBQyxXQUFZLFdBQVcsUUFBUSxnQkFBZ0I7QUFBQSxZQUM1RDtBQUFBLFlBQ0EsZUFBZTtBQUFBLGNBQ2IsVUFBVSxDQUFDLFlBQVksa0JBQWtCLFlBQVksZUFBZTtBQUFBLFlBQ3RFO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQUEsSUFDRCxTQUFTO0FBQUEsRUFDWDtBQUFBLEVBQ0EsTUFBTSxLQUFLLFFBQVEsa0NBQVcsY0FBYztBQUFBLEVBQzVDLE9BQU87QUFBQSxJQUNMLFFBQVEsS0FBSyxRQUFRLGtDQUFXLGNBQWM7QUFBQSxJQUM5QyxhQUFhO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
