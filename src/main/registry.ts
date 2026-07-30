import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app, shell } from 'electron'
import {
  getRegistryOpById,
  addRegistryHistory,
  getRegistryHistory,
  setRegistryOpResult,
  type RegistryStep,
  type RegistryHistoryEntry,
} from './db'

// 注册表操作依赖 Windows 的 reg.exe，非 Windows 平台优雅降级。
export const isRegistrySupported = process.platform === 'win32'

const backupRoot = path.join(app.getPath('userData'), 'AgentSC', 'registry-backups')

interface RegResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

// 通过 reg.exe 执行一条命令并收集输出（带超时保护）。
function runReg(args: string[], timeout = 30000): Promise<RegResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn('reg', args, { windowsHide: true, shell: false })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve({ ok: false, code: null, stdout, stderr: stderr + '\n[timeout]' })
      }
    }, timeout)
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, code: null, stdout, stderr: stderr + '\n' + e.message })
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: code === 0, code, stdout, stderr })
      }
    })
  })
}

function hiveKey(step: RegistryStep): string {
  return `${step.hive}\\${step.key}`
}

// 备份单个注册表项到 .reg 文件；项不存在（如新建项）则返回 null。
async function backupKey(hk: string, dir: string, fileBase: string): Promise<string | null> {
  const outFile = path.join(dir, fileBase + '.reg')
  const res = await runReg(['export', hk, outFile, '/y'], 20000)
  if (res.ok && fs.existsSync(outFile)) return outFile
  return null
}

function applyArgs(step: RegistryStep): string[] {
  const hk = hiveKey(step)
  if (step.action === 'deleteKey') {
    return ['delete', hk, '/f']
  }
  const valueFlag = step.valueName ? ['/v', step.valueName] : ['/ve']
  if (step.action === 'delete') {
    return ['delete', hk, ...valueFlag, '/f']
  }
  // set
  const type = step.type || 'REG_SZ'
  return ['add', hk, ...valueFlag, '/t', type, '/d', step.data ?? '', '/f']
}

export interface ApplyStepResult {
  step: RegistryStep
  ok: boolean
  error?: string
}

export interface ApplyOutput {
  ok: boolean
  notSupported?: boolean
  error?: string
  status?: 'success' | 'failed' | 'partial'
  applied: number
  failed: number
  backups: string[]
  results: ApplyStepResult[]
}

