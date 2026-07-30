// ───────────────────────────────────────────────────────────
// 开发工具管理器（主进程）
// - 检测系统已安装的开发类工具：IDE、SDK/运行时、数据库、构建、容器、包管理、云、VCS
// - 双重检测：CLI（which + 版本参数）与 Windows 卸载注册表（DisplayName/DisplayVersion/InstallLocation/Publisher）
// - 自动发现：扫描卸载注册表中匹配开发关键词的已安装程序
// - 输出：是否已安装、版本、安装位置、发布者
// ───────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import path from 'node:path'

export interface DevTool {
  id: string
  name: string
  category: string
  description?: string
  installed: boolean
  version: string | null
  installPath: string | null // 安装位置（目录或可执行文件）
  publisher?: string | null
  command?: string | null // 可启动的命令（CLI 工具）
  known: boolean // 是否来自内置注册表
  source: 'cli' | 'registry' | 'known' // 检测方式
}

interface DevRegistryEntry {
  id: string
  name: string
  category: string
  description?: string
  cli?: string // 命令名（用于 which + 版本探测）
  cliVersionArgs?: string[] // 自定义版本参数（覆盖默认候选）
  regName?: string // 注册表 DisplayName 子串匹配
}

// ── 内置开发工具注册表 ──
const DEV_REGISTRY: DevRegistryEntry[] = [
  // IDE / 编辑器
  { id: 'vscode', name: 'Visual Studio Code', category: 'ide', cli: 'code', regName: 'Visual Studio Code', description: '微软轻量级代码编辑器' },
  { id: 'visualstudio', name: 'Visual Studio', category: 'ide', regName: 'Visual Studio', description: '微软全功能 IDE' },
  { id: 'intellij', name: 'IntelliJ IDEA', category: 'ide', regName: 'IntelliJ IDEA', description: 'JetBrains Java/Kotlin IDE' },
  { id: 'pycharm', name: 'PyCharm', category: 'ide', regName: 'PyCharm', description: 'JetBrains Python IDE' },
  { id: 'webstorm', name: 'WebStorm', category: 'ide', regName: 'WebStorm', description: 'JetBrains Web IDE' },
  { id: 'rider', name: 'Rider', category: 'ide', regName: 'Rider', description: 'JetBrains .NET IDE' },
  { id: 'clion', name: 'CLion', category: 'ide', regName: 'CLion', description: 'JetBrains C/C++ IDE' },
  { id: 'androidstudio', name: 'Android Studio', category: 'ide', regName: 'Android Studio', description: '谷歌 Android 开发 IDE' },
  { id: 'eclipse', name: 'Eclipse', category: 'ide', regName: 'Eclipse', description: 'Eclipse 基金会 IDE' },
  { id: 'sublime', name: 'Sublime Text', category: 'ide', regName: 'Sublime Text', description: '轻量文本编辑器' },
  { id: 'notepadpp', name: 'Notepad++', category: 'ide', regName: 'Notepad++', description: 'Windows 源码编辑器' },
  { id: 'cursor', name: 'Cursor', category: 'ide', regName: 'Cursor', description: 'AI 驱动的代码编辑器' },
  { id: 'vim', name: 'Vim', category: 'ide', cli: 'vim', description: '终端文本编辑器' },

  // 运行时 / 语言 SDK
  { id: 'node', name: 'Node.js', category: 'runtime', cli: 'node', regName: 'Node.js', description: 'JavaScript 运行时' },
  { id: 'python', name: 'Python', category: 'runtime', cli: 'python', regName: 'Python', description: 'Python 解释器' },
  { id: 'python3', name: 'Python 3', category: 'runtime', cli: 'python3', description: 'Python 3 解释器' },
  { id: 'java', name: 'Java', category: 'runtime', cli: 'java', regName: 'Java', description: 'Java 运行时' },
  { id: 'javac', name: 'Javac', category: 'sdk', cli: 'javac', description: 'Java 编译器' },
  { id: 'dotnet', name: '.NET SDK', category: 'sdk', cli: 'dotnet', regName: '.NET', description: '微软 .NET SDK' },
  { id: 'go', name: 'Go', category: 'sdk', cli: 'go', regName: 'Go', cliVersionArgs: ['version'], description: 'Go 语言工具链' },
  { id: 'rustc', name: 'Rustc', category: 'sdk', cli: 'rustc', regName: 'Rust', description: 'Rust 编译器' },
  { id: 'cargo', name: 'Cargo', category: 'sdk', cli: 'cargo', description: 'Rust 包管理器' },
  { id: 'ruby', name: 'Ruby', category: 'runtime', cli: 'ruby', regName: 'Ruby', description: 'Ruby 解释器' },
  { id: 'php', name: 'PHP', category: 'runtime', cli: 'php', regName: 'PHP', description: 'PHP 解释器' },
  { id: 'perl', name: 'Perl', category: 'runtime', cli: 'perl', description: 'Perl 解释器' },
  { id: 'lua', name: 'Lua', category: 'runtime', cli: 'lua', description: 'Lua 解释器' },
  { id: 'bun', name: 'Bun', category: 'runtime', cli: 'bun', description: 'All-in-one JS 运行时' },
  { id: 'deno', name: 'Deno', category: 'runtime', cli: 'deno', description: '安全的 JS/TS 运行时' },
  { id: 'flutter', name: 'Flutter', category: 'sdk', cli: 'flutter', regName: 'Flutter', description: '谷歌 UI 工具包' },
  { id: 'dart', name: 'Dart', category: 'sdk', cli: 'dart', regName: 'Dart', description: 'Dart 语言 SDK' },
  { id: 'kotlinc', name: 'Kotlin', category: 'sdk', cli: 'kotlinc', regName: 'Kotlin', description: 'Kotlin 编译器' },
  { id: 'scala', name: 'Scala', category: 'sdk', cli: 'scala', regName: 'Scala', description: 'Scala 语言' },
  { id: 'clang', name: 'Clang', category: 'sdk', cli: 'clang', regName: 'LLVM', description: 'LLVM C/C++ 编译器' },

  // 数据库
  { id: 'mysql', name: 'MySQL', category: 'db', cli: 'mysql', regName: 'MySQL', description: 'MySQL 客户端' },
  { id: 'psql', name: 'PostgreSQL', category: 'db', cli: 'psql', regName: 'PostgreSQL', description: 'PostgreSQL 客户端' },
  { id: 'sqlite3', name: 'SQLite', category: 'db', cli: 'sqlite3', description: 'SQLite 命令行客户端' },
  { id: 'mongosh', name: 'MongoDB Shell', category: 'db', cli: 'mongosh', regName: 'MongoDB', description: 'MongoDB Shell' },
  { id: 'rediscli', name: 'Redis CLI', category: 'db', cli: 'redis-cli', regName: 'Redis', description: 'Redis 客户端' },
  { id: 'pgadmin', name: 'pgAdmin', category: 'db', regName: 'pgAdmin', description: 'PostgreSQL 管理工具' },
  { id: 'mysqlwb', name: 'MySQL Workbench', category: 'db', regName: 'MySQL Workbench', description: 'MySQL 可视化管理' },
  { id: 'dbeaver', name: 'DBeaver', category: 'db', regName: 'DBeaver', description: '通用数据库客户端' },

  // 构建工具
  { id: 'cmake', name: 'CMake', category: 'build', cli: 'cmake', regName: 'CMake', description: '跨平台构建系统' },
  { id: 'make', name: 'Make', category: 'build', cli: 'make', description: '构建自动化工具' },
  { id: 'gradle', name: 'Gradle', category: 'build', cli: 'gradle', regName: 'Gradle', description: 'JVM 构建工具' },
  { id: 'mvn', name: 'Maven', category: 'build', cli: 'mvn', regName: 'Maven', cliVersionArgs: ['-v'], description: 'Java 项目构建工具' },
  { id: 'ninja', name: 'Ninja', category: 'build', cli: 'ninja', description: '小型构建系统' },
  { id: 'qmake', name: 'Qt', category: 'build', cli: 'qmake', regName: 'Qt', description: 'Qt 应用框架' },
  { id: 'bazel', name: 'Bazel', category: 'build', cli: 'bazel', regName: 'Bazel', description: 'Google 构建工具' },

  // 容器 / 编排
  { id: 'docker', name: 'Docker', category: 'container', cli: 'docker', regName: 'Docker Desktop', description: '容器引擎' },
  { id: 'dockercompose', name: 'Docker Compose', category: 'container', cli: 'docker-compose', description: '多容器编排' },
  { id: 'podman', name: 'Podman', category: 'container', cli: 'podman', description: '无守护进程容器引擎' },
  { id: 'kubectl', name: 'Kubectl', category: 'container', cli: 'kubectl', regName: 'Kubernetes', description: 'Kubernetes 命令行' },
  { id: 'helm', name: 'Helm', category: 'container', cli: 'helm', description: 'Kubernetes 包管理' },
  { id: 'vagrant', name: 'Vagrant', category: 'container', cli: 'vagrant', description: '虚拟机环境管理' },
  { id: 'wsl', name: 'WSL', category: 'container', cli: 'wsl', regName: 'WSL', description: 'Windows 子系统 Linux' },

  // 包管理
  { id: 'npm', name: 'npm', category: 'package', cli: 'npm', description: 'Node 包管理器' },
  { id: 'pnpm', name: 'pnpm', category: 'package', cli: 'pnpm', description: '快速 Node 包管理器' },
  { id: 'yarn', name: 'Yarn', category: 'package', cli: 'yarn', description: 'Node 包管理器' },
  { id: 'pip', name: 'pip', category: 'package', cli: 'pip', description: 'Python 包管理器' },
  { id: 'composer', name: 'Composer', category: 'package', cli: 'composer', description: 'PHP 依赖管理器' },
  { id: 'gem', name: 'RubyGems', category: 'package', cli: 'gem', description: 'Ruby 包管理器' },
  { id: 'nuget', name: 'NuGet', category: 'package', cli: 'nuget', description: '.NET 包管理器' },
  { id: 'vcpkg', name: 'vcpkg', category: 'package', cli: 'vcpkg', regName: 'vcpkg', description: 'C++ 包管理器' },
  { id: 'conan', name: 'Conan', category: 'package', cli: 'conan', description: 'C/C++ 包管理器' },
  { id: 'winget', name: 'WinGet', category: 'package', cli: 'winget', regName: 'App Installer', description: 'Windows 包管理器' },
  { id: 'choco', name: 'Chocolatey', category: 'package', cli: 'choco', regName: 'Chocolatey', description: 'Windows 包管理器' },
  { id: 'scoop', name: 'Scoop', category: 'package', cli: 'scoop', regName: 'Scoop', description: 'Windows 命令行包管理器' },

  // 云 / IaC
  { id: 'az', name: 'Azure CLI', category: 'cloud', cli: 'az', regName: 'Azure CLI', description: '微软云命令行' },
  { id: 'aws', name: 'AWS CLI', category: 'cloud', cli: 'aws', regName: 'AWS', description: '亚马逊云命令行' },
  { id: 'gcloud', name: 'gcloud', category: 'cloud', cli: 'gcloud', regName: 'Google Cloud', description: '谷歌云命令行' },
  { id: 'terraform', name: 'Terraform', category: 'cloud', cli: 'terraform', regName: 'Terraform', cliVersionArgs: ['version'], description: '基础设施即代码' },
  { id: 'serverless', name: 'Serverless', category: 'cloud', cli: 'serverless', description: 'Serverless 框架' },

  // 版本控制
  { id: 'git', name: 'Git', category: 'vcs', cli: 'git', regName: 'Git', description: '分布式版本控制系统' },
  { id: 'gh', name: 'GitHub CLI', category: 'vcs', cli: 'gh', regName: 'GitHub CLI', description: 'GitHub 官方命令行工具' },
  { id: 'svn', name: 'Subversion', category: 'vcs', cli: 'svn', regName: 'Subversion', description: '集中式版本控制系统' },
  { id: 'tortoisegit', name: 'TortoiseGit', category: 'vcs', regName: 'TortoiseGit', description: 'Windows Git 外壳集成' },
]

