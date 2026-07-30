import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'
export type ThemeMode = 'dark' | 'light' | 'system'
export type Accent = 'indigo' | 'violet' | 'blue' | 'cyan' | 'emerald' | 'amber' | 'orange' | 'rose'

export interface AccentMeta {
  id: Accent
  labelZh: string
  labelEn: string
  /** CSS gradient for the swatch preview — mirrors the --grad-* tokens in index.css */
  swatch: string
}

/** Brand color presets. Each drives --primary / --ring / --info and the brand gradient stops. */
export const ACCENTS: AccentMeta[] = [
  { id: 'indigo',  labelZh: '靛蓝', labelEn: 'Indigo',  swatch: 'linear-gradient(135deg, hsl(224 76% 61%), hsl(245 83% 68%), hsl(199 89% 55%))' },
  { id: 'violet',  labelZh: '紫罗兰', labelEn: 'Violet',  swatch: 'linear-gradient(135deg, hsl(262 83% 64%), hsl(291 78% 68%), hsl(212 90% 64%))' },
  { id: 'blue',    labelZh: '天蓝', labelEn: 'Blue',    swatch: 'linear-gradient(135deg, hsl(217 91% 62%), hsl(224 90% 66%), hsl(199 89% 56%))' },
  { id: 'cyan',    labelZh: '青色', labelEn: 'Cyan',    swatch: 'linear-gradient(135deg, hsl(199 89% 52%), hsl(190 92% 58%), hsl(174 72% 50%))' },
  { id: 'emerald', labelZh: '翠绿', labelEn: 'Emerald', swatch: 'linear-gradient(135deg, hsl(160 72% 44%), hsl(152 69% 50%), hsl(173 80% 46%))' },
  { id: 'amber',   labelZh: '琥珀', labelEn: 'Amber',   swatch: 'linear-gradient(135deg, hsl(35 92% 54%), hsl(43 95% 58%), hsl(25 95% 55%))' },
  { id: 'orange',  labelZh: '橙橙', labelEn: 'Orange',  swatch: 'linear-gradient(135deg, hsl(25 95% 57%), hsl(33 96% 60%), hsl(14 90% 58%))' },
  { id: 'rose',    labelZh: '玫红', labelEn: 'Rose',    swatch: 'linear-gradient(135deg, hsl(346 84% 62%), hsl(330 82% 66%), hsl(280 70% 62%))' },
]

/** 读取系统配色偏好（仅当选择“跟随系统”时用到）。 */
function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

/** 读取持久化的主题模式，兼容旧版仅含 dark/light 的值，新增 system。 */
function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem('agentsc-theme') as ThemeMode | null
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    /* localStorage 不可用时回退默认 */
  }
  return 'dark'
}

interface ThemeContextType {
  /** 用户选择的主题模式（含 system） */
  mode: ThemeMode
  /** 实际生效的明暗（已根据 system 解析） */
  theme: Theme
  accent: Accent
  /** 设置模式（dark / light / system） */
  setMode: (m: ThemeMode) => void
  /** 便捷方法：显式设置明暗（等价于 setMode('dark' | 'light')） */
  setTheme: (t: Theme) => void
  /** 切换：跟随系统时点按→切到与当前相反的显式值；否则 dark/light 互转 */
  toggleTheme: () => void
  setAccent: (a: Accent) => void
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  theme: 'dark',
  accent: 'indigo',
  setMode: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
  setAccent: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode)

  const [accent, setAccentState] = useState<Accent>(() => {
    const stored = localStorage.getItem('agentsc-accent') as Accent | null
    if (stored && ACCENTS.some((a) => a.id === stored)) return stored
    return 'indigo'
  })

  // 实际生效的明暗：跟随系统时实时解析系统偏好
  const [theme, setThemeState] = useState<Theme>(() => {
    const m = getStoredMode()
    return m === 'system' ? getSystemTheme() : m
  })

  // mode 变化 → 重新解析实际明暗
  useEffect(() => {
    if (mode === 'system') {
      setThemeState(getSystemTheme())
    } else {
      setThemeState(mode)
    }
  }, [mode])

  // 跟随系统：监听操作系统配色偏好变化，实时切换
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setThemeState(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  // 应用 theme → <html> class + 持久化 mode + 同步托盘菜单外观
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    try {
      localStorage.setItem('agentsc-theme', mode)
    } catch {
      /* 忽略持久化失败 */
    }
  }, [theme, mode, accent])

  // 应用 accent → <html data-accent>
  useEffect(() => {
    document.documentElement.dataset.accent = accent
    try {
      localStorage.setItem('agentsc-accent', accent)
    } catch {
      /* 忽略持久化失败 */
    }
  }, [accent])

  const setMode = useCallback((m: ThemeMode) => setModeState(m), [])
  const setTheme = useCallback((t: Theme) => setModeState(t), [])
  const toggleTheme = useCallback(() => {
    setModeState((prev) => {
      if (prev === 'system') return theme === 'dark' ? 'light' : 'dark'
      return prev === 'dark' ? 'light' : 'dark'
    })
  }, [theme])
  const setAccent = useCallback((a: Accent) => setAccentState(a), [])

  const ctxValue = useMemo(
    () => ({ mode, theme, accent, setMode, setTheme, toggleTheme, setAccent }),
    [mode, theme, accent, setMode, setTheme, toggleTheme, setAccent],
  )

  return (
    <ThemeContext.Provider value={ctxValue}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
