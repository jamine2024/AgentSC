# AgentSC 架构与功能地图

> 本文档面向开发者、贡献者与项目维护者，系统说明 AgentSC 的整体架构、技术选型、模块划分、数据模型与核心流程。

---

## 1. 项目概述

**AgentSC** 是一款面向 Windows 的 AI 驱动系统工具箱，以"磁盘文件变更跟踪"为核心，围绕系统监控、空间分析、智能清理、系统维护与安全审计展开，提供沉浸式 Material Design 暗色大屏体验。

| 项目信息 | 说明 |
|---|---|
| 名称 | AgentSC |
| 版本 | 1.0.0 |
| 定位 | Windows 本地桌面应用，无需后端服务器 |
| 核心能力 | 文件变更监控 / 进程关联 / 磁盘占用分析 / 报告中心 / AI 洞察 / 系统维护工具集 |
| 运行平台 | Windows 10 / Windows 11（以管理员权限运行） |
| 开源协议 | MIT |

---

## 2. 架构总览

采用 **Electron 多进程架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                    │
│  React 18 + TypeScript + Tailwind CSS + Recharts + shadcn/ui │
│  页面路由 / 状态管理 / 可视化图表 / 全局搜索 / 国际化           │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC（invoke / send / on）
┌──────────────────────────▼──────────────────────────────────┐
│                        主进程 (Main)                          │
│  Electron 31 + Node.js + TypeScript                           │
│  文件监控 / 进程追踪 / 数据库 / 清理器 / 系统工具 / AI 集成      │
└─────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      本地系统层                               │
│  SQLite(better-sqlite3) / chokidar / Windows ETW / WMI / PS   │
│  PowerShell / 注册表 / 证书存储 / 网络接口 / 任务计划程序       │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 进程职责

| 进程 | 职责 |
|---|---|
| **主进程（Main）** | 创建窗口、系统托盘、菜单；执行敏感/重 IO 操作；管理文件监控、数据库、定时任务、系统调用、AI 推理 |
| **渲染进程（Renderer）** | UI 展示与用户交互；通过 IPC 调用主进程能力；不直接操作文件系统或注册表 |
| **Preload 脚本** | 通过 `contextBridge` 暴露受控的 `window.electronAPI`，隔离 Node.js 与渲染进程 |

### 2.2 设计原则

1. **安全隔离**：渲染进程无 Node.js 权限，所有系统操作走 IPC。
2. **批量化处理**：文件事件先缓冲再批量写入数据库与推送前端，降低主进程负载。
3. **可扩展导航**：侧边栏按功能分组（概览 / 分析 / 清理 / 系统 / 开发工具 / 安全），新模块可快速接入。
4. **配置即数据**：排除规则、清理规则、定时任务等持久化到 SQLite，支持导入/导出/订阅。
5. **AI 可插拔**：支持本地 Ollama 与云端 OpenAI 两种推理源，失败时自动降级为启发式分析。

---

## 3. 技术栈

| 层级 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Electron 31 + Vite 5 | 跨进程构建、热更新、打包 |
| 前端框架 | React 18 + TypeScript | 函数组件 + Hooks，类组件仅用于错误边界 |
| 样式 | Tailwind CSS 3 + CSS 变量 | Material Design 暗色沉浸式主题，玻璃拟态卡片 |
| UI 组件 | shadcn/ui（Button / Input / Switch / Slot） | 基础组件 |
| 图标 | lucide-react | 全量矢量图标 |
| 图表 | recharts + ECharts TreeMap | 趋势图、占比热力图 |
| 虚拟列表 | react-window | 大数据量事件列表 |
| 状态共享 | React Context（i18n / theme）+ 组件提升状态 | 跨标签页保持扫描、报告、CLI 运行态 |
| 数据库 | better-sqlite3（SQLite） | 本地事件、配置、日志、扫描历史 |
| 文件监控 | chokidar | 跨磁盘目录监听，配合自定义 heavy-dir 短路过滤 |
| 进程关联 | Windows ETW / 进程快照 | 文件路径 → PID → 进程名 |
| 定时任务 | node-schedule | 清理、AI 洞察、AI 清理等定时调度 |
| AI 推理 | Ollama（本地）/ OpenAI（云端） | 洞察生成、排除规则建议、异常检测 |
| 打包 | electron-builder | NSIS 安装包，输出到 `release/` |

