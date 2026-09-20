# NotesPage — 意图验收单（task3：priority 贯通 + live 对账）

## 意图

笔记列表页：渲染每条笔记的优先级；live 订阅服务端 notes 列表；用户提交新笔记采用
§4.5 乐观对账五步协议（待定先行 → 提交 → commit/revert → live 帧对账服务端胜出）。

## 验收（行为化）

1. 打开页面即建立 SSE 订阅，首连收到全量列表并渲染（每行带 `data-note-id`）；
2. 每行可见 priority 值（基线既有行为 0，新提交按输入）；
3. 提交新笔记：立即以待定态出现（`data-pending="true"`）；成功后转已确认，live 推送
   到达后该行以服务端值为准存在且仅一次；
4. 提交失败（如空 body 被 ATR-201 拒绝）：待定行消失、回滚名单（`data-rollbacked`）
   含该 id、错误卡展示 code/message/fix；
5. 失败路径与成功路径都不弄脏列表其余部分；ATR-321 不断流不白屏。

## 边界

- live 推送是真相源，optimistic 状态只是先行渲染（同 id 服务端值胜出）；
- 行样式全走 token 工具类（决策 16），不引入新颜色。
