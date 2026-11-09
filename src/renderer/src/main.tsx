import './temp-first-paint'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { tempMark } from '@shared/temp-timing'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/newsreader/latin-400.css'
import '@fontsource/newsreader/latin-600.css'
import { App } from './App'
import './styles/globals.css'
import './styles/theme-lab.css'
import './styles/ai-settings.css'
import './styles/ai-comments.css'
import './styles/ask-ai.css'
import './styles/continuation.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

tempMark('react-render-start')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