// 注册表自动发现：DisplayName 命中以下关键词视为开发类工具
const DEV_HINTS = [
  'Visual Studio', 'IntelliJ', 'PyCharm', 'WebStorm', 'Rider', 'CLion', 'Android Studio',
  'Eclipse', 'Sublime Text', 'Notepad++', 'Cursor', 'JetBrains', 'Git', 'Node.js', 'Nodejs',
  'Python', 'Ruby', 'Perl', 'PHP', 'Go ', 'Golang', 'Rust', 'Java', 'OpenJDK', 'Corretto',
  'GraalVM', 'Docker', 'Kubernetes', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite',
  'pgAdmin', 'DBeaver', 'MySQL Workbench', 'CMake', 'Maven', 'Gradle', 'Qt', '.NET',
  'Terraform', 'HashiCorp', 'Azure CLI', 'AWS', 'Google Cloud', 'Chocolatey', 'Scoop',
  'vcpkg', 'Conan', 'WSL', 'TortoiseGit', 'NVIDIA CUDA', 'Android SDK', 'Flutter', 'Dart',
  'Lua', 'Clang', 'LLVM', 'MinGW', 'Cygwin', 'Bazel', 'Scala', 'Kotlin', 'Haskell',
  'Elixir', 'Erlang', 'Anaconda', 'Miniconda', 'Conda', 'GitKraken', 'Sourcetree', 'Fork',
  'Beyond Compare', 'WinMerge', 'Postman', 'Insomnia', 'JMeter', 'Vue', 'Yarn', 'Nim',
  'Visual C++',
]

