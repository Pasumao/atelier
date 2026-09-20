// @vitest-environment jsdom
/**
 * acceptance-c.spec.tsx — M3-FS next 臂 C 类（客户端对账）评分 harness。
 *
 * 由 grade-next.mjs 注入 attempt 根目录（m3fs-c-acceptance.spec.tsx）后，用 attempt 自身的
 * vitest 驱动：pnpm exec vitest run m3fs-c-acceptance.spec.tsx。评分完即删——本文件不属于
 * attempt 产物。
 *
 * env：ATELIER_M3FS_TASK（task id，必填）+ ATELIER_M3FS_C_OUT（结果文件路径，必填）。
 * 断言语义 = tasks/*.brief.next.md 的 C 类判据（逐字同文）；驱动方式 = jsdom 挂载
 * src/components/NotesList + fetch/EventSource 模拟服务端（场景规格冻结于 ../README.md，
 * 对全部 attempt 同值）。每个场景通过后把 "<case>: PASS" 写入结果文件——**不走 stdout**：
 * vitest 失败输出的代码帧会回显本文件源码，任何出现在源码里的字面标记都会污染解析。
 *
 * 网络面模拟口径（与 R 类黑盒同一语义，wire 见转译件"评分驱动约定"）：
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

const TASK = process.env.ATELIER_M3FS_TASK ?? "";
const OUT_FILE = process.env.ATELIER_M3FS_C_OUT ?? ".m3fs-c-results.json";
const COMP_PATH = process.env.ATELIER_M3FS_COMPONENT || "./src/components/NotesList";

/** 场景结果登记：只落文件（见头注——stdout 标记会被 vitest 代码帧污染） */
const results: Record<string, string> = {};
function markPass(caseKey: string) {
  results[caseKey] = "PASS";
  try {
    fs.writeFileSync(OUT_FILE, JSON.stringify(results));
  } catch {
    /* 结果文件不可写 = 评分侧问题，grade 以缺文件判红 */
  }
}

const PROBE_ID = 777;
const PROBE_PRIORITY = 9; // 探针值取 9：避开 createdAt 常见渲染（epoch/ISO）中的数字，防误报
const SUBMIT_BODY = "m3fs-c-note";
const FAIL_BODY = "__m3fs_fail__"; // harness 常量：mock 服务端对它返回 400（README 冻结）
const FIX_TEXT = "body 必须为非空字符串";

const BASE_ROWS: Array<Record<string, unknown>> =
  TASK === "task2-live-reconcile"
    ? [{ id: 1, body: "seed-one", createdAt: 1700000000000 }]
    : [
        { id: PROBE_ID, body: "probe-alpha", createdAt: 1700000000000, priority: PROBE_PRIORITY },
        { id: 1, body: "seed-one", createdAt: 1700000000001, priority: 0 },
      ];

type Frame = Record<string, unknown>;

/** EventSource 模拟：建立即推首连全量帧；push() = 服务端写后推送（无名 data 帧）。 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
  url: string;
  readyState = 1;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(ev: { data: string }) => void>>();
  constructor(url: string) {
    this.url = String(url);
    MockEventSource.instances.push(this);
    const self = this;
    queueMicrotask(function () {
      self.push({ notes: BASE_ROWS });
    });
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    const arr = this.listeners.get(type) || [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (ev: { data: string }) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(function (f) {
        return f !== fn;
      }),
    );
  }
  dispatchEvent(): boolean {
    return true;
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: string) {
    const arr = this.listeners.get(type) || [];
    for (const fn of arr) fn({ data });
  }
  push(frame: Frame) {
    const data = JSON.stringify(frame);
    this.emit("message", data);
    if (this.onmessage) this.onmessage({ data });
  }
}

const calls: Array<{ method: string; url: string; body: unknown }> = [];
let lastCreate: { id: unknown; body: unknown } | null = null;

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status: status, headers: { "content-type": "application/json" } });
}

function installMocks() {
  calls.length = 0;
  lastCreate = null;
  MockEventSource.reset();
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async function (input: unknown, init?: RequestInit) {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
      const method = String((init && init.method) || "GET").toUpperCase();
      let parsedBody: unknown = undefined;
      if (init && typeof init.body === "string") {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }
      calls.push({ method: method, url: url, body: parsedBody });
      if (method === "GET" && url.indexOf("/api/notes") >= 0) {
        return jsonResponse({ notes: BASE_ROWS }, 200);
      }
      if (method === "POST" && url.indexOf("/api/notes") >= 0) {
        const b = (parsedBody && typeof parsedBody === "object" ? parsedBody : {}) as Record<string, unknown>;
        if (b.body === FAIL_BODY) {
          return jsonResponse({ code: "INVALID_INPUT", message: "input violates the note contract", fix: FIX_TEXT }, 400);
        }
        lastCreate = { id: b.id, body: b.body };
        return jsonResponse({ id: b.id ?? -1, body: b.body ?? "", createdAt: 1700000000002 }, 201);
      }
      return jsonResponse({ notes: [] }, 200);
    }),
  );
}

async function mountComp(): Promise<ComponentType> {
  const mod: Record<string, unknown> = await import(/* @vite-ignore */ COMP_PATH);
  const Comp = (mod.default ?? mod.NotesList) as ComponentType;
  expect(Comp, "src/components/NotesList 需提供默认导出（或命名导出 NotesList）").toBeTruthy();
  return Comp;
}

