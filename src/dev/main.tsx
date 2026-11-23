import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '../styles/tokens.css'
import '../styles/global.css'
import { initTheme } from '../features/theme/theme'
import { UiKit } from './UiKit'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiKit />
  </StrictMode>,
)
