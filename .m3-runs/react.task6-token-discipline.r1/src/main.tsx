import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { buildCssVariables } from './tokens'
import './app.css'

// token 单源注入：tokens.json 是唯一颜色来源，这里把它铺成 :root CSS 变量。
const styleEl = document.createElement('style')
styleEl.setAttribute('data-source', 'src/tokens.json')
styleEl.textContent = buildCssVariables()
document.head.appendChild(styleEl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
