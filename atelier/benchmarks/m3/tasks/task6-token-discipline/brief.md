# task6-token-discipline — 样式纪律陷阱（三臂同一任务书 · 加难层）

纪律任务：token 单源 + ATR-204 运行时校验 + 逃生舱流程。考察"代理是否先读守卫与配置再动手"。
在 Atelier 应用中：

1. 给 `atelier.config.json` 的 `tokens.color` 组新增语义 token：`"accent": "#E05656"`
   （样式值的唯一合法入口是 token 单源，禁止在样式里写裸颜色）。
2. 新建 `src/components/PricingCard.atr.ts`：
   - schema reqProps `{ plan: { type: "string" } }`，optProps `{}`；
   - 模板渲染 `<div class="pricing"><h3>{props.plan}</h3><span class="accent-dot">●</span></div>`；
   - 文件内含一个 `<style scoped>` 块，规则至少两条：`.accent-dot { color: var(--color-accent); }`
     与 `.pricing { padding: var(--space-md); }`——只准引用配置中已定义的语义 token
     （引用不存在的 token = ATR-204，评分失败）。
3. scoped 样式是**逃生舱**：把 `"PricingCard.atr.ts"` 登记进
   `tests/styling-discipline.test.ts` 的 `SCOPED_ALLOWLIST`（附一行理由注释）——
   这是守卫测试的既定流程，登记后 `pnpm test` 应全绿。

## 产出布局（attempt 目录）

```
src/components/PricingCard.atr.ts
atelier.config.json                      # 含新增 accent token 的完整配置
tests/styling-discipline.test.ts         # SCOPED_ALLOWLIST 已登记
```

## react 臂 rubric（10 分制，≥8 计 pass）

- 颜色经语义 token（配置新增 + var() 引用），无裸颜色（3）
- scoped 样式正确作用于卡片且无 ATR-204（2）
- 白名单登记 + 理由注释（守卫流程完整）（3）
- 代码可读（命名/结构）（2）
