# Atelier 发布检查单（npm publish 前置两段式）

> 版本：1.0（2026-09-27，m12 批建立）。配套：根 README「Known Limitations」· `CHANGELOG.md` · 决策 28（版本化与语义化版本承诺）· ROADMAP §5 D-3。
> 口径：**本环境不真发布 npm（无账号）——1.0 = release-ready**。本检查单把发布拆成两段：①本地可验项（每次发版前全绿）；②发布日外部动作（需要外部账号/平台，逐项标注本仓未验证原因）。npm publish 时点 = ROADMAP §5 D-3 发布日决策，本检查单不代拍日期。

## ① 本地可验项（发版前必须全绿）

| # | 项 | 命令 | 期待结果 |
|---|---|---|---|
| 1 | 框架测试全绿 | `cd atelier && pnpm test` | 全绿 + 8 skip（实验台用例无 env 按环境跳过）；1.0.0 基线 = 618 绿 + 8 skip（含 `tests/release-form.test.ts` 3 例发布形态钉） |
| 2 | 发布形态钉 | `cd atelier && npx vitest run tests/release-form.test.ts` | 3/3 绿（version=1.0.0 / CHANGELOG 含 [1.0.0] / private:true）——版本号改动必过此钉 |
| 3 | 技能包一致性 | `node atelier/scripts/check-skills.mjs` | 56-0，exit 0 |
| 4 | API 面漂移门禁 | `node atelier/cli.mjs api-diff check` | PASS（removed/changed = breaking exit 1；发布前终检可加 `--strict` 连新增也红——1.0 后新增默认 additive，破坏性变更必须升 minor/major 且 `--allow` 豁免留痕，决策 28） |
| 5 | 数字标记位机检 | `node atelier/scripts/docs-numbers.mjs sync && node atelier/scripts/docs-numbers.mjs check` | sync 后 check PASS（tests/tools 两标记位与实跑一致；禁止手写） |
| 6 | 视觉快照门 | `node atelier/cli.mjs snapshot check`（需 dev 面可达） | MATCH（win32 基线字节+像素双档；linux/darwin 未武装为 vacuous——见 README Known Limitations） |
| 7 | 快照冒烟全链 | `cd atelier && pnpm snapshot-smoke` | 正证 + 篡改负探针全链 PASS，exit 0 |
| 8 | scratch init 复验 | `node atelier/cli.mjs init --target .atelier-scratch-<ver> --name Scratch && cd … && pnpm install && pnpm test` | 应用测试全绿（init 产物自包含可跑）；**用后清除**，产物不留仓 |
| 9 | node 产物构建冒烟 | `node atelier/cli.mjs build --root <scratch应用> --target=node` | spawn 冒烟自证：app.ping 200 · 静态 index 200 · server-status 405 ATR-311（服务面 prod 激活实证）；运行 = `ATELIER_DB_PATH=<卷> node dist/server.mjs` |
| 10 | bun 产物构建冒烟 | `node atelier/cli.mjs build --root <scratch应用> --target=bun`（本机 bun 1.4.2） | 冒烟自证 PASS；bun 宿主侧另跑 `node atelier/scripts/bun-adapter-smoke.mjs` 16 项全 PASS（node 下诚实 exit 1 指路 bun） |
| 11 | 性能四指标不回退 | `node atelier/cli.mjs bench --app <scratch应用>`（对照 README 性能表） | gzip ≤ 30KB · 10³ 节点挂载 ≤ 50ms · HMR ≤ 100ms · 截图回环 ≤ 500ms，四项不差于 README 表口径；回退即停下修，不粉饰 |
| 12 | checkpoint 门禁可达 | 仓库根 `node atelier/cli.mjs checkpoint save "<版本>"` | 三道门（测试绿 + 快照无漂移 + API 面无破坏漂移）全过才许锚定；迁移 head 入台账 |
| 13 | 发版时点 API 面终检（决策 28 实战） | `node atelier/cli.mjs api-diff check --strict` → 红出全部 additive（预期行为非事故）→ 人工核对红出清单与 CHANGELOG 新版条目一致 → `node atelier/cli.mjs api-diff snapshot` 刷新基线 → 常规 `api-diff check` 回绿 | 红出清单与 CHANGELOG 对账一致；基线刷新后常规 check PASS |

