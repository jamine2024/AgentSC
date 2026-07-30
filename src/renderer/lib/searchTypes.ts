/** 全局文件搜索渲染端类型（与主进程 filesearch/types 对齐） */

export interface FileResult {
  path: string
  name: string
  parent: string
  ext: string
  size: number
  mtime: number
  is_dir: boolean
}

export interface FileSearchStatus {
  ready: boolean
  indexing: boolean
  fileCount: number
  scannedCount: number
  drives: string[]
}
