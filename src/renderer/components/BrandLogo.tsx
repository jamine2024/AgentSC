// 硬件品牌 logo 组件：根据制造商/型号字符串匹配已知品牌，渲染其品牌色「字标」徽标；
// 未识别时回退到对应硬件类型的通用 lucide 图标（CPU/GPU/内存/主板/网卡）。
// 作为硬件监测页各区块的品牌标识，兼顾「品牌 logo」与「通用 logo」诉求。
import { Cpu, Monitor, MemoryStick, Server, Network } from 'lucide-react'

export type BrandKind = 'cpu' | 'gpu' | 'memory' | 'system' | 'network'

const fallbackIcon: Record<BrandKind, React.ComponentType<{ className?: string }>> = {
  cpu: Cpu,
  gpu: Monitor,
  memory: MemoryStick,
  system: Server,
  network: Network,
}

// 品牌 → { 主色, 字标 }。key 为小写子串，命中即视为该品牌。
const BRANDS: Record<string, { color: string; short: string }> = {
  intel: { color: '#0071c5', short: 'Intel' },
  amd: { color: '#ed1c24', short: 'AMD' },
  'advanced micro devices': { color: '#ed1c24', short: 'AMD' },
  nvidia: { color: '#76b900', short: 'NVIDIA' },
  samsung: { color: '#1428a0', short: 'SAMSUNG' },
  'sk hynix': { color: '#e4002b', short: 'SK hynix' },
  hynix: { color: '#e4002b', short: 'SK hynix' },
  kingston: { color: '#d22630', short: 'Kingston' },
  crucial: { color: '#1a1a1a', short: 'Crucial' },
  micron: { color: '#0072ce', short: 'Micron' },
  dell: { color: '#007db8', short: 'DELL' },
  lenovo: { color: '#e60012', short: 'Lenovo' },
  hp: { color: '#0096d6', short: 'HP' },
  'hewlett-packard': { color: '#0096d6', short: 'HP' },
  asus: { color: '#ff1e40', short: 'ASUS' },
  gigabyte: { color: '#f7941e', short: 'GIGABYTE' },
  msi: { color: '#ff0000', short: 'MSI' },
  'western digital': { color: '#0f8c3f', short: 'WD' },
  '\\bwd\\b': { color: '#0f8c3f', short: 'WD' },
  seagate: { color: '#0064a4', short: 'Seagate' },
  realtek: { color: '#0a7ec2', short: 'Realtek' },
  broadcom: { color: '#cc092f', short: 'Broadcom' },
  qualcomm: { color: '#3253dc', short: 'Qualcomm' },
  mediatek: { color: '#e2001a', short: 'MediaTek' },
  apple: { color: '#9ca3af', short: 'Apple' },
  toshiba: { color: '#d90f14', short: 'TOSHIBA' },
  adata: { color: '#e4002b', short: 'ADATA' },
  corsair: { color: '#facc15', short: 'CORSAIR' },
  'lg\\b': { color: '#a50034', short: 'LG' },
  acer: { color: '#83b81a', short: 'Acer' },
  alienware: { color: '#0072bc', short: 'Alienware' },
  razer: { color: '#00ff00', short: 'Razer' },
  arm: { color: '#1f6feb', short: 'Arm' },
  'texas instruments': { color: '#d22630', short: 'TI' },
}

function detect(brand?: string): { color: string; short: string } | null {
  const key = (brand || '').trim().toLowerCase()
  if (!key) return null
  for (const b of Object.keys(BRANDS)) {
    // 支持正则或纯子串匹配
    try {
      if (b.startsWith('\\b') || b.endsWith('\\b') || b.includes('\\b')) {
        if (new RegExp(b).test(key)) return BRANDS[b]
      } else if (key.includes(b)) {
        return BRANDS[b]
      }
    } catch {
      if (key.includes(b)) return BRANDS[b]
    }
  }
  return null
}

export function BrandLogo({
  brand,
  kind,
  size = 'md',
  className,
}: {
  brand?: string
  kind: BrandKind
  size?: 'sm' | 'md'
  className?: string
}) {
  const Icon = fallbackIcon[kind]
  const info = detect(brand)
  if (!info) {
    return <Icon className={className || 'h-5 w-5 text-muted-foreground'} />
  }
  const dim = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold leading-none tracking-tight text-white ${dim} ${className || ''}`}
      style={{ background: info.color }}
      title={brand}
    >
      {info.short}
    </span>
  )
}

export function GenericLogo({ kind, className }: { kind: BrandKind; className?: string }) {
  const Icon = fallbackIcon[kind]
  return <Icon className={className || 'h-5 w-5 text-muted-foreground'} />
}
