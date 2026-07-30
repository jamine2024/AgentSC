# AI 磁盘文件变更跟踪软件 - 执行蓝图

## 1. 项目目标
开发一款 Windows 桌面软件，实时监控系统所有磁盘的文件增删改，关联产生/删除文件的进程，按日/周/月汇总分析，并通过数据大屏看板可视化展示，支持定时清理与 AI 洞察。

## 2. 系统边界
- **支持平台**：Windows 10/11（主要依赖 Windows ETW / PowerShell / WMI 做进程关联）
- **监控范围**：所有本地 NTFS 磁盘（可配置排除系统路径、临时文件、缓存目录）
- **运行形态**：本地桌面应用，无需后端服务器
- **AI 能力**：可选本地模型（Ollama）或云端 API，用于异常检测与占用分析建议

## 3. 技术栈
| 层级 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 31 + Vite | 跨平台桌面窗口、系统托盘 |
| 前端 | React 18 + TypeScript + Tailwind CSS + Recharts | 沉浸式 MD 暗色大屏 |
| 前端组件库 | shadcn/ui | 表格、卡片、日期选择、弹窗 |
| 数据存储 | SQLite (better-sqlite3) | 本地事件、配置、日报数据 |
| 文件监控 | chokidar + ReadDirectoryChangesW（原生 Node-API 插件） | 低延迟文件变更捕获 |
| 进程关联 | Windows ETW（@otplib/node-etw 或自研 C++ N-API） | 文件 I/O 与 PID 关联 |
| 定时任务 | node-schedule | 回收站/IE/缓存清理 |
| 图表 | Recharts + ECharts TreeMap | 磁盘占比、趋势图 |
| AI 分析 | 可选 OpenAI / Ollama SDK | 生成日报摘要与异常提醒 |

## 4. 核心模块
1. **Watcher 服务**：挂载所有磁盘监听，实时写入 SQLite，应用排除规则。
2. **Process 关联器**：通过 ETW 文件 I/O 事件匹配路径 → PID → 进程名。
3. **TreeMap 分析器**：递归扫描目录大小，生成占用热力图。
4. **报告引擎**：按日/周/月聚合创建、修改、删除量，生成 PDF/Markdown/HTML 报告。
5. **排除管理器**：系统路径（Windows、ProgramData、$Recycle.Bin 等）与临时目录白名单。
6. **数据大屏看板**：实时心跳、磁盘读写速率、Top 活跃进程、最近大文件事件。
7. **定时清理器**：回收站清空、IE 历史、Temp / 浏览器缓存，支持自定义规则订阅。
8. **AI 洞察**：基于历史数据生成增长预测、异常告警、占用建议。

## 5. 目录结构（初稿）
```
AgentSC/
├── packages/
│   ├── main/               Electron 主进程
│   ├── renderer/           React 前端
│   └── native/             C++ N-API / PowerShell 监控插件
├── resources/              图标、静态资源
├── docs/                   设计稿与接口文档
└── PLAN.md
```

## 6. 里程碑
| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| M1 | 项目脚手架 + 暗色大屏看板框架 | 能启动，看到实时数据大屏 | ✅ 已完成 |
| M2 | 文件监控 + SQLite 存储 + 排除规则 | 新增/删除文件实时出现在事件流 | ✅ 已完成 |
| M3 | 进程关联 + 路径可视化 + 导出 | 事件详情能看到进程名，可导出 CSV/JSON | ✅ 已完成 |
| M4 | TreeMap 占用分析 | 可视化展示文件夹大小占比 | ✅ 已完成 |
| M5 | 日报/周报/月报 | 能生成并预览报告 | ✅ 已完成 |
| M6 | 定时清理 + 规则订阅 | 手动/自动执行清理任务 | ✅ 已完成 |
| M7 | AI 洞察集成 | 能给出占用建议与异常提示 | ✅ 已完成 |

## 7. M1 完成记录
- 已搭建 Electron 31 + Vite 5 + React 18 + TypeScript 工程。
- 已配置 Tailwind CSS 暗色 MD 沉浸式主题、glass 卡片、网格背景、动画。
- 已集成 better-sqlite3，设计 `file_events`、`settings`、`exclusion_rules` 表。
- 已实现基于 chokidar 的文件监控服务，支持创建/修改/删除事件入库并实时推送到前端。
- 已实现 IPC：`get-app-version`、`get-drives`、`get-disk-info`、`get-recent-events`、`get-daily-stats`、`get-top-processes`、`get-exclusion-rules`、`get-watcher-status`、`set-watching`。
- 数据大屏已接入真实磁盘信息、今日统计、最近事件流、实时心跳。
- 已通过 `npx tsc --noEmit` 与 `npx vite build` 构建验证。
- 验证方式：在监控目录创建测试文件后，SQLite 中成功记录事件，今日统计正确聚合。

## 8. 已知限制与下一步
- 当前默认仅监控项目目录，避免用户主目录权限风暴；全磁盘监控需在 M2 通过 UI 配置 + 更精细的系统路径排除实现。
- 进程名暂时显示“未知进程”，M3 将引入 Windows ETW 做文件 I/O 与进程关联。
- 其他模块（追踪路径、占用分析、汇报中心、定时清理、AI 洞察）已预留导航入口，待后续里程碑实现。

## 9. 互联网规则订阅（M6 扩展，2026-07-28）
- "定时清理"页新增「从互联网导入规则」能力：粘贴一份 JSON 规则清单 URL → 预览校验 → 订阅并导入；导入的规则带 `source_subscription_id`/`external_id`，可随时「同步」更新，退订时一并移除其规则。
- 远程清单格式见仓库根 `example-cleanup-rules.json`：`{ name, description, version, homepage, rules: [{ id, name, type, target?, patterns?, schedule, enabled }] }`。`type` 限 recycle_bin/ie_history/temp_dir/browser_cache/custom；custom 支持 `%VAR%`/`${VAR}` 路径与环境变量展开、`patterns` 逗号分隔 glob（仅删匹配文件，不删目录，更安全）。
- 抓取限制：仅 http/https、15s 超时、5MB 体积上限；启动后每日 03:07 自动同步开启自动更新的订阅源。
- 表结构变更：`rule_subscriptions` 新表；`cleaner_rules` 新增 `source_subscription_id/external_id/patterns` 三列（旧库升级由 `initSchema` 内迁移幂等处理）。
