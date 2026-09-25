/**
 * LiveNotes.atr.spec.ts — FS-7 live 直通 + §4.5 乐观对账的机检。
 * 手法：模板侧无 dom-shim vendor（那是框架 tests/ 的资产，不进应用模板）——本文件内联同款
 * 最小 DOM 语义（镜像 atelier/tests/dom-shim.ts：appendChild 移动语义 / textContent /
 * addEventListener / classList / isConnected），并 mock EventSource/fetch 两个浏览器网络面，
 * 在 mountComponent 真实渲染路径上驱动事件（不绕过解释器直测信号）。
 * 三元共置：契约/直通形态改动必须三处同步（.atr.ts / .atr.md / 本文件）。
 */
import { describe, it, expect } from "vitest";

/* ---- dom-shim：必须先于组件模块安装。vitest 的静态 import 会被提升到文件顶部，
 * 因此组件与 runtime 桶出口走顶层 await 动态 import（shim 已就位后再加载）。 ---- */
type AnyNode = any;

class MText {
  type = "text" as const;
  childNodes: AnyNode[] = [];
  parentNode: AnyNode = null;
  data: string;
  constructor(d: string) {
    this.data = String(d);
  }
  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = String(v);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class MElement {
  type: "element" | "fragment";
  tag: string;
  attrs: [string, string][] = [];
  childNodes: AnyNode[] = [];
  parentNode: AnyNode = null;
  listeners = new Map<string, ((e: unknown) => void)[]>();
  style = {
    setProperty: (k: string, v: string) => this.setAttribute(k, v),
  } as Record<string, string> & { setProperty: (k: string, v: string) => void };
  constructor(tag: string, type: "element" | "fragment" = "element") {
    this.tag = tag;
    this.type = type;
  }
  get firstChild(): AnyNode {
    return this.childNodes[0] ?? null;
  }
  get isConnected(): boolean {
    let n: AnyNode = this;
    while (n.parentNode) n = n.parentNode;
    return n === doc.documentElement || n === doc.head;
  }
  appendChild(node: AnyNode): AnyNode {
    if (node.type === "fragment") {
      for (const c of [...node.childNodes]) this.appendChild(c);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node: AnyNode): AnyNode {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  setAttribute(name: string, value: string): void {
    const hit = this.attrs.find(([k]) => k === name);
    if (hit) hit[1] = String(value);
    else this.attrs.push([name, String(value)]);
  }
  getAttribute(name: string): string | null {
    return this.attrs.find(([k]) => k === name)?.[1] ?? null;
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [new MText(v)];
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatchEvent(e: { type: string }): boolean {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    return true;
  }
}

const doc = {
  createElement: (tag: string) => new MElement(tag),
  createTextNode: (d: string) => new MText(d),
  createDocumentFragment: () => new MElement("#fragment", "fragment"),
  head: new MElement("head"),
  documentElement: new MElement("html"),
};
(globalThis as unknown as Record<string, unknown>).document = doc;
(globalThis as unknown as Record<string, unknown>).window = globalThis;

function findByTag(node: AnyNode, tag: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode): void => {
    if (!n) return;
    if (n.type === "element" && n.tag === tag) out.push(n);
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(node);
  return out;
}
function makeContainer(): AnyNode {
  return new MElement("div");
}

/* ---- mock EventSource：记录实例与 URL；用例用 emit() 注入 data/error 帧 ---- */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data });
  }
}
(globalThis as unknown as Record<string, unknown>).EventSource = MockEventSource;

/* ---- mock fetch：记录调用；respond 由用例逐个编程（2xx / 4xx ATR / 挂起） ---- */
type FetchCall = { url: string; body: Record<string, unknown> };
type MockResponse = { status: number; json: unknown };
const fetchCalls: FetchCall[] = [];
let respond: (call: FetchCall) => Promise<MockResponse> = async () => ({ status: 200, json: {} });
(globalThis as unknown as Record<string, unknown>).fetch = async (url: string, init?: { body?: string }): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
  const call: FetchCall = { url, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {} };
  fetchCalls.push(call);
  const r = await respond(call);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
};

/* ---- shim 就位，加载被测组件与 runtime 桶出口 ---- */
const rt = await import("../runtime");
const { LiveNotes } = await import("./LiveNotes.atr.ts");

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise<void>((r) => queueMicrotask(() => r()));
  }
};

/** 挂载一个全新 LiveNotes 实例，返回容器与本实例的 EventSource */
function mountLiveNotes(): { container: AnyNode; es: MockEventSource } {
  const container = makeContainer();
  doc.documentElement.appendChild(container);
  rt.mountComponent(LiveNotes, { title: "Live Notes" }, container, rt.registry, (schema, data) =>
    rt.validateFlat(schema as never, data),
  );
  const es = MockEventSource.instances[MockEventSource.instances.length - 1];
  return { container, es };
}

const frame = (notes: { id: string; text: string; time: string }[]): string => JSON.stringify({ notes });

