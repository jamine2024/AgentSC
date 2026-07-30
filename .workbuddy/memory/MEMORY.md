# AgentSC 项目记忆

## 技术栈
Electron + React18 + TS + Vite；Tailwind v3(HSL `hsl(var(--x))`)；better-sqlite3；recharts；lucide-react；cva+clsx+tailwind-merge。深色为主，浅色可选。IPC 走 `window.electronAPI.invoke/.on`。

## 构建与沙箱限制
- safe-delete shim 拦截 rmSync→回收站，沙箱内不可用，致 `vite build` 默认 emptyOutDir 报 `SAFE_DELETE_BULK_GUARD_ERROR`。验证：`tsc --noEmit`；`vite build --outDir <全新目录>`（仍可能因 emptyDir 失败，属环境限制，main/preload 通常已产出）。
- tsc 用 node_modules/typescript/bin/tsc（托管 node 22.22.2）。

## preload 必须 .cjs（type:module 下）
- 修法：formats:['cjs']，fileName 按格式区分 `f==='cjs'?'preload.cjs':'preload.es.js'`。external 含 electron/better-sqlite3/chokidar/node-schedule。勿移除 "type":"module"。

## 设计系统
- 深色底 222 41% 4.5%，主色 224 76% 56%，info 199 89% 48%，success 160 67% 45%，warning 38 92% 52%，destructive 0 72% 51%。
- .glass/.glass-hover；.gradient-text/.brand-gradient；bg-primary/8 任意整数透明度。
- Accent 系统：模式(dark/light)+8 套配色(ACCENTS in theme.tsx)，data-accent 写 `<html>`，:root[data-accent] 覆盖 --primary/--ring/--info/--grad-*。持久化 agentsc-accent/agentsc-theme。
- 滚动条：透明 thumb；hover 显灰，thumb:hover 主色，active 0.75；8px 胶囊。

## 导出/动画/状态
- 占用分析导出 TXT：scanReport.buildScanReportTxt + main export-scan-txt。
- Splash：renderer 全屏覆盖，Dashboard 首屏 6 loader settled 后 dispatch 'dashboard:ready'，最短 900ms/兜底 4s。
- AI 清理跨 tab 状态提升到 App 全局。
- 托盘菜单=原生 Menu(tray.setContextMenu)。左键=显示主窗口；右键=原生菜单(显示/跳转/开机自启+关闭到托盘/退出)，refreshTrayMenu() 重建同步。

## 性能/监控
- processTracker 与 watcher 解耦，main.ts 两段式初始化(T0=6s；T1=15s 仅 enabled)。
- snapshot 30s；新装默认不监控；chokidar ignored 函数放首位+depth 4；PowerShell 查询 5min 缓存；IPC 推送 500ms/50 条。
- chokidar watch Windows 用户主目录（`%USERPROFILE%`）必须加 `ignorePermissionErrors:true`，并在 `ignored` 排除 junction 别名（Application Data / Cookies / Local Settings / AppData\Local\Application Data）与隐藏目录，否则 `fs.watch` 抛 EPERM 且 async rejection 未被捕获→进程可能崩溃（`--unhandled-rejections=strict` 下必崩）。indexer.ts 已修，watcher.ts 已加防御。详见 2026-07-28。

## 开发约定
- 开发模式默认不自动开 DevTools 面板（`main.ts` 仅当 `process.env.OPEN_DEVTOOLS==='1'` 才 `openDevTools()`），以避免 devtools_http_handler 端口冲突(0x2740)与内置 Chromium 不支持的 Autofill CDP 告警噪声。需调试：`OPEN_DEVTOOLS=1 npm run dev`。
- `vite.config.ts` 的 electron onstart 原写死 `--remote-debugging-port=9222`，多实例/残留 Electron 进程会触发 `WSAEADDRINUSE(0x2740)` + `devtools_http_handler` 绑定失败。已改为 `--remote-debugging-port=0`（动态端口，Chromium 自分配空闲端口），内部 `openDevTools()` 不受影响；仅外部 CDP 连接端口变随机。

