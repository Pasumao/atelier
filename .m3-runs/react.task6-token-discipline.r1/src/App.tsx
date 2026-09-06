import { PricingCard } from './PricingCard'
import './app.css'

export default function App() {
  return (
    <main className="app-shell">
      <h1>Token Discipline Demo</h1>
      <p className="app-hint">
        所有颜色取值经 <code>tokens.json</code> 单源下发，组件样式仅引用 CSS 变量。
      </p>
      <PricingCard plan="Pro" />
    </main>
  )
}