---

## 4. 目录结构

```
AgentSC/
├── build/                          # 应用图标与打包资源
│   ├── icon.ico
│   └── icon.png
├── landing/                        # 产品落地页（GitHub Pages 用）
│   ├── index.html
│   ├── favicon.svg
│   └── screenshot-*.png
├── release/                        # electron-builder 输出（安装包与解压目录）
├── scripts/                        # 辅助脚本（测试、验证、图标生成等）
│   ├── cdp-*.py                    # 数据/清理/冒烟测试脚本
│   ├── check-db.py
│   ├── drive_icon_resolver.py
│   └── gen-icon.mjs
├── src/
│   ├── main/                       # Electron 主进程源码
│   │   ├── builtin-rules/          # 内置清理规则 JSON
│   │   │   ├── browsers.json
│   │   │   ├── dev-cache.json
│   │   │   └── windows-system.json
│   │   ├── filesearch/             # 本地文件索引与搜索
│   │   │   ├── crawler.ts
│   │   │   ├── db.ts
│   │   │   ├── indexer.ts
│   │   │   └── types.ts
│   │   ├── aiCleanup.ts            # AI 智能清理
│   │   ├── aiExclusions.ts         # AI 排除规则建议
│   │   ├── aiInsights.ts           # AI 洞察生成
│   │   ├── builtinRules.ts         # 内置规则加载
│   │   ├── cert.ts                 # 证书管理
│   │   ├── cleaner.ts              # 定时清理引擎
│   │   ├── cliManager.ts           # CLI 终端与工具链
│   │   ├── contextMenu.ts          # 右键菜单管理
│   │   ├── db.ts                   # SQLite 数据层与 Schema
│   │   ├── devTools.ts             # 开发工具检测
│   │   ├── eventViewer.ts          # Windows 事件查看器
│   │   ├── fileIcons.ts            # 文件图标提取
│   │   ├── hardware.ts             # 硬件信息探测
│   │   ├── lanShare.ts             # 局域网共享
│   │   ├── main.ts                 # 主进程入口：窗口、IPC、生命周期
│   │   ├── mouseKeyboard.ts        # 鼠标键盘统计与按键映射
│   │   ├── myComputerIcons.ts      # 此电脑图标管理
│   │   ├── networkMonitor.ts       # 网络监控
│   │   ├── networkTracer.ts        # 网络连接追踪
│   │   ├── ollama.ts               # Ollama 本地模型管理
│   │   ├── packetCapture.ts        # 网络抓包
│   │   ├── processTracker.ts       # 进程关联（ETW / 快照）
│   │   ├── registry.ts             # 注册表操作管理
│   │   ├── scanReport.ts           # 扫描报告文本生成
│   │   ├── scanner.ts              # 目录递归扫描
│   │   ├── scheduler.ts            # 定时任务调度器
│   │   ├── speedTest.ts            # 网速测试
│   │   ├── startupManager.ts       # 启动项管理
│   │   ├── taskManager.ts          # 进程管理
│   │   ├── timeSync.ts             # 时间同步
│   │   ├── uninstaller.ts          # 软件卸载
│   │   ├── watcher.ts              # 文件变更监控核心
│   │   ├── winTaskScheduler.ts     # Windows 任务计划程序
│   │   └── wslManager.ts           # WSL 管理
│   ├── preload/
│   │   └── preload.ts              # contextBridge 暴露 electronAPI
│   ├── renderer/                   # Electron 渲染进程源码
│   │   ├── components/             # 公共组件
│   │   │   ├── ui/                 # shadcn/ui 基础组件
│   │   │   ├── BrandLogo.tsx
│   │   │   ├── CliConsoleDrawer.tsx
│   │   │   ├── GlobalSearch.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── LegalModal.tsx
│   │   │   ├── RelationCanvas.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Splash.tsx
│   │   │   └── Toast.tsx
│   │   ├── hooks/                  # 自定义 Hooks
│   │   │   └── useGlobalSearch.ts
│   │   ├── lib/                    # 工具库与全局状态
│   │   │   ├── cliTypes.ts
│   │   │   ├── i18n.tsx
│   │   │   ├── legal.tsx
│   │   │   ├── searchTypes.ts
│   │   │   ├── systemTypes.ts
│   │   │   ├── theme.tsx
│   │   │   └── utils.ts
│   │   ├── pages/                  # 功能页面（与导航一一对应）
│   │   │   ├── AiCleanup.tsx
│   │   │   ├── Analysis.tsx
│   │   │   ├── CertManager.tsx
│   │   │   ├── Cleaner.tsx
│   │   │   ├── CliManager.tsx
│   │   │   ├── ContextMenu.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── DevTools.tsx
│   │   │   ├── EventViewer.tsx
│   │   │   ├── Exclusions.tsx
│   │   │   ├── Hardware.tsx
│   │   │   ├── LanShare.tsx
│   │   │   ├── Logs.tsx
│   │   │   ├── MouseKeyboard.tsx
│   │   │   ├── MyComputerIcons.tsx
│   │   │   ├── NetworkSecurity.tsx
│   │   │   ├── NetworkTracer.tsx
│   │   │   ├── Ollama.tsx
│   │   │   ├── PacketCapture.tsx
│   │   │   ├── RegistryManager.tsx
│   │   │   ├── ReportsInsights.tsx
│   │   │   ├── Settings.tsx
│   │   │   ├── SpeedTest.tsx
│   │   │   ├── StartupManager.tsx
│   │   │   ├── TaskManager.tsx
│   │   │   ├── TimeSync.tsx
│   │   │   ├── Tracking.tsx
│   │   │   ├── Uninstaller.tsx
│   │   │   ├── Visualize.tsx
│   │   │   ├── WinTaskScheduler.tsx
│   │   │   └── WslManager.tsx
│   │   ├── App.tsx                 # 应用根组件：路由、全局状态、错误边界
│   │   ├── index.css               # 全局样式与 Tailwind 导入
│   │   ├── index.html
│   │   ├── main.tsx                # 渲染进程入口
│   │   └── vite-env.d.ts
│   └── types/
│       └── forge.d.ts              # node-forge 类型声明
├── .gitignore
├── ARCHITECTURE.md                 # 本文件
├── example-cleanup-rules.json      # 清理规则订阅示例
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## 5. 功能地图

侧边栏按 6 大功能组组织，共 30+ 个功能页面：

### 5.1 概览（Overview）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Dashboard** 数据大屏 | 实时心跳、磁盘读写速率、今日统计、Top 进程、最近事件流、磁盘卡片 | `db.ts`, `watcher.ts`, `processTracker.ts`, `hardware.ts` |
| **Visualize** 可视化 | 文件变更关系图、路径流向、关联进程可视化 | `RelationCanvas.tsx`, `networkTracer.ts` |
| **Tracking** 追踪 | 文件生成路径追踪、程序归因、事件详情 | `watcher.ts`, `processTracker.ts` |

### 5.2 分析（Analysis）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Analysis** 占用分析 | 目录递归扫描、TreeMap 热力图、历史扫描记录 | `scanner.ts`, `db.ts` |
| **Reports Insights** 报告中心 | 日/周/月报生成、数据聚合、AI 洞察、导出 | `db.ts`, `aiInsights.ts`, `scanReport.ts` |

### 5.3 清理（Cleanup）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Cleaner** 定时清理 | 回收站、IE 历史、Temp、浏览器缓存、自定义规则、执行日志、规则订阅 | `cleaner.ts`, `scheduler.ts`, `builtinRules.ts` |
| **AI Cleanup** AI 清理 | 大文件/旧文件扫描、AI 推荐清理、一键释放空间 | `aiCleanup.ts`, `aiInsights.ts` |
| **Exclusions** 排除规则 | 系统路径/临时文件/缓存排除、AI 建议规则、导入导出 | `db.ts`, `aiExclusions.ts`, `watcher.ts` |
| **Uninstaller** 软件卸载 | 已安装程序列表、卸载执行 | `uninstaller.ts` |

### 5.4 系统（System）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Task Manager** 任务管理器 | 进程列表、结束进程、进程分析 | `taskManager.ts` |
| **Hardware** 硬件信息 | CPU/内存/磁盘/网卡/主板/显示器等硬件探测 | `hardware.ts`, `db.ts` |
| **Mouse & Keyboard** 键鼠 | 输入统计、按键重映射 | `mouseKeyboard.ts` |
| **WinTask Scheduler** Windows 任务计划 | 创建/启用/禁用/删除/运行 Windows 计划任务 | `winTaskScheduler.ts` |
| **PC Icons** 此电脑图标 | 桌面/资源管理器图标显示控制 | `myComputerIcons.ts` |
| **Context Menu** 右键菜单 | 右键菜单项管理、备份与还原 | `contextMenu.ts` |
| **Speed Test** 网速测试 | 上传/下载/延迟测试 | `speedTest.ts`, `networkMonitor.ts` |
| **Event Viewer** 事件查看器 | Windows 系统事件日志查询、XML 导出 | `eventViewer.ts` |
| **Registry Manager** 注册表 | 注册表操作定义、应用、回滚、历史记录 | `registry.ts`, `db.ts` |
| **Cert Manager** 证书管理 | 证书存储枚举、详情、导出、删除 | `cert.ts` |
| **Startup Manager** 启动项 | 开机启动项列表、启用/禁用 | `startupManager.ts` |
| **Time Sync** 时间同步 | 系统时间同步配置与执行 | `timeSync.ts` |
| **Logs** 应用日志 | 主进程日志查询、模块过滤、清理 | `db.ts` |
| **LAN Share** 局域网共享 | 本机共享、远程计算机/共享浏览 | `lanShare.ts` |

### 5.5 开发工具（DevTools）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Ollama** 本地模型 | 模型列表、拉取、删除、对话、状态检测 | `ollama.ts` |
| **CLI Manager** 命令行 | CLI 工具检测、终端执行、输出抽屉 | `cliManager.ts` |
| **DevTools** 开发工具 | 开发环境/工具检测 | `devTools.ts` |
| **WSL Manager** WSL 管理 | 发行版列表、启停、导入导出、文件浏览 | `wslManager.ts` |

### 5.6 安全（Security）

| 页面 | 核心能力 | 对应主进程模块 |
|---|---|---|
| **Network Security** 网络安全 | 网络安全检查与态势 | `networkMonitor.ts` |
| **Network Tracer** 网络追踪 | 实时连接、网络事件、域名解析、快照 | `networkTracer.ts` |
| **Packet Capture** 抓包 | 原始网络包捕获与分析 | `packetCapture.ts` |

---

## 6. 数据模型

数据库位于 `%APPDATA%/AgentSC/agentsc.db`，使用 WAL 模式。

### 6.1 核心表

| 表名 | 用途 | 关键字段 |
|---|---|---|
| `file_events` | 文件变更事件 | `type`, `path`, `size`, `process_name`, `process_id`, `drive`, `recorded_at`, `day` |
| `settings` | 键值配置 | `key`, `value` |
| `exclusion_rules` | 排除规则 | `pattern`, `reason`, `enabled`, `is_default` |
| `cleaner_rules` | 清理规则 | `name`, `type`, `target`, `schedule`, `enabled`, `last_run`, `next_run`, `source_subscription_id`, `external_id`, `patterns` |
| `cleaner_logs` | 清理执行日志 | `rule_id`, `type`, `status`, `freed_bytes`, `started_at`, `finished_at` |
| `app_logs` | 应用运行日志 | `level`, `module`, `message`, `details`, `created_at` |
| `scan_history` | 占用分析历史 | `target_path`, `total_size`, `items_scanned`, `result_json`, `created_at` |
| `scheduled_tasks` | 系统定时任务 | `name`, `action`, `schedule_type`, `schedule_value`, `params`, `enabled`, `last_run`, `next_run` |
| `hardware_cache` | 硬件信息缓存 | `info_json`, `hosts_json`, `updated_at` |
| `registry_ops` | 注册表操作定义 | `name`, `description`, `steps_json`, `last_applied`, `last_status` |
| `registry_history` | 注册表操作历史 | `op_id`, `action`, `status`, `backup_dir`, `backup_files` |
| `rule_subscriptions` | 清理规则订阅源 | `url`, `name`, `version`, `rules_json`, `enabled`, `last_sync` |

### 6.2 索引策略

- `idx_file_events_day`：按日聚合报告。
- `idx_file_events_type`：按事件类型过滤。
- `idx_file_events_recorded_at`：实时事件流倒序。
- `idx_file_events_day_process`：高频看板查询（Top 进程）。

### 6.3 配置项示例

| 配置键 | 说明 |
|---|---|
| `large_file_threshold_mb` | 大文件通知阈值（默认 100 MB） |
| `watcher_paths` | 监控路径列表 |
| `ai_provider` / `ai_model` / `ai_api_key` | AI 推理源配置 |
| `theme` / `language` | 主题与语言 |

---

## 7. IPC 通信

通过 `preload.ts` 暴露统一的 `window.electronAPI`：

```ts
window.electronAPI = {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
}
```

### 7.1 典型调用模式

| 模式 | 说明 | 示例 |
|---|---|---|
| `invoke` | 请求-响应，适合查询与执行 | `get-daily-stats`, `run-cleaner-rule` |
| `send` | 单向通知，无需返回 | 中止扫描、清除日志 |
| `on` | 主进程主动推送 | `file-events-batch`（实时事件流）、`toast-notification` |

### 7.2 IPC 命名空间示例

- `get-app-version`, `get-drives`, `get-disk-info`
- `get-recent-events`, `get-daily-stats`, `get-top-processes`, `get-daily-trend`
- `get-exclusion-rules`, `set-exclusion-rules`, `import-exclusion-rules`
- `start-watching`, `stop-watching`, `get-watcher-status`
- `scan-directory`, `abort-scan`
- `generate-ai-insights`, `scan-ai-cleanup`, `run-ai-cleanup`
- `run-cli`, `write-cli`, `kill-cli`, `clear-cli`

---

## 8. 核心流程

### 8.1 文件监控流程

```
用户配置监控路径
       │
       ▼