const VERSION_ARGS_CANDIDATES = ['--version', '-v', '-V', 'version', '--help']
const REG_ROOTS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]
const MAX_DISCOVERED = 150

let cache: DevTool[] | null = null
let regCache: RegEntry[] | null = null

interface RegEntry {
  displayName: string
  displayVersion: string | null
  installLocation: string | null
  publisher: string | null
  uninstallString: string | null
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function looksLikeVersion(s: string): boolean {
  const t = (s || '').trim()
  if (!t) return false
  return /v?\d+\.\d+/.test(t) || /version/i.test(t.slice(0, 60))
}

// 通过 cmd /c where 定位命令完整路径（Windows）
function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('cmd', ['/c', 'where', command], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      const preferred = lines.find((l) => /\.(exe|cmd|bat|ps1)$/i.test(l)) || lines[0]
      resolve(preferred || null)
    })
  })
}

function runCapture(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      settled = true
      const out = `${stdout || ''}${stderr || ''}`.trim()
      if (out) return resolve(out)
      reject(err || new Error('no output'))
    })
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        reject(e)
      }
    })
  })
}

async function resolveVersion(_command: string, exePath: string, override?: string[]): Promise<string | null> {
  const argsList = override ? [override] : VERSION_ARGS_CANDIDATES.map((a) => [a])
  for (const a of argsList) {
    try {
      const out = await runCapture(exePath, a, 4000)
      const firstLine = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''
      if (looksLikeVersion(firstLine)) return firstLine.replace(/\s+/g, ' ').slice(0, 80)
      const m = out.match(/[vV]?\d+\.\d+\.\d+[\w.-]*/)
      if (m) return m[0].slice(0, 80)
    } catch {
      // 尝试下一个候选参数
    }
  }
  return null
}

