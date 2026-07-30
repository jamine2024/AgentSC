// 系统软件卸载器主进程模块：读取 Windows 卸载注册表（HKLM/HKCU，含 WOW6432Node）
// 列出已安装程序，并启动其卸载命令。过滤系统组件、父项与更新补丁，仅展示
// 用户可卸载的应用。卸载命令直接来自注册表 UninstallString，由系统处理 UAC 提权。
import { spawn, execFile } from 'node:child_process'

export interface ProgramInfo {
  name: string
  version: string
  publisher: string
  installDate: string
  estimatedSize: number // KB
  uninstallString: string
  quietUninstallString: string
  installLocation: string
  displayIcon: string
  registryKey: string
}

const PROGRAMS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
);
Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object {
  [PSCustomObject]@{
    name = $_.DisplayName;
    version = $_.DisplayVersion;
    publisher = $_.Publisher;
    installDate = $_.InstallDate;
    estimatedSize = [int]$_.EstimatedSize;
    uninstallString = $_.UninstallString;
    quietUninstallString = $_.QuietUninstallString;
    installLocation = $_.InstallLocation;
    displayIcon = $_.DisplayIcon;
    systemComponent = [int]$_.SystemComponent;
    parentKeyName = $_.ParentKeyName;
    releaseType = $_.ReleaseType;
    registryKey = $_.PSPath
  }
} | ConvertTo-Json -Compress;
`

function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + script],
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32, timeout: timeoutMs },
      (err: Error | null, stdout: string) => {
        if (err) {
          if (stdout && stdout.trim()) resolve(stdout)
          else reject(err)
          return
        }
        resolve(stdout)
      },
    )
  })
}

function parseJsonArray<T>(s: string): T[] {
  const trimmed = (s || '').trim()
  if (!trimmed) return []
  try {
    const data = JSON.parse(trimmed)
    return (Array.isArray(data) ? data : [data]) as T[]
  } catch {
    return []
  }
}

const UPDATE_TYPES = new Set(['Update', 'Hotfix', 'Security Update', 'Security Update for', 'Update Rollup', 'Service Pack'])

export async function listPrograms(): Promise<ProgramInfo[]> {
  const raw = await runPowerShell(PROGRAMS_SCRIPT)
  const rows = parseJsonArray<any>(raw)
  const result = rows
    .filter((r) => {
      if (!r.name) return false
      if (Number(r.systemComponent) === 1) return false
      if (r.parentKeyName) return false
      if (r.releaseType && UPDATE_TYPES.has(String(r.releaseType))) return false
      // 无卸载命令且非静默卸载的项，用户无法卸载，跳过
      if (!r.uninstallString && !r.quietUninstallString) return false
      return true
    })
    .map((r) => ({
      name: String(r.name || ''),
      version: String(r.version || ''),
      publisher: String(r.publisher || ''),
      installDate: String(r.installDate || ''),
      estimatedSize: Number(r.estimatedSize) || 0,
      uninstallString: String(r.uninstallString || ''),
      quietUninstallString: String(r.quietUninstallString || ''),
      installLocation: String(r.installLocation || ''),
      displayIcon: String(r.displayIcon || ''),
      registryKey: String(r.registryKey || ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return result
}

export interface UninstallResult {
  ok: boolean
  launched: boolean
  error?: string
}

export async function uninstallProgram(
  payload: { uninstallString: string; quiet?: boolean },
): Promise<UninstallResult> {
  const { uninstallString, quiet } = payload
  let cmd = uninstallString
  // 若请求静默且存在 QuietUninstallString（多为 MsiExec /S 或程序自带静默参数），优先使用
  if (quiet && (payload as { quietUninstallString?: string }).quietUninstallString) {
    cmd = (payload as { quietUninstallString?: string }).quietUninstallString as string
  }
  if (!cmd || !cmd.trim()) {
    return { ok: false, launched: false, error: 'no-uninstall-string' }
  }
  try {
    const child = spawn('cmd.exe', ['/c', cmd], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true, launched: true }
  } catch (err) {
    return { ok: false, launched: false, error: String(err) }
  }
}
