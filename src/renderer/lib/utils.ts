import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function throttle<T extends (...args: unknown[]) => unknown>(fn: T, ms: number): T {
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: unknown[] | null = null

  const throttled = (...args: unknown[]) => {
    const now = Date.now()
    const remaining = ms - (now - lastCall)
    pendingArgs = args
    if (remaining <= 0) {
      lastCall = now
      if (timer) { clearTimeout(timer); timer = null }
      fn(...args)
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now()
        timer = null
        if (pendingArgs) fn(...pendingArgs)
      }, remaining)
    }
  }
  return throttled as T
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}
