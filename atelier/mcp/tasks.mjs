/**
 * tasks.mjs — MCP Tasks 扩展的任务存储（FS-DESIGN §10.2，MCP 2026-07-28 SEP-2133 对齐）。
 *
 * 形态：服务端主导创建（server-driven creation）——客户端不能凭空造任务；长操作在获准执行时
 * 由服务端建任务并返回显式句柄（taskId）。状态生命周期（2026-07-28 Tasks 重构后）：
 *   queued → running → completed | failed | cancelled
 *   cancel 请求即时落 cancelled 终态（run 结果到达后按守卫丢弃，绝不覆盖终态）。
 *
 * 无状态对齐的诚实边界：任务态是进程内 Map + 显式句柄（SEP-2567 handles 形态——比隐藏会话
 * 更强，句柄可被模型推理与回传）；句柄只在创建它的实例上可解析（dev 面 = 单实例，成立；
 * `tasks/list` 因无会话无法安全定界在 2026-07-28 被规范移除，本实现同样不提供）。完成任务
 * 按 ttlMs 保留（缺省 15 分钟）后 sweep 驱逐——显式句柄可失效，客户端拿到 ATR-401 重跑即可。
 */
function taskError(codeText, fixText) {
  const e = new Error(`${codeText}\nfix: ${fixText}`);
  const m = /^(ATR-[\w-]+):\s*([\s\S]*)$/.exec(codeText);
  e.atr = { code: m ? m[1] : "ATR-ERR", message: m ? m[2] : codeText, fix: fixText };
  return e;
}

const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_TASKS = 64;
const SETTABLE_FIELDS = new Set(["ttlMs"]);

export function createTaskStore({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, maxTasks = MAX_TASKS } = {}) {
  const tasks = new Map();
  let seq = 0;

  const sweep = () => {
    const t = now();
    for (const [id, rec] of tasks) {
      if (rec.finishedAt !== null && t - rec.finishedAt > rec.ttlMs) tasks.delete(id);
    }
  };

  const view = (rec) => ({
    taskId: rec.taskId,
    tool: rec.tool,
    label: rec.label,
    status: rec.status,
    createdAt: rec.createdAt,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    ttlMs: rec.ttlMs,
    ...(rec.status === "completed" ? { result: rec.result } : {}),
    ...(rec.status === "failed" ? { error: rec.error } : {}),
  });

  return {
    /** 服务端主导创建：run(signal) 是获准执行的长操作；返回句柄视图，执行在后台推进 */
    create({ tool, args = null, run, label = null, ttlMs: ttl } = {}) {
      sweep();
      if (tasks.size >= maxTasks) {
        // 先驱逐最老的已完成任务；无可驱逐且仍在容量上 → 结构化拒绝（不静默挤掉活跃任务）
        const finished = [...tasks.entries()].filter(([, r]) => r.finishedAt !== null).sort((a, b) => a[1].finishedAt - b[1].finishedAt);
        if (finished.length === 0) {
          throw taskError(`ATR-4xx-dev: task store at capacity (${maxTasks} active tasks)`, "等待现有任务终态后再提交长操作，或先 tasks.cancel 腾位");
        }
        tasks.delete(finished[0][0]);
      }
      const rec = {
        taskId: `task-${++seq}`,
        tool: String(tool ?? "unknown"),
        label: label ?? null,
        args,
        status: "queued",
        createdAt: now(),
        startedAt: null,
        finishedAt: null,
        result: undefined,
        error: undefined,
        ttlMs: Number(ttl ?? ttlMs) || DEFAULT_TTL_MS,
        _abort: null,
        _promise: null,
      };
      tasks.set(rec.taskId, rec);
      rec._abort = new AbortController();
      rec._promise = Promise.resolve()
        .then(() => {
          if (rec.status !== "queued") return undefined; // 起步前已被取消
          rec.status = "running";
          rec.startedAt = now();
          return run(rec._abort.signal);
        })
        .then(
          (result) => {
            if (rec.status === "cancelled") return; // 终态不被迟到结果覆盖
            rec.status = "completed";
            rec.result = result;
            rec.finishedAt = now();
          },
          (e) => {
            if (rec.status === "cancelled") return;
            rec.status = "failed";
            rec.error = { code: e?.atr?.code ?? "ATR-500", message: e?.message ?? String(e), fix: e?.atr?.fix ?? null };
            rec.finishedAt = now();
          },
        );
      return view(rec);
    },

    /** 显式句柄读取；过期驱逐后未命中 → null（上层给 ATR-401 指路重跑） */
    get(taskId) {
      sweep();
      const rec = tasks.get(String(taskId ?? ""));
      return rec ? view(rec) : null;
    },

    /** 客户端可更新面收敛为保留窗 ttlMs（SEP-2133 tasks/update 的最小安全建模）；未知字段拒绝 */
    update(taskId, patch = {}) {
      sweep();
      const rec = tasks.get(String(taskId ?? ""));
      if (!rec) return null;
      for (const key of Object.keys(patch ?? {})) {
        if (key === "taskId" || SETTABLE_FIELDS.has(key)) continue;
        throw taskError(`ATR-401: tasks.update 字段 "${key}" 不可设置`, `可设置字段：${[...SETTABLE_FIELDS].join(" | ")}`);
      }
      if (patch?.ttlMs != null) {
        const v = Number(patch.ttlMs);
        if (!Number.isFinite(v) || v <= 0) {
          throw taskError(`ATR-401: tasks.update ttlMs 必须是正数，收到 ${JSON.stringify(patch.ttlMs)}`, "ttlMs 是任务完成后保留窗（毫秒）；到期被 sweep 驱逐");
        }
        rec.ttlMs = v;
      }
      return view(rec);
    },

    /** 取消：queued/running → cancelled 终态 + abort 信号（协作式；同步段不可中断，如实落终态） */
    cancel(taskId) {
      sweep();
      const rec = tasks.get(String(taskId ?? ""));
      if (!rec) return null;
      if (rec.status === "queued" || rec.status === "running") {
        rec.status = "cancelled";
        rec.finishedAt = now();
        try {
          rec._abort.abort();
        } catch { /* abort 不可用不影响终态 */ }
      }
      return view(rec);
    },

    /** 测试与编排用：等待某任务终态落地后回视图（不影响正常轮询路径） */
    async settle(taskId) {
      const rec = tasks.get(String(taskId ?? ""));
      if (rec?._promise) await rec._promise.catch(() => {});
      return rec ? view(rec) : null;
    },
  };
}
