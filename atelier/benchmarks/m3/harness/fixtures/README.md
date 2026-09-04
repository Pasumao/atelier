# grader 自测 fixtures

评分器自身的回归样本（改 acceptance.spec.ts / strip-comments.ts 后必跑）：

- `grader-comment-only/`：禁令字样只在注释里 → `node atelier/benchmarks/m3/grade.mjs --task task2-stream --attempt <本目录>` 必须 **PASS**（行为合规，措辞自由）
- `grader-real-timer/`：代码真用 setInterval/setTimeout → 同命令必须 **FAIL**（源码检查有效）

参考样本 = `../../reference/`（六任务正控，改评分器后同样必跑 6/6）。
