# results/ — 出数台账（runs.json 只追加）

- `runs.json`：逐 run 记录，**只追加不改写**（出数有效性红线）。schema：

```json
{ "runs": [ { "arm": "noskill|skill|next", "task": "task1-column-change|task2-live-reconcile|task3-fullstack-rescue",
              "run": 1, "firstPass": true, "attempts": 1 } ] }
```

- 汇总与判定：`node ../report.mjs --results <本目录>/runs.json --tier pilot|formal`
- 判定口径 = protocol §6（相对 ≥+15pt 为主 + 绝对 ≥60% 副之；n<5 → N/A）；引用必带
  "FORMAL n=5/cell、Wilson 区间宽于判据间距，方向性参考而非定论" 限定语。
- 每波报告（pilot/formal 分档）落本目录；原始 grade 工件在各 attempt 目录的 `m3fs-grade.json`。
