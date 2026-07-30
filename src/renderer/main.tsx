import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { AppErrorBoundary } from './App'
import { ThemeProvider } from './lib/theme'
import { I18nProvider } from './lib/i18n'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