// 解析 reg query /s 输出
function parseRegQuery(output: string): RegEntry[] {
  const entries: RegEntry[] = []
  let cur: Partial<RegEntry> | null = null
  const lines = output.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '')
    if (!line) {
      if (cur) {
        if (cur.displayName) entries.push(cur as RegEntry)
        cur = null
      }
      continue
    }
    if (/^HKEY_/i.test(line)) {
      if (cur && cur.displayName) entries.push(cur as RegEntry)
      cur = {}
      continue
    }
    // 值行：Name <TAB/多空格> REG_TYPE <TAB/多空格> Value
    const m = line.match(/^([^\t]+?)\s{2,}(REG_[A-Z]+)\s+(.*)$/)
    if (m && cur) {
      const key = m[1].trim()
      const value = m[3].trim()
      if (key === 'DisplayName') cur.displayName = value
      else if (key === 'DisplayVersion') cur.displayVersion = value || null
      else if (key === 'InstallLocation') cur.installLocation = value || null
      else if (key === 'Publisher') cur.publisher = value || null
      else if (key === 'UninstallString') cur.uninstallString = value || null
    }
  }
  if (cur && cur.displayName) entries.push(cur as RegEntry)
  return entries
}

// 读取卸载注册表（缓存）
async function loadRegistryEntries(): Promise<RegEntry[]> {
  if (regCache) return regCache
  const results: RegEntry[] = []
  await Promise.all(
    REG_ROOTS.map(
      (root) =>
        new Promise<void>((resolve) => {
          execFile('cmd', ['/c', 'reg', 'query', root, '/s'], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
            if (!err && stdout) results.push(...parseRegQuery(stdout))
            resolve()
          })
        }),
    ),
  )
  regCache = results
  return results
}

function findReg(entries: RegEntry[], keyword: string): RegEntry | undefined {
  const kw = keyword.toLowerCase()
  const matches = entries.filter((e) => e.displayName && e.displayName.toLowerCase().includes(kw))
  if (matches.length === 0) return undefined
  // 优先选择 displayName 以关键词开头的（更精确）
  const prefixed = matches.find((e) => e.displayName!.toLowerCase().startsWith(kw))
  return prefixed || matches[0]
}

