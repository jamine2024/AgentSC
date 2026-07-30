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
              external: ["better-sqlite3", "chokidar", "node-schedule"]
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
              fileName: () => "preload.js"
            },
            rollupOptions: {
              external: ["better-sqlite3", "chokidar", "node-schedule"],
              output: {
                format: "cjs"
              }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxYOVxcXFxPUENcdTk4NzlcdTc2RUVcXFxcQWdlbnRTQ1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcWDlcXFxcT1BDXHU5ODc5XHU3NkVFXFxcXEFnZW50U0NcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L1g5L09QQyVFOSVBMSVCOSVFNyU5QiVBRS9BZ2VudFNDL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCBlbGVjdHJvbiBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbidcbmltcG9ydCByZW5kZXJlciBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlcidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYy9yZW5kZXJlcicpLFxuICAgICAgJ0BtYWluJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjL21haW4nKSxcbiAgICB9LFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICBlbGVjdHJvbihbXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL21haW4vbWFpbi50cycpLFxuICAgICAgICBvbnN0YXJ0OiAob3B0aW9ucykgPT4gb3B0aW9ucy5zdGFydHVwKFsnLicsICctLXJlbW90ZS1kZWJ1Z2dpbmctcG9ydD05MjIyJywgJy0tcmVtb3RlLWFsbG93LW9yaWdpbnM9KicsICctLW5vLXNhbmRib3gnXSksXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgbWluaWZ5OiBmYWxzZSxcbiAgICAgICAgICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ291dC9tYWluJyksXG4gICAgICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAgIGV4dGVybmFsOiBbJ2JldHRlci1zcWxpdGUzJywgJ2Nob2tpZGFyJywgJ25vZGUtc2NoZWR1bGUnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3ByZWxvYWQvcHJlbG9hZC50cycpLFxuICAgICAgICBvbnN0YXJ0OiAob3B0aW9ucykgPT4gb3B0aW9ucy5yZWxvYWQoKSxcbiAgICAgICAgdml0ZToge1xuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICBtaW5pZnk6IGZhbHNlLFxuICAgICAgICAgICAgb3V0RGlyOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnb3V0L3ByZWxvYWQnKSxcbiAgICAgICAgICAgIGxpYjoge1xuICAgICAgICAgICAgICBlbnRyeTogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9wcmVsb2FkL3ByZWxvYWQudHMnKSxcbiAgICAgICAgICAgICAgZm9ybWF0czogWydjanMnXSxcbiAgICAgICAgICAgICAgZmlsZU5hbWU6ICgpID0+ICdwcmVsb2FkLmpzJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAgIGV4dGVybmFsOiBbJ2JldHRlci1zcWxpdGUzJywgJ2Nob2tpZGFyJywgJ25vZGUtc2NoZWR1bGUnXSxcbiAgICAgICAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgICAgICAgZm9ybWF0OiAnY2pzJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgXSksXG4gICAgcmVuZGVyZXIoKSxcbiAgXSxcbiAgcm9vdDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9yZW5kZXJlcicpLFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ291dC9yZW5kZXJlcicpLFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVEsU0FBUyxvQkFBb0I7QUFDaFMsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sV0FBVztBQUNsQixPQUFPLGNBQWM7QUFDckIsT0FBTyxjQUFjO0FBSnJCLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLGdCQUFnQjtBQUFBLE1BQzdDLFNBQVMsS0FBSyxRQUFRLGtDQUFXLFlBQVk7QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxNQUNQO0FBQUEsUUFDRSxPQUFPLEtBQUssUUFBUSxrQ0FBVyxrQkFBa0I7QUFBQSxRQUNqRCxTQUFTLENBQUMsWUFBWSxRQUFRLFFBQVEsQ0FBQyxLQUFLLGdDQUFnQyw0QkFBNEIsY0FBYyxDQUFDO0FBQUEsUUFDdkgsTUFBTTtBQUFBLFVBQ0osT0FBTztBQUFBLFlBQ0wsV0FBVztBQUFBLFlBQ1gsUUFBUTtBQUFBLFlBQ1IsUUFBUSxLQUFLLFFBQVEsa0NBQVcsVUFBVTtBQUFBLFlBQzFDLGVBQWU7QUFBQSxjQUNiLFVBQVUsQ0FBQyxrQkFBa0IsWUFBWSxlQUFlO0FBQUEsWUFDMUQ7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBO0FBQUEsUUFDRSxPQUFPLEtBQUssUUFBUSxrQ0FBVyx3QkFBd0I7QUFBQSxRQUN2RCxTQUFTLENBQUMsWUFBWSxRQUFRLE9BQU87QUFBQSxRQUNyQyxNQUFNO0FBQUEsVUFDSixPQUFPO0FBQUEsWUFDTCxXQUFXO0FBQUEsWUFDWCxRQUFRO0FBQUEsWUFDUixRQUFRLEtBQUssUUFBUSxrQ0FBVyxhQUFhO0FBQUEsWUFDN0MsS0FBSztBQUFBLGNBQ0gsT0FBTyxLQUFLLFFBQVEsa0NBQVcsd0JBQXdCO0FBQUEsY0FDdkQsU0FBUyxDQUFDLEtBQUs7QUFBQSxjQUNmLFVBQVUsTUFBTTtBQUFBLFlBQ2xCO0FBQUEsWUFDQSxlQUFlO0FBQUEsY0FDYixVQUFVLENBQUMsa0JBQWtCLFlBQVksZUFBZTtBQUFBLGNBQ3hELFFBQVE7QUFBQSxnQkFDTixRQUFRO0FBQUEsY0FDVjtBQUFBLFlBQ0Y7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxJQUNELFNBQVM7QUFBQSxFQUNYO0FBQUEsRUFDQSxNQUFNLEtBQUssUUFBUSxrQ0FBVyxjQUFjO0FBQUEsRUFDNUMsT0FBTztBQUFBLElBQ0wsUUFBUSxLQUFLLFFBQVEsa0NBQVcsY0FBYztBQUFBLElBQzlDLGFBQWE7QUFBQSxFQUNmO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
