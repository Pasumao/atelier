/**
 * SchemaProbe.atr.spec.ts — 决策 26 schema 编译期提取 v1 的端到端机检（starter 核对物）。
 * 手法同 FormBinding.atr.spec.ts：模板侧无 dom-shim vendor（框架 tests/ 资产不进应用模板）——
 * 本文件内联同款最小 DOM 语义（SchemaProbe 无表单控件，取基底形态），在 mountComponent 真实
 * 渲染路径上断言（不绕过解释器直测校验）。
 *
 * 单一真相注记：spec 自己完成「注解→提取→sink→挂载」接线——从 vendored
 * ../../compiler/extract-schema.mjs import extractPropsSchemas 对本文件源码现算 schema，
 * 经 ../runtime 的 registerExtractedSchemas 注册进 sink，再挂载。与 dev 插件 transform 的注入
 * 同源同函数（dev 期由插件 prepend，vitest 无 vite transform 故此处手工等价接线）。
 *
 * 红绿分面（设计内先红后绿，跨分支形态）：
 *   - 静态面（当场绿）：注解即唯一 schema 源（无手写 schema 元数据）+ 登记三处（main.ts /
 *     manifest.json / llms.txt）。
 *   - 提取/sink/校验环（已知红）：提取器 extract-schema.mjs 在 schema 批 A 分支（schema-scanner）
 *     落地、runtime sink registerExtractedSchemas 在 schema 批 B 分支（schema-sink）落地——
 *     红因统一为「A/B 实现件未合并」一类（模块解析失败 / registerExtractedSchemas is not a
 *     function），不是本 spec 或组件自身的缺陷。
 * 三元共置：注解面改动必须三处同步（.atr.ts / .atr.md / 本文件）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

/* ---- dom-shim：必须先于组件模块安装。vitest 的静态 import 会被提升到文件顶部，
 * 因此组件与 runtime 桶出口走测试内动态 import（shim 已就位后再加载）。 ---- */
type AnyNode = any;

const KNOWN_RED =
  "已知红：schema 批 A（extract-schema.mjs 提取器，schema-scanner）/ B（runtime sink registerExtractedSchemas，schema-sink）未合并——设计内先红后绿，非本用例缺陷";

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
  /* style 面：{#if} 分支锚点 span 会被解释器写 style.display="contents"（template.ts renderNode）——
   * SchemaProbe 模板含 {#if}，本 shim 必须承接该写（FormBinding/LiveNotes 无分支锚点故其 shim 缺此面）。 */
  readonly style: Record<string, string> = {};
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
    if (node.parentNode) node.parentNode = null;
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

function makeContainer(): AnyNode {
  const c = new MElement("div");
  doc.documentElement.appendChild(c);
  return c;
}

/** 本文件源码（fs 直读——静态面与提取环共用） */
const probeSource = fs.readFileSync(new URL("./SchemaProbe.atr.ts", import.meta.url), "utf8");

describe("SchemaProbe — 静态面（当场绿）：注解即唯一 schema 源 + 登记三处", () => {
  it("组件文件含 props 类型注解且【无手写 schema 元数据】（决策 26 核对物）", () => {
    expect(probeSource).toContain("props: { label: string; times?: number }");
    expect(probeSource).not.toContain("schema:"); // 手写件缺席——注解是唯一来源
    expect(probeSource).toContain('{ name: "SchemaProbe" })');
  });

  it("登记三处：main.ts 挂载段 / manifest.json 登记项（无 schema 字段）/ llms.txt 提取速查", () => {
    const mainTs = fs.readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(mainTs).toContain('import { SchemaProbe } from "./components/SchemaProbe.atr.ts"');
    expect(mainTs).toContain('id = "schema-demo"');
    expect(mainTs).toContain("mountComponent(SchemaProbe");

    const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      components: Array<{ name: string; file: string; schema?: unknown }>;
    };
    const entry = manifest.components.find((c) => c.name === "SchemaProbe");
    expect(entry, "manifest.json 缺 SchemaProbe 登记项").toBeTruthy();
    expect(entry!.file).toBe("components/SchemaProbe.atr.ts");
    expect(entry!.schema, "注解即唯一 schema 源——manifest 不应再录手写 schema 字段").toBeUndefined();

    const llms = fs.readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
    expect(llms).toContain("注解即 schema");
    expect(llms).toContain("ATR-102");
  });
});