async function getEntry(container: HTMLElement) {
  await waitFor(function () {
    expect(container.querySelector("input"), "提交入口：需一个文本 <input>（body）").toBeTruthy();
    expect(container.querySelector("button"), "提交入口：需一个提交 <button>").toBeTruthy();
  });
  return {
    input: container.querySelector("input") as HTMLInputElement,
    button: container.querySelector("button") as HTMLButtonElement,
  };
}

beforeEach(function () {
  installMocks();
  configure({ asyncUtilTimeout: 4000 });
});
afterEach(function () {
  cleanup();
  vi.unstubAllGlobals();
});

(TASK ? describe : describe.skip)("m3fs-c acceptance [" + TASK + "]", function () {
  it("挂载自检：列表行带 data-note-id（C 类 DOM 钩子）", async function () {
    const Comp = await mountComp();
    const { container } = render(<Comp />);
    await waitFor(function () {
      expect(container.querySelectorAll("[data-note-id]").length).toBeGreaterThan(0);
    });
    markPass("mount");
  });

  if (TASK === "task1-column-change" || TASK === "task3-fullstack-rescue") {
    it("task1-M7：priority 在行内可见文本中出现（探针 id=777，值 9）", async function () {
      const Comp = await mountComp();
      const { container } = render(<Comp />);
      const row = await waitFor(function () {
        const el = container.querySelector('[data-note-id="' + PROBE_ID + '"]');
        expect(el, "探针行（id=777）未渲染").toBeTruthy();
        return el as HTMLElement;
      });
      expect(row.textContent || "", "行内可见文本须含 priority 值 9").toContain(String(PROBE_PRIORITY));
      markPass("m7");
    });
  }

  if (TASK === "task2-live-reconcile" || TASK === "task3-fullstack-rescue") {
    it("task2-C1：成功提交 → 待定行先行 → 推送对账后该 id 仅一行且非待定", async function () {
      const Comp = await mountComp();
      const { container } = render(<Comp />);
      const entry = await getEntry(container);
      fireEvent.change(entry.input, { target: { value: SUBMIT_BODY } });
      fireEvent.click(entry.button);
      await waitFor(function () {
        expect(lastCreate).not.toBeNull();
      });
      const rawId = (lastCreate as { id: unknown }).id;
      const cid = String(rawId);
      expect(
        ["undefined", "null", ""].indexOf(cid) >= 0,
        "创建请求须携带客户端生成的 id（同 id 幂等合并的前提）",
      ).toBe(false);
      // §4.5-1：待定行（data-pending="true"）先行渲染，不等服务端
      await waitFor(function () {
        expect(
          container.querySelector('[data-note-id="' + cid + '"][data-pending="true"]'),
          "待定行未先行渲染（data-pending=true）",
        ).toBeTruthy();
      });
      // 服务端真相源帧到达（同 id）→ 单一已确认行
      for (const es of MockEventSource.instances) {
        es.push({ notes: [...BASE_ROWS, { id: rawId, body: SUBMIT_BODY, createdAt: 1700000000003 }] });
      }
      await waitFor(function () {
        const rows = container.querySelectorAll('[data-note-id="' + cid + '"]');
        expect(rows.length, "同 id 合并后该行应仅出现一次（无重复行）").toBe(1);
        expect(rows[0].getAttribute("data-pending"), "对账后该行应为已确认（无 data-pending=true）").not.toBe("true");
      });
      markPass("c1");
    });

    it("task2-C2：失败提交 → 待定项消失 + data-rollbacked 含该 id + 错误 fix 提示可见", async function () {
      const Comp = await mountComp();
      const { container } = render(<Comp />);
      const entry = await getEntry(container);
      fireEvent.change(entry.input, { target: { value: FAIL_BODY } });
      fireEvent.click(entry.button);
      let failPost: { body: Record<string, unknown> } | undefined;
      await waitFor(function () {
        failPost = calls.find(function (c) {
          return c.method === "POST" && (c.body as Record<string, unknown>)?.body === FAIL_BODY;
        }) as { body: Record<string, unknown> } | undefined;
        expect(failPost, "失败场景 POST 未发生").toBeTruthy();
      });
      const cid = String(failPost!.body.id);
      // §4.5-3b：待定项从列表消失
      await waitFor(function () {
        expect(container.querySelector('[data-note-id="' + cid + '"]'), "失败后待定项未从列表消失").toBeNull();
      });
      // 回滚名单含该 id
      await waitFor(function () {
        const rb = Array.from(container.querySelectorAll("[data-rollbacked]"));
        const hit = rb.some(function (el) {
          return (
            (el.textContent || "").indexOf(cid) >= 0 ||
            String(el.getAttribute("data-rollbacked") || "").indexOf(cid) >= 0
          );
        });
        expect(hit, "回滚名单（data-rollbacked）未含被回滚 id").toBe(true);
      });
      // 错误信息（含 fix 提示）DOM 可见
      await waitFor(function () {
        expect(container.textContent || "", "错误 fix 提示须 DOM 可见").toContain(FIX_TEXT);
      });
      markPass("c2");
    });
  }
});
