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
        onstart: (options) => options.startup([".", "--remote-debugging-port=9222", "--remote-allow-origins=*", "--no-sandbox"]),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxYOVxcXFxPUENcdTk4NzlcdTc2RUVcXFxcQWdlbnRTQ1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcWDlcXFxcT1BDXHU5ODc5XHU3NkVFXFxcXEFnZW50U0NcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L1g5L09QQyVFOSVBMSVCOSVFNyU5QiVBRS9BZ2VudFNDL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCBlbGVjdHJvbiBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbidcbmltcG9ydCByZW5kZXJlciBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlcidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYy9yZW5kZXJlcicpLFxuICAgICAgJ0BtYWluJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL21haW4nKSxcbiAgICB9LFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBlbGVjdHJvbihbXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL21haW4vbWFpbi50cycpLFxuICAgICAgICBvbnN0YXJ0OiAob3B0aW9ucykgPT4gb3B0aW9ucy5zdGFydHVwKFsnLicsICctLXJlbW90ZS1kZWJ1Z2dpbmctcG9ydD05MjIyJywgJy0tcmVtb3RlLWFsbG93LW9yaWdpbnM9KicsICctLW5vLXNhbmRib3gnXSksXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgICAgICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ291dC9tYWluJyksXG4gICAgICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAgIGV4dGVybmFsOiBbJ2JldHRlci1zcWxpdGUzJywgJ2Nob2tpZGFyJywgJ25vZGUtc2NoZWR1bGUnLCAnbm9kZS1nbG9iYWwta2V5LWxpc3RlbmVyJ10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBlbnRyeTogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wcmVsb2FkL3ByZWxvYWQudHMnKSxcbiAgICAgICAgb25zdGFydDogKG9wdGlvbnMpID0+IG9wdGlvbnMucmVsb2FkKCksXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgICAgICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ291dC9wcmVsb2FkJyksXG4gICAgICAgICAgICBsaWI6IHtcbiAgICAgICAgICAgICAgZW50cnk6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvcHJlbG9hZC9wcmVsb2FkLnRzJyksXG4gICAgICAgICAgICAgIGZvcm1hdHM6IFsnY2pzJ10sXG4gICAgICAgICAgICAgIC8vIFx1NUZDNVx1OTg3Qlx1NEY3Rlx1NzUyOCAuY2pzIFx1NjI2OVx1NUM1NVx1NTQwRFx1RkYxQXBhY2thZ2UuanNvbiBcdTU0MkIgXCJ0eXBlXCI6IFwibW9kdWxlXCJcdUZGMENcbiAgICAgICAgICAgICAgLy8gXHU2NjZFXHU5MDFBIC5qcyBcdTRGMUFcdTg4QUIgTm9kZSBcdTVGNTNcdTRGNUMgRVMgbW9kdWxlXHVGRjBDXHU4MDBDIEVsZWN0cm9uIFx1NEVFNSBDb21tb25KUyBcdTUyQTBcdThGN0QgcHJlbG9hZFx1RkYwQ1x1NUJGQ1x1ODFGNFx1NjJBNVx1OTUxOVx1MzAwMlxuICAgICAgICAgICAgICAvLyBcdTZDRThcdTYxMEZcdUZGMUF2aXRlLXBsdWdpbi1lbGVjdHJvbiBcdTU3MjggdHlwZTptb2R1bGUgXHU0RTBCXHU5RUQ4XHU4QkE0XHU3RUQ5IHByZWxvYWQgXHU3NTI4IGVzIFx1NjgzQ1x1NUYwRlx1RkYwQ1xuICAgICAgICAgICAgICAvLyBcdTRFMTQgbWVyZ2VDb25maWcgXHU0RjFBXHU2MjhBXHU5RUQ4XHU4QkE0IFsnZXMnXSBcdTRFMEVcdThGRDlcdTkxQ0NcdTc2ODQgWydjanMnXSBcdTYyRkNcdTYzQTVcdTYyMTAgWydlcycsJ2NqcyddXHVGRjBDXG4gICAgICAgICAgICAgIC8vIFx1NEUyNFx1NzlDRFx1NjgzQ1x1NUYwRlx1NTE5OVx1NTE2NVx1NTQwQ1x1NEUwMFx1NjU4N1x1NEVGNlx1NTQwRFx1NjVGNlx1NjcwMFx1N0VDOFx1ODQzRFx1NzZEOFx1NjIxMCBFU01cdUZGMENFbGVjdHJvbiBcdTUyQTBcdThGN0RcdTUzNzNcdTYyQTVcbiAgICAgICAgICAgICAgLy8gXCJDYW5ub3QgdXNlIGltcG9ydCBzdGF0ZW1lbnQgb3V0c2lkZSBhIG1vZHVsZVwiXHUzMDAyXG4gICAgICAgICAgICAgIC8vIFx1NTZFMFx1NkI2NFx1NzUyOCBmaWxlTmFtZSBcdTYzMDlcdTY4M0NcdTVGMEZcdTUzM0FcdTUyMDZcdUZGMUFjanMgXHU0RUE3XHU3MjY5XHU1NkZBXHU1QjlBXHU4RjkzXHU1MUZBIHByZWxvYWQuY2pzXHVGRjA4XHU3RUFGIENvbW1vbkpTXHVGRjBDRWxlY3Ryb24gXHU1MkEwXHU4RjdEXHU1QjgzXHVGRjA5XHVGRjBDXG4gICAgICAgICAgICAgIC8vIGVzIFx1NEVBN1x1NzI2OVx1NjUzOVx1NTQwRFx1OTA3Rlx1NTE0RFx1ODk4Nlx1NzZENlx1MzAwMlxuICAgICAgICAgICAgICBmaWxlTmFtZTogKGZvcm1hdCkgPT4gKGZvcm1hdCA9PT0gJ2NqcycgPyAncHJlbG9hZC5janMnIDogJ3ByZWxvYWQuZXMuanMnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAgIGV4dGVybmFsOiBbJ2VsZWN0cm9uJywgJ2JldHRlci1zcWxpdGUzJywgJ2Nob2tpZGFyJywgJ25vZGUtc2NoZWR1bGUnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgXSksXG4gICAgcmVuZGVyZXIoKSxcbiAgXSxcbiAgcm9vdDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9yZW5kZXJlcicpLFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ291dC9yZW5kZXJlcicpLFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVEsU0FBUyxvQkFBb0I7QUFDaFMsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sV0FBVztBQUNsQixPQUFPLGNBQWM7QUFDckIsT0FBTyxjQUFjO0FBSnJCLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLGdCQUFnQjtBQUFBLE1BQzdDLFNBQVMsS0FBSyxRQUFRLGtDQUFXLFlBQVk7QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxNQUNQO0FBQUEsUUFDRSxPQUFPLEtBQUssUUFBUSxrQ0FBVyxrQkFBa0I7QUFBQSxRQUNqRCxTQUFTLENBQUMsWUFBWSxRQUFRLFFBQVEsQ0FBQyxLQUFLLGdDQUFnQyw0QkFBNEIsY0FBYyxDQUFDO0FBQUEsUUFDdkgsTUFBTTtBQUFBLFVBQ0osT0FBTztBQUFBLFlBQ0wsV0FBVztBQUFBLFlBQ1gsUUFBUTtBQUFBLFlBQ1IsUUFBUSxLQUFLLFFBQVEsa0NBQVcsVUFBVTtBQUFBLFlBQzFDLGVBQWU7QUFBQSxjQUNiLFVBQVUsQ0FBQyxrQkFBa0IsWUFBWSxpQkFBaUIsMEJBQTBCO0FBQUEsWUFDdEY7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBO0FBQUEsUUFDRSxPQUFPLEtBQUssUUFBUSxrQ0FBVyx3QkFBd0I7QUFBQSxRQUN2RCxTQUFTLENBQUMsWUFBWSxRQUFRLE9BQU87QUFBQSxRQUNyQyxNQUFNO0FBQUEsVUFDSixPQUFPO0FBQUEsWUFDTCxXQUFXO0FBQUEsWUFDWCxRQUFRO0FBQUEsWUFDUixRQUFRLEtBQUssUUFBUSxrQ0FBVyxhQUFhO0FBQUEsWUFDN0MsS0FBSztBQUFBLGNBQ0gsT0FBTyxLQUFLLFFBQVEsa0NBQVcsd0JBQXdCO0FBQUEsY0FDdkQsU0FBUyxDQUFDLEtBQUs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsY0FTZixVQUFVLENBQUMsV0FBWSxXQUFXLFFBQVEsZ0JBQWdCO0FBQUEsWUFDNUQ7QUFBQSxZQUNBLGVBQWU7QUFBQSxjQUNiLFVBQVUsQ0FBQyxZQUFZLGtCQUFrQixZQUFZLGVBQWU7QUFBQSxZQUN0RTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLElBQ0QsU0FBUztBQUFBLEVBQ1g7QUFBQSxFQUNBLE1BQU0sS0FBSyxRQUFRLGtDQUFXLGNBQWM7QUFBQSxFQUM1QyxPQUFPO0FBQUEsSUFDTCxRQUFRLEtBQUssUUFBUSxrQ0FBVyxjQUFjO0FBQUEsSUFDOUMsYUFBYTtBQUFBLEVBQ2Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