/** 端到端环接线：提取器（vendored compiler/）对本文件源码现算 → sink 注册 → 加载组件。
 * dev 期由插件 transform prepend 同源注入；vitest 无 vite transform，此处等价手工接线。
 * 类型层注记：提取器 specifier 运行时拼 URL + runtime 以 any 引用——合并窗口内（A/B 未落地）
 * 已知红必须落在**运行时**（用例红），不能落在类型层把 init 产物的 tsc/tsgo 零诊断门禁打红；
 * 红因单一来源 = wireRing 的 KNOWN_RED 包装。 */
async function wireRing(): Promise<{ rt: any; SchemaProbe: any; map: Record<string, unknown> }> {
  try {
    const rt: any = await import("../runtime"); // registerExtractedSchemas 随 schema 批 B 进桶出口
    const scannerUrl = new URL("../../compiler/extract-schema.mjs", import.meta.url).href;
    const scanner: any = await import(scannerUrl); // 随 schema 批 A 落地 vendored compiler/
    const entries = scanner.extractPropsSchemas(probeSource) as Array<{ name: string; schema: unknown }>;
    const map: Record<string, unknown> = {};
    for (const e of entries ?? []) if (e && e.name && e.schema != null) map[e.name] = e.schema;
    rt.registerExtractedSchemas(map); // ← B 未合并时此处 not a function
    const { SchemaProbe } = await import("./SchemaProbe.atr.ts"); // ← component() 兜底取 sink
    return { rt, SchemaProbe, map };
  } catch (e) {
    throw new Error(`${KNOWN_RED}｜根因: ${(e as Error).message}`);
  }
}

describe("SchemaProbe — 注解→提取→sink→component() 兜底→真实校验链（已知红：A/B 未合并）", () => {
  it("提取环 + sink 环：现算产物 {SchemaProbe: FlatSchema} 注册后，registry 的 def.schema 即提取产物", async () => {
    const { rt, SchemaProbe, map } = await wireRing();
    expect(Object.keys(map)).toContain("SchemaProbe");
    const extracted = map.SchemaProbe as { type: string; reqProps: Record<string, unknown>; optProps: Record<string, unknown> };
    expect(extracted.type).toBe("object");
    expect(Object.keys(extracted.reqProps)).toEqual(["label"]); // 注解缺省 ?: → optProps
    expect(Object.keys(extracted.optProps)).toEqual(["times"]);
    // component() 兜底：opts.schema 未传 → def.schema 来自 sink（决策 26 消费机制）
    expect(rt.registry.get("SchemaProbe")?.schema).toEqual(extracted);
    expect(SchemaProbe.schema).toEqual(extracted);
  });

  it("校验环（正例）：嵌套 <SchemaProbe label times=2> 经 def.schema 校验通过并正常渲染（含 times>1 重复行）", async () => {
    const { rt } = await wireRing();
    const Host = rt.component(function SchemaHost() {
      return rt.html`<SchemaProbe label={label} times={times} />`.locals({ label: "Schema Probe 合法实例", times: 2 });
    }, { name: "SchemaHost" });
    const container = makeContainer();
    rt.mountComponent(Host, {}, container, rt.registry, (schema: never, data: never) => rt.validateFlat(schema, data));
    expect(container.textContent).toContain("Schema Probe 合法实例");
    expect(container.textContent).toContain("repeat:"); // times > 1 重复行
    expect(container.textContent).toContain("×2");
    expect(container.textContent).not.toContain("ATR-201");
  });

  it("校验环（反例）：缺 label 实例出 ATR-201 错误卡（P2-1 边界兜住，fix 指认 label）", async () => {
    const { rt } = await wireRing();
    const BadHost = rt.component(function SchemaBadHost() {
      return rt.html`<SchemaProbe />`;
    }, { name: "SchemaBadHost" });
    const container = makeContainer();
    rt.mountComponent(BadHost, {}, container, rt.registry, (schema: never, data: never) => rt.validateFlat(schema, data));
    const text = container.textContent;
    expect(text).toContain("ATR-201");
    expect(text).toContain("label"); // message/fix 指认缺失键
  });
});
