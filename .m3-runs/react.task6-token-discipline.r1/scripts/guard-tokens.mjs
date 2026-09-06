#!/usr/bin/env node
/**
 * 样式守卫测试（零依赖，`pnpm test` 运行）。
 *
 * 规则：
 *   R1  token 单源   —— src/ 内（css/tsx/ts）禁止裸颜色字面量（hex / rgb() / hsl() / 常见命名色），
 *                      唯一豁免：src/tokens.json（SSOT 本体）。
 *   R2  token 存在性 —— 样式中的 var(--group-key) 必须能对应 tokens.json 中的定义，
 *                      引用不存在的 token = 失败。
 *   R3  scoped 逃生舱 —— 组件使用组件内 scoped 局部样式（*.module.css）必须在
 *                      ESCAPE_HATCH_WHITELIST 登记并附理由注释，未登记 = 失败。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

// ── 逃生舱白名单（R3）───────────────────────────────────────────────
// 组件使用 scoped 局部样式（CSS Module）必须在此登记，每项附一行理由注释。
const ESCAPE_HATCH_WHITELIST = [
  // PricingCard — 逃生舱：定价卡片要求视觉自包含、样式随组件共置迁移，故允许组件内 scoped 样式（PricingCard.module.css）；其取值仍全部引用语义 token，无裸色值。2026-09-06 登记。
  'PricingCard',
]

// ── R2 用：从 tokens.json 收集合法定义 ─────────────────────────────
const tokens = JSON.parse(readFileSync(join(SRC, 'tokens.json'), 'utf8'))
const knownVars = new Set()
for (const [group, entries] of Object.entries(tokens)) {
  for (const key of Object.keys(entries)) knownVars.add(`--${group}-${key}`)
}

// ── 收集 src 下文件 ────────────────────────────────────────────────
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(SRC).filter((p) => /\.(css|tsx?|json)$/.test(p))
const violations = []

// R1 检测用的裸色模式：hex / rgb(a) / hsl(a) / 常见 CSS 命名色
const BARE_COLOR_PATTERNS = [
  [/#(?:[0-9a-fA-F]{3,4}){1,2}\b/g, 'hex literal'],
  [/\brgba?\(/g, 'rgb() literal'],
  [/\bhsla?\(/g, 'hsl() literal'],
  [/(?:^|[^-\w])(white|black|red|green|blue|orange|purple|pink|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia|cyan|magenta|yellow|crimson|coral|tomato|gold|indigo|violet|turquoise|salmon|khaki|plum|orchid|beige|ivory|linen|snow|ghostwhite|whitesmoke|seashell|aliceblue|lavender)(?![\w-])/g,
    'named color literal'],
]

// CSS 属性值里出现的 var(--x)（含 css 文件与 tsx 内联样式字符串）；要求闭合括号，
// 且扫描前剥离注释，避免文档注释里的示例文本误报
const VAR_USE = /var\((--[a-zA-Z0-9-]+)\s*\)/g

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/')
  const text = stripComments(readFileSync(file, 'utf8'))
  const isSsot = rel === 'src/tokens.json'

  if (!isSsot) {
    // R1: 裸颜色字面量
    for (const [re, label] of BARE_COLOR_PATTERNS) {
      const m = text.match(re)
      if (m) violations.push(`R1 [${rel}] 裸颜色字面量（${label}）: ${m.slice(0, 3).join(', ')}`)
    }
  }

  // R2: 引用不存在的 token
  for (const match of text.matchAll(VAR_USE)) {
    if (!knownVars.has(match[1])) {
      violations.push(`R2 [${rel}] 引用未定义 token: var(${match[1]})`)
    }
  }

  // R3: scoped 局部样式须在白名单
  if (rel.endsWith('.module.css')) {
    const component = rel.split('/').pop().replace('.module.css', '')
    if (!ESCAPE_HATCH_WHITELIST.includes(component)) {
      violations.push(`R3 [${rel}] 组件 "${component}" 使用了 scoped 局部样式但未在 ESCAPE_HATCH_WHITELIST 登记`)
    }
  }
}

// 白名单里登记了但没有对应 module.css 的陈旧条目也提醒（保持登记处诚实）
for (const name of ESCAPE_HATCH_WHITELIST) {
  if (!files.some((f) => f.endsWith(`${name}.module.css`))) {
    violations.push(`R3 白名单陈旧条目: "${name}" 无对应 src/${name}.module.css`)
  }
}

if (violations.length > 0) {
  console.error(`\n✗ 样式守卫失败（${violations.length} 项违规）：\n`)
  for (const v of violations) console.error('  - ' + v)
  console.error('')
  process.exit(1)
}

console.log(`\n✓ 样式守卫通过：${files.length} 个文件扫描完毕`)
console.log('  R1 无裸颜色字面量（SSOT = src/tokens.json）')
console.log(`  R2 全部 var() 引用均在 token 定义内（${knownVars.size} 个合法 token）`)
console.log(`  R3 scoped 样式白名单: ${ESCAPE_HATCH_WHITELIST.join(', ')}\n`)
