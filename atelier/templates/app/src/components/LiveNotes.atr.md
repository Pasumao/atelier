# LiveNotes — live 直通 + 乐观对账演示组件（.atr.md 共置约定）

> 与 `LiveNotes.atr.ts` / `LiveNotes.atr.spec.ts` 三元共置。
> FS-7 尾巴：把 §4.4 前端直通形态（streamValue + EventSource，与 gen endpoint 生成物同型）
> 与 §4.5 乐观更新对账协议（optimisticList × command × live）落成 starter 示例——
> M3-FS 任务臂直接考它（FS-DESIGN §4.5 / §14.3）。

## 目标

双通道演示（见 main.ts `#live-demo` 段）：下行 live SSE（`GET /api/app.notes/live`）经
streamValue 三态直通渲染；上行 command POST（`/api/app.addNote`，id 客户端生成随请求上行）
经 optimisticList 乐观先行，成功 commit、失败 revert，live 推送始终是真相源。

## 约束

- 直通形态与 gen-endpoint 生成物同型：URL = `/api/app.notes/live?input=` +
  encodeURIComponent(JSON.stringify(input))；data 事件 push 进 streamValue；error 事件按
  ATR-321 语义处理（四段式 console 呈现、订阅保持不断流；无 data 的 error = 连接级中断由
  EventSource 自动重连）。
- §4.5 五步对账协议为考点：
  1. WHEN send → THE SYSTEM SHALL optimisticAdd(pending) 先行渲染（半透明 + pending 徽标）；
  2. WHEN optimisticAdd 完成 → THE SYSTEM SHALL fetch POST app.addNote（id 客户端生成）；
  3a. WHEN 响应 2xx → THE SYSTEM SHALL commit(id) 并清除上一条 UI 错误；
  3b. WHEN 响应非 2xx / 网络失败 → THE SYSTEM SHALL revert(id) + rollbacked 计数 + ATR 四段式进 UI 错误卡（fix 可展示，不白屏）；
  4. WHEN live data 帧到达 → THE SYSTEM SHALL 以服务端数据对账：同 id 幂等合并、服务端值胜出、optimistic 项不重复渲染。
- 样式只用 token 工具类 + recipe 层（`.ppanel`/`.btn`）；pending 视觉区分用 opacity（非新增颜色）。
- 服务端对端见 `../server/endpoints/notes.ts`（内存态 = 热重启即清，诚实边界随文件头）。

## 验收清单

机检（`LiveNotes.atr.spec.ts`，dom-shim + mock EventSource/fetch 走真实 mountComponent 渲染路径）：
- [ ] 直通三态更新：EventSource data 帧 → sv.push → 列表与「live 帧」计数渲染（两帧递增）
- [ ] ATR-321 error 帧：订阅保持（EventSource 未 close）、console.error 呈现四段式、不白屏
- [ ] commit 对账：POST 2xx → pending 徽标消失、待确认归零；帧到达同 id 合并行不重复
- [ ] revert 回滚：POST 4xx ATR-201 → 行移除、已回滚计数、错误卡呈现 code/message/fix
- [ ] live 推送覆盖 pending：POST 未决时帧先到 → 服务端值胜出（徽标消失、单行、commit 后仍不重复）

人工（DoD 第 4 条）：
- [ ] `pnpm dev` 打开 `#live-demo`：输入 note → add → 半透明 pending 行 → 推送后转正；
      停掉 server 子进程再 add → 错误卡 + 已回滚计数，页面不白屏

## 状态（诚实标注）

- 【实测】spec 全绿 + 真实 server SSE 冒烟（首帧全量 / 写后失效-重算-推送 / 缺 text → ATR-201）随交付时点
- 【边界】组件级 EventSource 的实例 dispose 面 runtime v1 未公开（无 mount cleanup 钩子）——
  组件随页面常驻场景零泄漏；HMR 交换下旧订阅由服务端断连检测自愈，属已文档化 dev-only 边界
