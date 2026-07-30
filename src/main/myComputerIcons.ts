// 「我的电脑」(此电脑) 图标管理工具
// 枚举 HKCU 下 Explorer\MyComputer\NameSpace 与 DelegateFolders 中的 CLSID 图标，
// 识别常见网盘类图标（OneDrive / Dropbox / Google Drive / 百度网盘 等），
// 支持备份后删除（隐藏图标）与恢复。删除仅影响当前用户，无需管理员权限。
// 注意：图标变更后通常需重启「资源管理器」或注销后生效。
import { execFile } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type PcIconCategory = 'cloud' | 'folder' | 'system' | 'other'

export interface PcIcon {
  parent: 'NameSpace' | 'DelegateFolders'
  guid: string
  name: string
  category: PcIconCategory
  known: boolean
  description: string
}

export interface PcIconBackup {
  parent: 'NameSpace' | 'DelegateFolders'
  guid: string
  name: string
  removedAt: string
}

// 已知网盘 / 云存储 CLSID
const KNOWN_CLOUD_GUIDS: Record<string, string> = {
  '{018D5C66-4533-4307-9B53-224DE2ED1FE6}': 'OneDrive',
  '{E31EA727-12ED-4E34-8C8B-E7D9BF13A3C7}': 'Dropbox',
  '{A7AF0CC6-4E0A-4a3b-BE0A-D4B8C8E05698}': 'Google Drive',
  '{679F137C-3162-45da-BE3C-2F9C3D093F64}': '百度网盘',
  '{A2BBC9D6-26C0-4d84-8A8C-8E1D6F2C7E3B}': '坚果云',
  '{79FRF8B6-1A2C-4d9f-B8E3-3F5C7E2A1D9}': '',
}

// 名称关键字识别网盘类
const CLOUD_KEYWORDS = [
  'onedrive', 'dropbox', 'google drive', 'google 云端硬盘', '百度网盘', 'baidu',
  '坚果云', '腾讯微云', '微云', '天翼云', '360云盘', 'icloud', 'mega', 'box', 'pcloud',
  '115网盘', '迅雷云盘', '夸克网盘', '阿里云盘', '花瓣网盘', 'yun', '云盘', '云存储',
  'onedrive for business', 'nextcloud',
]

// 此电脑中常见的「文件夹」类固定图标（用户手动固定到快速访问/此电脑的库）
const FOLDER_KEYWORDS = ['文档', '图片', '音乐', '视频', '下载', 'desktop', 'documents', 'pictures', 'music', 'videos', 'downloads', '3d']

// 系统类（通常不应当删除）
const SYSTEM_KEYWORDS = ['此电脑', 'recycle', '回收站', '控制面板', 'control panel', '网络', 'network', '网上邻居']

function classify(guid: string, name: string): { category: PcIconCategory; known: boolean; description: string } {
  const g = (guid || '').toUpperCase()
  const lower = (name || '').toLowerCase()
  if (KNOWN_CLOUD_GUIDS[g] || CLOUD_KEYWORDS.some((k) => lower.includes(k))) {
    return { category: 'cloud', known: true, description: '网盘 / 云存储图标，可安全隐藏' }
  }
  if (SYSTEM_KEYWORDS.some((k) => lower.includes(k))) {
    return { category: 'system', known: true, description: '系统图标，一般不建议删除' }
  }
  if (FOLDER_KEYWORDS.some((k) => lower.includes(k))) {
    return { category: 'folder', known: true, description: '文件夹图标' }
  }
  return { category: 'other', known: false, description: name ? '' : '未知图标（可能已卸载但仍残留）' }
}

function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 16, timeout: timeoutMs },
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