// 从卸载命令提取可执行文件所在目录
function exeDirFromUninstall(uninstallString: string | null): string | null {
  if (!uninstallString) return null
  const m = uninstallString.match(/"([^"]+\.exe)"|(\S+\.exe)/i)
  if (!m) return null
  const exe = (m[1] || m[2]).trim()
  try {
    return path.dirname(exe)
  } catch {
    return null
  }
}

function devHintMatch(name: string): boolean {
  const low = name.toLowerCase()
  return DEV_HINTS.some((h) => low.includes(h.toLowerCase()))
}

function guessCategory(name: string): string {
  const low = name.toLowerCase()
  if (/(studio|intellij|pycharm|webstorm|rider|clion|eclipse|sublime|notepad\+\+|cursor|idea|code|vim|atom|netbeans)/.test(low)) return 'ide'
  if (/(postgres|mysql|mongo|redis|sqlite|oracle|db|sql|dbeaver|pgadmin|workbench|navicat|heidisql)/.test(low)) return 'db'
  if (/(cmake|maven|gradle|make|ninja|qmake|bazel|msbuild|ant|gulp|grunt|webpack|vite|rollup)/.test(low)) return 'build'
  if (/(docker|kubernetes|kubectl|podman|helm|vagrant|containerd|wsl)/.test(low)) return 'container'
  if (/(nuget|npm|yarn|pnpm|pip|composer|gem|choco|scoop|winget|vcpkg|conan|paket|cargo|brew)/.test(low)) return 'package'
  if (/(azure|aws|gcloud|terraform|serverless|cloud|aliyun|tencentcloud|oci)/.test(low)) return 'cloud'
  if (/(git|svn|mercurial|hg\b|tortoise|fork|sourcetree|gitkraken)/.test(low)) return 'vcs'
  if (/(java|python|node|ruby|perl|php|go |golang|rust|lua|dart|kotlin|scala|dotnet|\.net|clang|llvm|jdk|jre|sdk|anaconda|conda)/.test(low)) return 'sdk'
  return 'other'
}

function mk(e: DevRegistryEntry, installed: boolean, version: string | null, installPath: string | null, publisher: string | null, source: DevTool['source'], command?: string | null): DevTool {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    description: e.description,
    installed,
    version,
    installPath,
    publisher,
    command: command ?? null,
    known: true,
    source,
  }
}

export async function detectDevTools(force = false): Promise<DevTool[]> {
  if (cache && !force) return cache
  const entries = await loadRegistryEntries()
  const matchedNames = new Set<string>()

  const knownResults = await Promise.all(
    DEV_REGISTRY.map(async (e): Promise<DevTool> => {
      // CLI 检测优先
      if (e.cli) {
        const exePath = await which(e.cli)
        if (exePath) {
          const version = await resolveVersion(e.cli, exePath, e.cliVersionArgs)
          const reg = e.regName ? findReg(entries, e.regName) : undefined
          const installPath = reg?.installLocation || exePath
          const publisher = reg?.publisher || null
          if (reg) matchedNames.add(normalize(reg.displayName))
          return mk(e, true, version ?? reg?.displayVersion ?? null, installPath, publisher, 'cli', e.cli)
        }
      }
      // 注册表检测
      if (e.regName) {
        const reg = findReg(entries, e.regName)
        if (reg) {
          matchedNames.add(normalize(reg.displayName))
          const installPath = reg.installLocation || exeDirFromUninstall(reg.uninstallString)
          return mk(e, true, reg.displayVersion, installPath, reg.publisher, 'registry')
        }
      }
      return mk(e, false, null, null, null, 'known')
    }),
  )

  // 注册表自动发现
  const discovered: DevTool[] = []
  for (const r of entries) {
    if (!r.displayName) continue
    if (matchedNames.has(normalize(r.displayName))) continue
    if (!devHintMatch(r.displayName)) continue
    const installPath = r.installLocation || exeDirFromUninstall(r.uninstallString)
    discovered.push({
      id: 'disc-' + Buffer.from(normalize(r.displayName)).toString('hex').slice(0, 16),
      name: r.displayName,
      category: guessCategory(r.displayName),
      installed: true,
      version: r.displayVersion,
      installPath,
      publisher: r.publisher,
      command: null,
      known: false,
      source: 'registry',
    })
    if (discovered.length >= MAX_DISCOVERED) break
  }

  const merged = [...knownResults, ...discovered].sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  cache = merged
  return merged
}

// 显式清除缓存（进程退出或强制刷新时可选调用）
export function clearDevToolsCache() {
  cache = null
  regCache = null
}