chokidar 挂载监听（含 heavy-dir 短路过滤）
       │
       ▼
recordEvent()：去重 → 获取文件大小 → 关联进程 → 生成 FileEventRow
       │
       ├────────────┬────────────┐
       ▼            ▼            ▼
  pendingEvents  pendingIpcEvents  大文件通知（立即）
       │            │
  2s 批量写入      500ms 批量推送
       │            │
       ▼            ▼
   SQLite        渲染进程 Dashboard
```

### 8.2 进程关联流程

```
文件事件路径
    │
    ▼
lookupProcess(path)
    │
    ├── ETW 模式：通过 Windows ETW 文件 I/O 事件匹配 PID
    ├── 快照模式：遍历进程打开句柄/路径快照
    └── 回退：未知进程
    │
    ▼
process_name + process_id 写入 file_events
```

### 8.3 AI 洞察流程

```
采集输入（最近事件、Top 进程、占用变化、清理日志）
            │
            ▼
    读取 AI 配置（Ollama / OpenAI）
            │
    ┌───────┴───────┐
    ▼               ▼
  Ollama         OpenAI
    │               │
    └───────┬───────┘
            ▼
    生成 summary / anomalies / suggestions
            │
            ▼
    失败则回退到启发式分析（heuristic）
```

### 8.4 定时清理流程

```
cleaner_rules / scheduled_tasks
            │
            ▼
    node-schedule 触发
            │
            ▼
    executeCleanerTask()
            │
    ┌───────┼───────┐
    ▼       ▼       ▼
 recycle  ie     temp/browser   custom
  _bin   history     cache      (patterns)
    │       │         │            │
    └───────┴─────────┴────────────┘
            │
            ▼
    写入 cleaner_logs（status, freed_bytes）