// 应用一个注册表操作：先对每个受影响项自动备份，再逐条执行，最后记录历史。
export async function applyRegistryOp(id: number): Promise<ApplyOutput> {
  if (!isRegistrySupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统', applied: 0, failed: 0, backups: [], results: [] }
  const op = getRegistryOpById(id)
  if (!op) return { ok: false, error: '未找到该注册表操作', applied: 0, failed: 0, backups: [], results: [] }

  fs.mkdirSync(backupRoot, { recursive: true })
  const ts = Date.now()
  const dir = path.join(backupRoot, `op-${id}-${ts}`)
  fs.mkdirSync(dir, { recursive: true })

  const backups: string[] = []
  const results: ApplyStepResult[] = []
  for (let i = 0; i < op.steps.length; i++) {
    const step = op.steps[i]
    const hk = hiveKey(step)
    const bk = await backupKey(hk, dir, `step-${i}`)
    if (bk) backups.push(bk)
    const res = await runReg(applyArgs(step), 20000)
    results.push({
      step,
      ok: res.ok,
      error: res.ok ? undefined : (res.stderr || res.stdout || `退出码 ${res.code}`).trim(),
    })
  }

  const applied = results.filter((r) => r.ok).length
  const failed = results.length - applied
  const status: 'success' | 'failed' | 'partial' = failed === 0 ? 'success' : applied === 0 ? 'failed' : 'partial'
  addRegistryHistory({
    opId: id,
    opName: op.name,
    action: 'apply',
    status,
    message: `已应用 ${applied} 项，失败 ${failed} 项`,
    backupDir: dir,
    backupFiles: JSON.stringify(backups),
  })
  setRegistryOpResult(id, ts, status)
  return { ok: status !== 'failed', status, applied, failed, backups, results }
}

export interface RollbackOutput {
  ok: boolean
  notSupported?: boolean
  error?: string
  status?: 'success' | 'failed' | 'partial'
  imported: number
  failed: number
}

// 回滚：导入该操作最近一次成功应用时生成的备份 .reg 文件。
export async function rollbackRegistryOp(id: number): Promise<RollbackOutput> {
  if (!isRegistrySupported)
    return { ok: false, notSupported: true, error: '仅支持 Windows 系统', imported: 0, failed: 0 }
  const op = getRegistryOpById(id)
  if (!op) return { ok: false, error: '未找到该注册表操作', imported: 0, failed: 0 }

  const candidate = getRegistryHistory(200).find(
    (h: RegistryHistoryEntry) =>
      h.opId === id && h.action === 'apply' && (h.status === 'success' || h.status === 'partial') && h.backupFiles,
  )
  if (!candidate || !candidate.backupFiles) return { ok: false, error: '没有可用于回滚的备份', imported: 0, failed: 0 }

  let files: string[] = []
  try {
    files = JSON.parse(candidate.backupFiles) as string[]
  } catch {
    /* ignore */
  }
  files = Array.isArray(files) ? files.filter((f) => f && fs.existsSync(f)) : []
  if (files.length === 0) return { ok: false, error: '备份文件已不存在，无法回滚', imported: 0, failed: 0 }

  const imported: string[] = []
  const failedFiles: string[] = []
  for (const f of files) {
    const res = await runReg(['import', f], 20000)
    if (res.ok) imported.push(f)
    else failedFiles.push(f)
  }
  const status: 'success' | 'failed' | 'partial' =
    failedFiles.length === 0 ? 'success' : imported.length === 0 ? 'failed' : 'partial'
  addRegistryHistory({
    opId: id,
    opName: op.name,
    action: 'rollback',
    status,
    message: `已回滚 ${imported.length} 项，失败 ${failedFiles.length} 项`,
    backupDir: candidate.backupDir || undefined,
    backupFiles: JSON.stringify(files),
  })
  setRegistryOpResult(id, Date.now(), status)
  return { ok: status !== 'failed', status, imported: imported.length, failed: failedFiles.length }
}

export interface QueryOutput {
  ok: boolean
  notSupported?: boolean
  error?: string
  exists: boolean
  raw: string
}

// 读取某一步骤当前在注册表中的实际值，供界面核对（只读，不通改）。
export async function queryRegistryStep(step: RegistryStep): Promise<QueryOutput> {
  if (!isRegistrySupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统', exists: false, raw: '' }
  const hk = hiveKey(step)
  let res: RegResult
  if (step.action === 'deleteKey') {
    res = await runReg(['query', hk], 15000)
    return { ok: true, exists: res.ok, raw: (res.stdout || res.stderr).trim() }
  }
  const valueFlag = step.valueName ? ['/v', step.valueName] : ['/ve']
  res = await runReg(['query', hk, ...valueFlag], 15000)
  return { ok: true, exists: res.ok, raw: (res.stdout || res.stderr).trim() }
}

// 打开备份目录（文件管理器）。
export async function openBackupDir(): Promise<{ ok: boolean }> {
  fs.mkdirSync(backupRoot, { recursive: true })
  try {
    await shell.openPath(backupRoot)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function getBackupRoot(): string {
  return backupRoot
}

// 供页面在创建示例操作时复用：插入一条示例注册表操作（默认禁用，需用户手动应用）。
export function buildExampleOp(): { name: string; description: string; enabled: boolean; steps: RegistryStep[] } {
  return {
    name: '示例：为 .txt 文件添加右键「用记事本打开」',
    description: '演示操作（默认禁用）。应用后会为 .txt 文件在右键菜单添加「用记事本打开」项；可随时一键回滚。',
    enabled: false,
    steps: [
      {
        hive: 'HKCR',
        key: 'SystemFileAssociations\\.txt\\shell\\open_notepad',
        valueName: '',
        action: 'set',
        type: 'REG_SZ',
        data: '用记事本打开',
      },
      {
        hive: 'HKCR',
        key: 'SystemFileAssociations\\.txt\\shell\\open_notepad\\command',
        valueName: '',
        action: 'set',
        type: 'REG_SZ',
        data: 'notepad.exe "%1"',
      },
    ],
  }
}