## 功能模块速查
- CLI管理（`pages/CliManager.tsx` + `main/cliManager.ts`）：`cli:list/run/write/kill/open-terminal/uninstall`。
- 全盘文件搜索（`main/filesearch/`：types/db/crawler/indexer）：`search:query/build/status`。GlobalSearch.tsx(Ctrl/Cmd+K)。
- 网络安全监控（`main/networkMonitor.ts` + `pages/NetworkSecurity.tsx`，nav.netsec）：流量/ARP/DHCP，需管理员权限。
- 我的电脑·自定义快捷入口（`main/myComputerIcons.ts` + `pages/MyComputerIcons.tsx`）：`pcicons:custom:list/add/remove/pick`，真实注册表 CLSID 注入，i18n pcicons.custom_* 27 键勿丢。
- 抓包分析（`main/packetCapture.ts` + `pages/PacketCapture.tsx`，nav.packet_capture）：MITM 代理，本机/ADB/锁定应用三模式；`packet-capture:*` IPC。
- 局域网共享（`main/lanShare.ts` + `pages/LanShare.tsx`）：`lanshare:local-shares/create/remove/computers/remote-shares`。**注意：C$/D$/ADMIN$/IPC$/PRINT$/FAX$ 为 Windows 保留共享，Remove-SmbShare 会报 Error 50；removeShare 已用 isSystemShare 拦截，前端对保留共享禁用删除按钮（徽章「系统保留共享」）。**
- 鼠标键盘（`main/mouseKeyboard.ts` + `pages/MouseKeyboard.tsx`，nav 鼠标键盘）：三 tab——①设备(WMI 探测鼠标/键盘/电池，真功能)②使用统计(全局键盘钩子 `node-global-key-listener@0.3.0`，仅键盘不统计鼠标点击)③重映射(注册表 Scancode Map，重启/注销生效)。**打包必须把 `node-global-key-listener`+`sudo-prompt` 加进 `asarUnpack`，否则 WinKeyServer.exe 被封进 asar 虚拟文件系统、spawn 失败 → 统计恒 0**；主进程 external 已含该库。`addListener` 为 async 须 `await` 否则启动失败被吞。

## 坑：i18n.tsx 超大对象 + 后台 linter
- i18n.tsx 单一巨型对象，后台 linter 持续改写致 Edit 频繁报「File has been modified since read」。批量增删键必须用 Node 脚本程序化注入/删除。
- 锚点须唯一（勿用 zh/en 两处都出现的注释作锚点）。
- 源码误删恢复：查 vite 产物 src/renderer/out-*/assets/index-*.js（minified 但含完整字典）。

## 坑：原生对话框（dialog.*）必须先把主窗口置顶
- `dialog.showOpenDialog/showSaveDialog(mainWindow, ...)` 以 mainWindow 为父窗口时**天然模态**，会禁用主窗口交互。弹窗前若主窗口未置顶（被遮挡/最小化恢复/焦点异常），原生对话框会藏到主窗口之后 → 用户看不到对话框、又因模态点不动主窗口 = 体感「卡死」。
- 修复模板：`ensureWindowForeground()`（先 `if(minimized)restore()`、`if(!visible)show()`、`focus()`、`moveTop()`，moveTop 包 try）必须在每个 dialog 调用前执行。
- **`modal: true` 不是 `OpenDialogOptions/SaveDialogOptions` 的合法字段**（Electron 类型定义无此字段、运行时也不认），模态由是否传入 parent window 决定，切勿再加 `modal` 选项。
- 2026-07-28 已统一给 pcicons:pick / select-directory / export-exclusion-rules / import-exclusion-rules / export-scan-txt / export-events / wsl:export / wsl:import / packet-capture:* 共 11 处加 `ensureWindowForeground()`。
- **补充**：`dialog.showOpenDialog` 未指定 `defaultPath` 时 Windows 会从桌面/上次位置加载，文件多/含网络快捷方式会拖慢弹出；对 `pcicons:pick` 等用户已有目标路径的场景，应把目标所在目录作为 `defaultPath` 传入，避免扫描无关位置。

## 安全红线（2026-07-28 专项扫描后确立）
- 渲染进程输入（IPC 参数）一律不可信：任何 `ipcMain.handle` 接收的 path/guid/command 等，进入 shell/PowerShell/文件系统高危操作前必须校验。
- **PowerShell 注入**：拼 GUID/路径/name 进 PowerShell 单引号字符串前，必须用正则 `^\{?[0-9A-Fa-f]{8}-...-...-...-...\}{0,1}$` 校验 `isValidGuid`，parent 限 `NameSpace|DelegateFolders`。name/target 已用 `psStr` 转义（单引号→双单引号）。
- **命令执行**：`cliManager.runCli` 用 `shell:true` 时只接受内置 AI 工具名（REGISTRY/AI_NAME_SET）或真实存在的 exe 绝对路径（`isAllowedCliCommand`），路径型命令改 `shell:false`；`scheduler.runShell` 拒绝含 `& | ; < > $ \`` 等元字符。
- **任意目录删除**：`run-cleaner-rule` 的 custom 类型 target 必须过 `isSystemProtectedPath`，禁止盘根/Windows/Program Files/ProgramData/Users。
- **敏感文件权限**：CA 私钥等写入用 `{mode:0o600}` + `fs.chmodSync(0o600)`。

## 内存/资源红线（2026-07-28 专项扫描后确立）
- 任何模块级 `Map`/数组缓存（iconCache、recentPaths、hostCache、processNameCache 等）必须有**容量上限 + 淘汰/TTL**，禁止无界 `set`。iconCache 上限 500 FIFO；watcher.recentPaths 每 1000 次写 sweep 过期项（>60s）。
- 长时运行的数据表（`file_events`/`app_logs`/`cleaner_logs`）必须有**滚动清理**：`pruneFileEvents(30)`/`pruneAppLogs(30)` 在 `app.whenReady` 启动跑一次 + 每 24h 定时。
- 上下文：contextIsolation 已开、nodeIntegration 关闭（`main.ts` BrowserWindow），无需改；渲染端无 `dangerouslySetInnerHTML`，XSS 面小。