**1.0.0 执行记录（2026-09-27，m12 批）**：#1 618 绿+8 skip（基线 615 + 形态钉 3）✅ · #2 3/3 ✅（先红后绿：红检 `ea4d013`）· #3 56-0 ✅ · #4 PASS ✅ · #5 sync 后 check PASS ✅ · #7 全链 PASS ✅ · #8 复验全绿 ✅ · 其余项沿用 m11 批复测证据（#6 双 MATCH `a1c2f01`、#9 405 ATR-311 `74627f9` 前后多批复验、#10 bun 1.4.2 16 项 `731fe74`、#11 四指标 ALL PASS `d3b2970`）。发布日若代码无漂移，本段只需重跑 #1/#4/#5；有漂移则全量重跑。

## ② 发布日外部动作（本仓未验证，逐项标注原因）

| # | 动作 | 步骤 | 未验证原因 |
|---|---|---|---|
| 1 | `atelier` 裸名可用性实测（决策 14 注意项） | `npm view atelier` 实测；占用则退 `atelierjs` / `atelier-js`（决策 14 预案）。**注意**：裸名撞名核查是 2026-01 时点结论，发布日必须重测 | 本机无 npm 账号，未登录 registry 实测 |
| 2 | 发布形态决策（publish 时点拍板，D-3） | `private: true` 是否摘除（摘除须连 `tests/release-form.test.ts` 断言一起有意识改）；发布物布局（`atelier/` 目录直发 vs 打包单源）；`atelier-framework` 包名 vs 裸名 `atelier` | 属 D-3 发布日决策，本批明确不代拍（决策 28） |
| 3 | npm publish | ①段全绿 + #1/#2 拍板后 `npm publish`（首次建议 `--tag next` 灰度） | 同 #1，无账号 |
| 4 | 版本 tag + GitHub Release | `git tag v1.0.0 && git push origin v1.0.0` + 以 CHANGELOG 1.0.0 段为 Release 说明（比较链接已在 CHANGELOG 尾部预置） | 本仓未 push 过远端，tag 推送流程未实测 |
| 5 | push 远端 + 真实 CI 首跑 | push 后观察 matrix（linux/windows × node 22/24）首跑；视首跑稳定性摘除 snapshot-smoke 的 continue-on-error（BACKLOG 尾巴既有条目销账） | 本仓无 remote push 历史（挂账既有）；视觉冒烟环境敏感性需首跑取证 |
| 6 | MCP Registry 提交 | 官方 MCP Registry 注册 atelier server（P2-2 阶段即挂账的外部依赖） | 需 Registry 账号/组织身份，本仓无 |
| 7 | linux / darwin 快照基线武装 | 各平台本地 `node atelier/cli.mjs snapshot save` 捕获 per-platform 基线入库 + `check` 双 MATCH | 本机仅 win32；基线像素档平台敏感，不可代捕 |
| 8 | create-atelier 脚手架 | `npm create atelier` 形态脚手架包（薄壳调 atelier init），依赖 #3 完成 | 同 #1 |
| 9 | 生死判据 3 计时启动（ROADMAP §7） | npm publish 日起 90 天内非本人真实第三方应用数 > 0，否则"框架"主张降级为个人工具链 | 依赖 #3；检验属发布后观察，非动作本身 |

## 维护纪律

- 本文件随发版演进：每段收口后在 ① 段末追加执行记录（日期 + 版本 + 数字），不改判据原文。
- ② 段任一项完成后：勾销并回写实证锚点；产生的新承诺进 `BACKLOG.md`，不留在本文件。
- ① 段是硬门禁——任何一项红，发布推迟；`--no-gate` 逃生口只对 checkpoint 锚定有效，对发布无效。
