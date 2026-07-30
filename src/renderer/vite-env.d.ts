/// <reference types="vite/client" />

interface ToastNotification {
  title: string
  body: string
  timestamp: number
}

interface Window {
  electronAPI: {
    send: (channel: string, ...args: unknown[]) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<any>
    on: (channel: string, callback: (...args: unknown[]) => void) => void
    removeAllListeners: (channel: string) => void
  }
}