```

### 8.5 互联网规则订阅流程

```
用户粘贴 JSON 规则清单 URL
            │
            ▼
    下载校验（http/https, 15s 超时, 5MB 上限）
            │
            ▼
    预览规则 → 确认订阅
            │
            ▼
    写入 rule_subscriptions + cleaner_rules
            │
            ▼
    每日 03:07 自动同步开启自动更新的订阅
```

---

## 9. 构建与发布

### 9.1 脚本命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | Vite 开发模式 |
| `npm run build` | 类型检查 + Vite 构建 + electron-builder 打包 |
| `npm run build:win` | Windows 平台打包 |
| `npm run lint` | ESLint 检查 |
| `npm run preview` | Vite 预览 |

### 9.2 打包输出

- 构建产物：`out/main/main.js`、`out/preload/preload.es.js`、`out/renderer/`
- 安装包：`release/AgentSC-Setup-1.0.0.exe`
- 解压目录：`release/win-unpacked/`

### 9.3 关键打包配置

- 需要管理员权限：`requestedExecutionLevel: requireAdministrator`
- ASAR 解包原生模块：`better-sqlite3`、`chokidar`、`node-schedule`、`node-global-key-listener`
- 安装模式：非一键安装，允许修改安装目录，创建桌面快捷方式

---

## 10. 里程碑与演进

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 项目脚手架 + 暗色大屏看板框架 | 已完成 |
| M2 | 文件监控 + SQLite 存储 + 排除规则 | 已完成 |
| M3 | 进程关联 + 路径可视化 + 导出 | 已完成 |
| M4 | TreeMap 占用分析 | 已完成 |
| M5 | 日报 / 周报 / 月报 | 已完成 |
| M6 | 定时清理 + 规则订阅 | 已完成 |
| M7 | AI 洞察集成 | 已完成 |

### 10.1 当前已集成的扩展能力

- 系统维护工具集（任务管理器、硬件信息、注册表、证书、启动项、事件查看器等）
- 开发工具集（Ollama、CLI、WSL、DevTools）
- 网络安全工具集（网络追踪、抓包、网速测试、网络安全）
- 局域网共享与右键菜单/此电脑图标定制

### 10.2 已知限制

- 监控路径默认较保守，全磁盘监控需配合精细排除规则使用。
- 进程关联依赖 Windows ETW / 快照，部分场景可能标记为"未知进程"。
- AI 洞察效果受本地模型能力或云端 API 配额影响。

---

## 11. 参与贡献

1. **Fork 仓库** 并创建功能分支。
2. 遵循现有目录组织：新功能页面放在 `src/renderer/pages/`，主进程逻辑放在 `src/main/`。
3. 数据库变更需在 `src/main/db.ts` 的 `initSchema()` 中做幂等迁移。
4. 新增 IPC 时同步更新 `src/main/main.ts` 与调用方页面，保持命名一致。
5. 提交前运行 `npm run lint` 与 `npm run build`。

---

## 12. 相关文件

- 产品蓝图：[PLAN.md](./PLAN.md)
- 清理规则订阅示例：[example-cleanup-rules.json](./example-cleanup-rules.json)
- 包配置：[package.json](./package.json)
- 主进程入口：[src/main/main.ts](./src/main/main.ts)
- 渲染进程入口：[src/renderer/App.tsx](./src/renderer/App.tsx)
- 数据层：[src/main/db.ts](./src/main/db.ts)
