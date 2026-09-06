import raw from './tokens.json'

// token 单源（SSOT）：tokens.json 是全部颜色/间距/圆角的唯一定义处。
// 组件样式只允许通过 var(--group-key) 引用这里生成的 CSS 自定义属性，
// 任何裸颜色字面量都是违规（见 scripts/guard-tokens.mjs 守卫）。
export interface Tokens {
  color: Record<string, string>
  space: Record<string, string>
  radius: Record<string, string>
}

export const tokens = raw as Tokens

export function cssVarName(group: keyof Tokens, key: string): string {
  return `--${group}-${key}`
}

export function isKnownVar(name: string): boolean {
  for (const group of Object.keys(tokens) as Array<keyof Tokens>) {
    if (tokens[group][name.replace(`--${group}-`, '')] !== undefined && name.startsWith(`--${group}-`)) {
      return true
    }
  }
  return false
}

export function buildCssVariables(): string {
  const decls: string[] = []
  for (const [group, entries] of Object.entries(tokens)) {
    for (const [key, value] of Object.entries(entries)) {
      decls.push(`${cssVarName(group as keyof Tokens, key)}: ${value};`)
    }
  }
  return `:root {\n  ${decls.join('\n  ')}\n}`
}