describe("LiveNotes — live SSE 直通（§4.4，与 gen endpoint 生成物 live() 同型）", () => {
  it("data 帧 → streamValue 三态更新：列表渲染 + 帧计数递增", async () => {
    const { container, es } = mountLiveNotes();
    // URL 与生成物同型：?input= + encodeURIComponent(JSON.stringify(input))
    expect(es.url).toBe("/api/app.notes/live?input=" + encodeURIComponent(JSON.stringify({})));
    expect(container.textContent).toContain("live 帧: 0");

    es.emit("data", frame([{ id: "n1", text: "first note", time: "t1" }]));
    await flush();
    expect(container.textContent).toContain("first note");
    expect(container.textContent).toContain("live 帧: 1");

    es.emit("data", frame([
      { id: "n1", text: "first note", time: "t1" },
      { id: "n2", text: "second note", time: "t2" },
    ]));
    await flush();
    expect(container.textContent).toContain("second note");
    expect(container.textContent).toContain("live 帧: 2");
  });

  it("ATR-321 error 帧：订阅保持不断流、四段式进 UI 错误卡（fix 可操作提示）、不白屏", async () => {
    const { container, es } = mountLiveNotes();
    es.emit("error", JSON.stringify({ code: "ATR-321", message: "重算失败", context: {}, fix: "修 handler 后无需重连" }));
    await flush();
    expect(es.closed).toBe(false); // 订阅保持（ATR-321 语义：不断流）
    // §8.3：错误即导航——四段式赋 sv.error 后由 UI 直接渲染 fix（console 呈现退役）
    expect(container.textContent).toContain("ATR-321");
    expect(container.textContent).toContain("重算失败");
    expect(container.textContent).toContain("修 handler 后无需重连");
    // 随后的 data 帧照常直通——订阅确实活着
    es.emit("data", frame([{ id: "n1", text: "still alive", time: "t" }]));
    await flush();
    expect(container.textContent).toContain("still alive");
  });
});

describe("LiveNotes — §4.5 乐观更新对账协议", () => {
  it("commit 对账：optimisticAdd 先行渲染 → POST 2xx → commit；live 帧同 id 合并不重复", async () => {
    // POST 用受控 deferred：pending 先行渲染的断言必须发生在响应落地之前（否则 commit 已翻转状态）
    let resolvePost: (r: MockResponse) => void = () => {};
    respond = () => new Promise((res) => (resolvePost = res));
    const { container, es } = mountLiveNotes();

    const input = findByTag(container, "input")[0];
    input.dispatchEvent({ type: "input", target: { value: "hello live" } });
    findByTag(container, "button")[0].dispatchEvent({ type: "click" });
    await flush();

    // §4.5-1/2：pending 先行渲染 + id 随请求上行
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe("/api/app.addNote");
    const id = String(fetchCalls[0].body.id);
    expect(id.length).toBeGreaterThan(0);
    expect(fetchCalls[0].body.text).toBe("hello live");
    expect(container.textContent).toContain("hello live");
    expect(container.textContent).toContain("pending");
    expect(container.textContent).toContain("待确认: 1");

    // POST 2xx → commit(id)：pending 徽标消失、待确认归零；行仍在（等 live 帧对账）
    resolvePost({ status: 200, json: fetchCalls[0].body });
    await flush();
    expect(container.textContent).not.toContain("pending");
    expect(container.textContent).toContain("待确认: 0");

    // live 推送到达：同 id 幂等合并——optimistic 行被服务端行替代，不重复
    es.emit("data", frame([{ id, text: "hello live", time: "srv" }]));
    await flush();
    expect(container.textContent.split("hello live").length - 1).toBe(1);
    expect(container.textContent).toContain("srv");
  });

  it("revert 回滚：POST 4xx ATR-201 → revert + rollbacked 计数 + 错误卡呈现 fix 不白屏", async () => {
    respond = async () => ({
      status: 400,
      json: { code: "ATR-201", message: "text: 长度 0 小于最小 1", context: { component: "app.addNote" }, fix: "按契约修正 props：text 非空" },
    });
    const { container } = mountLiveNotes();

    const input = findByTag(container, "input")[0];
    input.dispatchEvent({ type: "input", target: { value: "doomed note" } });
    findByTag(container, "button")[0].dispatchEvent({ type: "click" });
    await flush();

    // §4.5-3b：行移除 + rollbacked 记录 + ATR 错误对象进 UI（fix 可展示）
    expect(container.textContent).not.toContain("doomed note");
    expect(container.textContent).toContain("已回滚: 1");
    expect(container.textContent).toContain("待确认: 0");
    expect(container.textContent).toContain("ATR-201");
    expect(container.textContent).toContain("按契约修正 props：text 非空");
  });

  it("live 推送覆盖 pending：POST 未决时帧先到 → 服务端值胜出；commit 到达后仍不重复", async () => {
    let resolvePost: (r: MockResponse) => void = () => {};
    respond = () => new Promise((res) => (resolvePost = res));
    const { container, es } = mountLiveNotes();

    const input = findByTag(container, "input")[0];
    input.dispatchEvent({ type: "input", target: { value: "live wins" } });
    findByTag(container, "button")[0].dispatchEvent({ type: "click" });
    await flush();
    expect(container.textContent).toContain("pending"); // POST 在途：先行渲染

    // 帧先于 POST 响应到达：真相源对账——pending 徽标消失、单行、服务端 time 胜出
    const id = String(fetchCalls[fetchCalls.length - 1].body.id);
    es.emit("data", frame([{ id, text: "live wins", time: "srv" }]));
    await flush();
    expect(container.textContent).not.toContain("pending");
    expect(container.textContent.split("live wins").length - 1).toBe(1);
    expect(container.textContent).toContain("srv");

    // POST 迟到成功 → commit(id)：同 id 已被帧覆盖，视图仍单行（幂等）
    resolvePost({ status: 200, json: fetchCalls[fetchCalls.length - 1].body });
    await flush();
    expect(container.textContent.split("live wins").length - 1).toBe(1);
    expect(container.textContent).toContain("待确认: 0");
  });
});
