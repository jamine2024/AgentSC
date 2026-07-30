import type { ScanNode } from './scanner'

export interface ScanReportPayload {
  target_path: string
  total_size: number
  items_scanned: number
  max_depth: number
  created_at: number
  result: ScanNode
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

interface FlatNode {
  name: string
  path: string
  size: number
  depth: number
}

function flatten(node: ScanNode, depth = 0, out: FlatNode[] = []): FlatNode[] {
  out.push({ name: node.name, path: node.path, size: node.size, depth })
  if (node.children) {
    for (const c of node.children) flatten(c, depth + 1, out)
  }
  return out
}

// 递归打印目录树：每层按大小排序截取前若干，整体限量，避免报告过长
function buildTree(node: ScanNode, depth: number, out: string[], cap: number, perLevel = 6): void {
  if (out.length >= cap) return
  const indent = '  '.repeat(depth)
  out.push(`${indent}${node.name}  (${formatBytes(node.size)})`)
  if (!node.children || node.children.length === 0) return
  const kids = node.children
    .filter((c) => (c.size || 0) > 0)
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, perLevel)
  for (const c of kids) {
    if (out.length >= cap) break
    buildTree(c, depth + 1, out, cap, perLevel)
  }
}

// 生成纯文本占用分析报告（无需浏览器渲染，直接落盘为 .txt）
export function buildScanReportTxt(p: ScanReportPayload): string {
  const flat = flatten(p.result)
    .filter((n) => n.depth > 0)
    .sort((a, b) => b.size - a.size)
  const top = flat.slice(0, 20)
  const time = new Date(p.created_at).toLocaleString('zh-CN')

  const lines: string[] = []
  lines.push('占用分析报告')
  lines.push(`生成时间：${time} · 由 AgentSC 生成`)
  lines.push('')
  lines.push(`扫描目标：${p.target_path}`)
  lines.push(`总占用：  ${formatBytes(p.total_size)}`)
  lines.push(`扫描项数：${(p.items_scanned ?? 0).toLocaleString()}`)
  lines.push(`扫描深度：${String(p.max_depth ?? 3)}`)
  lines.push('')
  lines.push(`==== Top 占用文件夹（前 ${top.length}）====`)
  if (top.length === 0) {
    lines.push('（无数据）')
  } else {
    top.forEach((it, i) => {
      lines.push(`${String(i + 1).padStart(2, ' ')}. ${it.name}  (${formatBytes(it.size)})  ${it.path}`)
    })
  }
  lines.push('')
  lines.push('==== 目录层级（按大小，前 50）====')
  const treeLines: string[] = []
  buildTree(p.result, 0, treeLines, 50)
  lines.push(...(treeLines.length ? treeLines : ['（无数据）']))
  lines.push('')
  lines.push('AgentSC · 占用分析报告 · 本文件由本地应用离线生成')
  return lines.join('\n')
}
