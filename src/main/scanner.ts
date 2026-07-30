import fs from 'node:fs'
import path from 'node:path'
import { isPathExcluded } from './db'

export interface ScanNode {
  name: string
  path: string
  size: number
  children?: ScanNode[]
}

export interface ScanProgress {
  phase: 'scanning' | 'done'
  currentPath: string
  itemsScanned: number
  currentSize: number
  topDirs: { name: string; size: number }[]
}

let abortFlag = false

interface ScanContext {
  itemsScanned: number
  currentSize: number
  lastProgressTime: number
  topDirs: Map<string, number>
  onProgress?: (progress: ScanProgress) => void
}

// 每批并行处理的文件数
const BATCH_SIZE = 32

function shouldSkip(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.includes('node_modules')) return true
  if (lower.includes('.git')) return true
  if (isPathExcluded(filePath)) return true
  return false
}

function tryEmitProgress(ctx: ScanContext, currentPath: string) {
  const now = Date.now()
  if (now - ctx.lastProgressTime > 80 && ctx.onProgress) {
    ctx.lastProgressTime = now
    const topDirs = Array.from(ctx.topDirs.entries())
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
    ctx.onProgress({
      phase: 'scanning',
      currentPath,
      itemsScanned: ctx.itemsScanned,
      currentSize: ctx.currentSize,
      topDirs,
    })
  }
}

/**
 * 将 entries 分批并行处理，每批 BATCH_SIZE 个并发。
 * 每批内用 Promise.all 并行处理，批次间串行执行。
 */
async function processEntriesParallel<T>(
  entries: fs.Dirent[],
  dirPath: string,
  handler: (entry: fs.Dirent, childPath: string) => Promise<T>,
  signalCheck: () => boolean,
): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    if (signalCheck()) break
    const batch = entries.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const childPath = path.join(dirPath, entry.name)
        return handler(entry, childPath)
      }),
    )
    results.push(...batchResults)
  }
  return results
}

async function getDirSize(dirPath: string, depth: number, maxDepth: number, ctx: ScanContext): Promise<ScanNode> {
  if (abortFlag) {
    return { name: path.basename(dirPath), path: dirPath, size: 0 }
  }

  const name = path.basename(dirPath) || dirPath
  const node: ScanNode = { name, path: dirPath, size: 0 }

  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  } catch {
    return node
  }
  const validEntries = entries.filter((e) => {
    const childPath = path.join(dirPath, e.name)
    return !shouldSkip(childPath)
  })

  // 统一收集子项：目录与文件都生成为节点，使大文件也能进入排行与热力图。
  // 注意 ctx.currentSize 的累计规则：
  //  - 文件：在此处直接累加；
  //  - 子目录：由 getDirSize / getFolderSize 内部累加，这里不再重复加。
  const collected = await processEntriesParallel(
    validEntries,
    dirPath,
    async (entry, childPath) => {
      ctx.itemsScanned++
      tryEmitProgress(ctx, childPath)
      try {
        if (entry.isDirectory()) {
          if (depth + 1 >= maxDepth) {
            // 末级目录：平铺统计其整体大小，作为叶子节点（不再递归建树）
            const size = await getFolderSize(childPath, ctx)
            return { name: entry.name, path: childPath, size }
          }
          const child = await getDirSize(childPath, depth + 1, maxDepth, ctx)
          return child.size > 0 ? child : null
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(childPath)
          ctx.currentSize += stat.size
          return { name: entry.name, path: childPath, size: stat.size }
        }
      } catch {
        // ignore permission errors
      }
      return null
    },
    () => abortFlag,
  )

  let total = 0
  const children: ScanNode[] = []
  for (const r of collected) {
    if (!r) continue
    total += r.size
    children.push(r)
  }

  node.size = total
  ctx.topDirs.set(dirPath, total)

  if (children.length > 0) {
    children.sort((a, b) => b.size - a.size)
    node.children = children.slice(0, 20)
  }

  return node
}

async function getFolderSize(dirPath: string, ctx: ScanContext): Promise<number> {
  if (abortFlag) return 0
  let total = 0
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const validEntries = entries.filter((e) => {
      const childPath = path.join(dirPath, e.name)
      return !shouldSkip(childPath)
    })

    const sizes = await processEntriesParallel(
      validEntries,
      dirPath,
      async (entry, childPath) => {
        ctx.itemsScanned++
        tryEmitProgress(ctx, childPath)
        try {
          if (entry.isDirectory()) {
            return await getFolderSize(childPath, ctx)
          } else if (entry.isFile()) {
            const stat = await fs.promises.stat(childPath)
            return stat.size
          }
        } catch {
          // ignore
        }
        return 0
      },
      () => abortFlag,
    )

    total = sizes.reduce((sum, s) => sum + s, 0)
  } catch {
    // ignore
  }
  ctx.currentSize += total
  return total
}

export async function scanDirectory(
  targetPath: string,
  maxDepth = 3,
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanNode> {
  abortFlag = false
  const stat = await fs.promises.stat(targetPath)
  if (!stat.isDirectory()) {
    onProgress?.({
      phase: 'scanning',
      currentPath: targetPath,
      itemsScanned: 1,
      currentSize: stat.size,
      topDirs: [{ name: path.basename(targetPath), size: stat.size }],
    })
    return { name: path.basename(targetPath), path: targetPath, size: stat.size }
  }

  const ctx: ScanContext = {
    itemsScanned: 0,
    currentSize: 0,
    lastProgressTime: 0,
    topDirs: new Map(),
    onProgress,
  }

  const result = await getDirSize(targetPath, 0, maxDepth, ctx)

  // Final progress
  onProgress?.({
    phase: 'scanning',
    currentPath: targetPath,
    itemsScanned: ctx.itemsScanned,
    currentSize: ctx.currentSize,
    topDirs: Array.from(ctx.topDirs.entries())
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10),
  })

  return result
}

export function abortScan() {
  abortFlag = true
}