// 三档回退解析图标显示名：
//  1) HKCR\CLSID\{GUID} 默认值（多数第三方云盘，如百度网盘）
//  2) HKCR\CLSID\{GUID} LocalizedString → SHLoadIndirectString 解析（@dll,-id 资源串）
//  3) 仍为空则用 Shell API：SHParseDisplayName("::{此电脑}\::{GUID}") + SHGetNameFromIDList
//     （系统文件夹 下载/音乐/文档/图片/视频 的真实本地化名只在这里能拿到）
// 注：强制 UTF-8 输出，否则 Windows PowerShell 5.1 按系统代码页（CP936）写 stdout，
//     Node utf-8 解码会把中文读成乱码/替换字符 → 前端渲染为豆腐方块。
const NAME_RESOLVER = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PcIconNameResolver {
  [DllImport("shlwapi.dll", CharSet=CharSet.Unicode)]
  public static extern int SHLoadIndirectString(string pszSource, StringBuilder pszOutBuf, int cchOutBuf, IntPtr ppvReserved);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern int SHParseDisplayName(string pszName, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern int SHGetNameFromIDList(IntPtr pidl, int sigdn, out IntPtr ppszName);
  [DllImport("shell32.dll")]
  public static extern void ILFree(IntPtr pidl);
  [DllImport("ole32.dll")]
  public static extern void CoTaskMemFree(IntPtr pv);
}
'@
function Resolve-PcIconName($guid) {
  $name=''
  foreach ($cp in @("HKCR:\\CLSID\\$guid","HKCR:\\Wow6432Node\\CLSID\\$guid")) {
    if (Test-Path $cp) {
      $v=(Get-ItemProperty -Path $cp -Name '(default)' -ErrorAction SilentlyContinue).'(default)'
      if ($v) { $name=[string]$v; break }
    }
  }
  if ($name) { return $name }
  $loc=''
  foreach ($cp in @("HKCR:\\CLSID\\$guid","HKCR:\\Wow6432Node\\CLSID\\$guid")) {
    if (Test-Path $cp) {
      $v=(Get-ItemProperty -Path $cp -Name 'LocalizedString' -ErrorAction SilentlyContinue).'LocalizedString'
      if ($v) { $loc=[string]$v; break }
    }
  }
  if ($loc) {
    $sb=New-Object System.Text.StringBuilder 1024
    $r=[PcIconNameResolver]::SHLoadIndirectString($loc, $sb, 1024, [IntPtr]::Zero)
    if ($r -eq 0 -and $sb.Length -gt 0) { return $sb.ToString() }
  }
  $thispc='{20D04FE0-3AEA-1069-A2D8-08002B30309D}'
  $pidl=[IntPtr]::Zero; $sfgao=[uint32]0
  $hr=[PcIconNameResolver]::SHParseDisplayName("::$thispc\\::$guid", [IntPtr]::Zero, [ref]$pidl, 0, [ref]$sfgao)
  if ($hr -eq 0 -and $pidl -ne [IntPtr]::Zero) {
    $psz=[IntPtr]::Zero
    $hr2=[PcIconNameResolver]::SHGetNameFromIDList($pidl, 0, [ref]$psz)
    if ($hr2 -eq 0 -and $psz -ne [IntPtr]::Zero) {
      $s=[System.Runtime.InteropServices.Marshal]::PtrToStringUni($psz)
      [PcIconNameResolver]::CoTaskMemFree($psz)
      [PcIconNameResolver]::ILFree($pidl)
      if ($s) { return $s }
    }
    [PcIconNameResolver]::ILFree($pidl)
  }
  return ''
}
`

const LIST_SCRIPT = NAME_RESOLVER + `
$parents = @(
  @{key='NameSpace'; path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace'},
  @{key='DelegateFolders'; path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\DelegateFolders'}
)
$out = @()
foreach ($p in $parents) {
  if (Test-Path $p.path) {
    Get-ChildItem $p.path | ForEach-Object {
      $guid = $_.PSChildName
      $name = Resolve-PcIconName $guid
      $out += [PSCustomObject]@{ parent=$p.key; guid=$guid; name=$name }
    }
  }
}
$out | ConvertTo-Json -Compress
`

export async function listPcIcons(): Promise<PcIcon[]> {
  const raw = await runPowerShell(LIST_SCRIPT)
  const rows = parseJsonArray<{ parent: string; guid: string; name: string }>(raw)
  return rows
    .filter((r) => r.guid)
    .map((r) => {
      const c = classify(r.guid, r.name)
      return {
        parent: (r.parent === 'DelegateFolders' ? 'DelegateFolders' : 'NameSpace') as 'NameSpace' | 'DelegateFolders',
        guid: r.guid,
        name: r.name || r.guid,
        category: c.category,
        known: c.known,
        description: c.description,
      }
    })
    .sort((a, b) => {
      const order = { cloud: 0, folder: 1, other: 2, system: 3 }
      const d = order[a.category] - order[b.category]
      if (d !== 0) return d
      return a.name.localeCompare(b.name)
    })
}

function backupFilePath(): string {
  const dir = path.join(app.getPath('userData'), 'agentsc-backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'pcicons.json')
}

function readBackups(): PcIconBackup[] {
  try {
    const raw = fs.readFileSync(backupFilePath(), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeBackups(list: PcIconBackup[]): void {
  fs.writeFileSync(backupFilePath(), JSON.stringify(list, null, 2), 'utf-8')
}

export async function removePcIcon(payload: { parent: 'NameSpace' | 'DelegateFolders'; guid: string }): Promise<{ ok: boolean; message: string; backedUp?: boolean }> {
  const { parent, guid } = payload
  if (!isValidParent(parent) || !isValidGuid(guid)) {
    return { ok: false, message: '非法的图标标识或位置' }
  }
  const base = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\${parent}`
  const keyPath = `${base}\\${guid}`
  // 删除前解析名称用于备份
  let name = guid
  try {
    const out = await runPowerShell(
      NAME_RESOLVER + `\nResolve-PcIconName '${guid}'`,
    )
    if (out && out.trim()) name = out.trim()
  } catch {
    /* ignore */
  }
  const script = `Remove-Item -Path '${keyPath}' -Recurse -Force`
  try {
    await runPowerShell(script)
    const backups = readBackups()
    if (!backups.some((b) => b.parent === parent && b.guid === guid)) {
      backups.push({ parent, guid, name, removedAt: new Date().toISOString() })
      writeBackups(backups)
    }
    return { ok: true, message: '已隐藏图标（重启资源管理器或注销后生效），已自动备份可恢复', backedUp: true }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function restorePcIcon(payload: { parent: 'NameSpace' | 'DelegateFolders'; guid: string }): Promise<{ ok: boolean; message: string }> {
  const { parent, guid } = payload
  if (!isValidParent(parent) || !isValidGuid(guid)) {
    return { ok: false, message: '非法的图标标识或位置' }
  }
  const keyPath = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\${parent}\\${guid}`
  const script = `New-Item -Path '${keyPath}' -Force | Out-Null`
  try {
    await runPowerShell(script)
    const backups = readBackups().filter((b) => !(b.parent === parent && b.guid === guid))
    writeBackups(backups)
    return { ok: true, message: '已恢复图标（重启资源管理器或注销后生效）' }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function listPcBackups(): Promise<PcIconBackup[]> {
  return readBackups()
}

// ═══════════════════════════════════════════════════════════════
// 自定义快捷入口（用户自行增删，真实注入「此电脑」）
// 实现方式：为每个入口生成一个 CLSID 命名空间扩展，挂到
//   HKCU\Software\Classes\CLSID\{guid} 与
//   HKCU\...\Explorer\MyComputer\NameSpace\{guid}
// 文件夹类型直接把真实路径作为 Target；其余类型（软件/网址/文件）
// 通过生成 .lnk 快捷方式作为 Target，使双击此电脑入口时按目标打开。
// 仅影响当前用户、无需管理员权限。
// ═══════════════════════════════════════════════════════════════

export type CustomEntryType = 'folder' | 'exe' | 'url' | 'file'

export interface CustomEntry {
  guid: string
  name: string
  type: CustomEntryType
  target: string
  iconPath?: string
  lnkPath?: string
  createdAt: string
}

function psStr(s: string): string {
  return (s ?? '').replace(/'/g, "''")
}

// 严格校验 CLSID 格式，拒绝任何注入字符（GUID 来自渲染进程，会被直接嵌入 PowerShell 单引号字符串）
function isValidGuid(g: unknown): g is string {
  return typeof g === 'string' && /^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/.test(g)
}

function isValidParent(p: unknown): p is 'NameSpace' | 'DelegateFolders' {
  return p === 'NameSpace' || p === 'DelegateFolders'
}

function customMetaPath(): string {
  const dir = path.join(app.getPath('userData'), 'agentsc-custom-entries')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'meta.json')
}

function readCustomEntries(): CustomEntry[] {
  try {
    const raw = fs.readFileSync(customMetaPath(), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeCustomEntries(list: CustomEntry[]): void {
  fs.writeFileSync(customMetaPath(), JSON.stringify(list, null, 2), 'utf-8')
}

export async function addCustomEntry(payload: {
  name: string
  type: CustomEntryType
  target: string
  iconPath?: string
}): Promise<{ ok: boolean; guid?: string; message: string }> {
  const name = (payload.name || '').trim()
  const target = (payload.target || '').trim()
  if (!name) return { ok: false, message: '名称不能为空' }
  if (!target) return { ok: false, message: '目标不能为空' }

  const guid = '{' + randomUUID().toUpperCase() + '}'
  const entriesDir = path.join(app.getPath('userData'), 'agentsc-custom-entries')
  if (!fs.existsSync(entriesDir)) fs.mkdirSync(entriesDir, { recursive: true })
  const lnkPath = path.join(entriesDir, guid + '.lnk')

  // 图标资源：自定义优先；否则按类型取系统默认
  let iconRes = (payload.iconPath || '').trim()
  if (!iconRes) {
    if (payload.type === 'folder') iconRes = '%SystemRoot%\\system32\\shell32.dll,-4'
    else if (payload.type === 'url') iconRes = '%SystemRoot%\\system32\\shell32.dll,-25'
    else iconRes = target // exe / file：用自身图标
  }

  // 注册表 Target：文件夹直接用真实路径；其余用 .lnk 以便启动
  let regTarget = target
  let createdLnk = false
  if (payload.type !== 'folder') {
    const lnkScript = `
$ErrorActionPreference='Stop'
$Wsh=New-Object -ComObject WScript.Shell
$sc=$Wsh.CreateShortcut('${psStr(lnkPath)}')
$sc.TargetPath='${psStr(target)}'
$sc.IconLocation='${psStr(iconRes)}'
$sc.Save()
`
    try {
      await runPowerShell(lnkScript)
      createdLnk = true
      regTarget = lnkPath
    } catch (e) {
      return { ok: false, message: '生成快捷方式失败：' + String(e) }
    }
  }

  const addScript = `
$ErrorActionPreference='Stop'
$guid='${guid}'
$clsid="HKCU:\\Software\\Classes\\CLSID\\$guid"
New-Item -Path $clsid -Force | Out-Null
Set-ItemProperty -Path $clsid -Name '(default)' -Value '${psStr(name)}'
New-Item -Path "$clsid\\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$clsid\\DefaultIcon" -Name '(default)' -Value '${psStr(iconRes)}'
New-Item -Path "$clsid\\InProcServer32" -Force | Out-Null
Set-ItemProperty -Path "$clsid\\InProcServer32" -Name '(default)' -Value '%SystemRoot%\\system32\\shell32.dll'
New-Item -Path "$clsid\\Instance\\InitPropertyBag" -Force | Out-Null
Set-ItemProperty -Path "$clsid\\Instance\\InitPropertyBag" -Name 'Target' -Value '${psStr(regTarget)}'
New-ItemProperty -Path "$clsid\\Instance\\InitPropertyBag" -Name 'Attributes' -Value 0x11 -PropertyType DWord | Out-Null
New-Item -Path "$clsid\\ShellFolder" -Force | Out-Null
New-ItemProperty -Path "$clsid\\ShellFolder" -Name 'Attributes' -Value 0xf080004d -PropertyType DWord | Out-Null
$ns="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace\\$guid"
New-Item -Path $ns -Force | Out-Null
Set-ItemProperty -Path $ns -Name '(default)' -Value ''
`
  try {
    await runPowerShell(addScript)
  } catch (e) {
    if (createdLnk && fs.existsSync(lnkPath)) {
      try { fs.unlinkSync(lnkPath) } catch { /* ignore */ }
    }
    return { ok: false, message: '写入注册表失败：' + String(e) }
  }

  const meta = readCustomEntries()
  meta.push({
    guid,
    name,
    type: payload.type,
    target,
    iconPath: (payload.iconPath || '').trim() || undefined,
    lnkPath: createdLnk ? lnkPath : undefined,
    createdAt: new Date().toISOString(),
  })
  writeCustomEntries(meta)

  return { ok: true, guid, message: '已添加到「此电脑」，重启资源管理器或注销后生效' }
}

export async function removeCustomEntry(guid: string): Promise<{ ok: boolean; message: string }> {
  if (!isValidGuid(guid)) return { ok: false, message: '非法的入口标识' }
  const meta = readCustomEntries()
  const entry = meta.find((e) => e.guid === guid)
  const removeScript = `
$ErrorActionPreference='Stop'
$guid='${guid}'
$clsid="HKCU:\\Software\\Classes\\CLSID\\$guid"
if (Test-Path $clsid) { Remove-Item -Path $clsid -Recurse -Force }
$ns="HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace\\$guid"
if (Test-Path $ns) { Remove-Item -Path $ns -Recurse -Force }
`
  try {
    await runPowerShell(removeScript)
  } catch (e) {
    return { ok: false, message: '删除注册表项失败：' + String(e) }
  }
  if (entry?.lnkPath && fs.existsSync(entry.lnkPath)) {
    try { fs.unlinkSync(entry.lnkPath) } catch { /* ignore */ }
  }
  writeCustomEntries(meta.filter((e) => e.guid !== guid))
  return { ok: true, message: '已删除入口' }
}

export async function listCustomEntries(): Promise<CustomEntry[]> {
  return readCustomEntries()
}
