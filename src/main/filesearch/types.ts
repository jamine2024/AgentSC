/** 全盘文件搜索：共享类型（主进程 / 渲染端通用） */

/** 单条文件记录（入库用） */
export interface FileRow {
  name: string
  path: string
  parent: string
  ext: string
  size: number
  mtime: number
  /** 1 = 目录，0 = 文件 */
  is_dir: number
  /** 盘符，如 'C:' */
  drive: string
}

/** 搜索返回给渲染端的文件结果 */
export interface FileResult {
  path: string
  name: string
  parent: string
  ext: string
  size: number
  mtime: number
  is_dir: boolean
}

/** 索引状态（渲染端展示用） */
export interface FileSearchStatus {
  /** 索引是否可用（至少有过一次完整建索） */
  ready: boolean
  /** 是否正在后台建索引 */
  indexing: boolean
  /** 已索引文件总数 */
  fileCount: number
  /** 本次建索引已扫描文件数 */
  scannedCount: number
  /** 参与索引的盘符列表 */
  drives: string[]
}
