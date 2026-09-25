/**
 * gen-endpoint.test.ts — gen endpoint 生成器 + impact 影响面（FS-M2，FS-DESIGN §2.5/§7.1-7.2）验收：
 *   静态扫描（defineQuery/defineCommand/契约单源/specs 端点意图——无 TS 解析器/eval）
 *   · api.ts 产物形态（§4.4：name as const / POST / EventSource / 显式 import 闭合）
 *   · regen 字节幂等（§7.3 门禁 2）· 骨架只补缺失端点且永不覆盖已存在文件（诚实 stub 501）
 *   · impact 两跳静态链（契约 → 端点 → 调用点；导航非门禁，§2.5）
 *   · auth 面（FS-M2-d 挂账销账）：src/server/auth/endpoints.ts（gen auth 产物）纳入扫描——
 *     三形态专项解析（①端点级内联契约字面量·仅 auth 面放行 ②pick(users.rowSchema,…) 本地
 *     表投影 ③auth:{type:"none"} 容忍）+ 负例（无产物零影响）+ 诚实降级 + 用户面禁令不变
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanContracts, scanEndpoints, scanEndpointSource, scanSpecIntents, scanApiClient, generateApi, generateSkeletons, writeApi } from "../gen/gen-endpoint.mjs";
import { genAuth } from "../gen/gen-auth.mjs";
import { impactReport } from "../gen/impact.mjs";

const GEN_SCRIPT = fileURLToPath(new URL("../gen/gen-endpoint.mjs", import.meta.url));

/* ---------- fixture root（临时目录，纯文本——扫描器不执行被扫代码） ---------- */

const tmpRoots: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-gen-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function makeFixture(): string {
  const root = makeRoot();
  const w = (rel: string, text: string): void => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text, "utf8");
  };
  w(
    "src/contract.ts",
    `// 契约单源（fixture）：扁平 schema 常量
export const chatInputSchema = {
  type: "object",
  reqProps: { content: { type: "string", min: 1 } },
};
export const chatMessageSchema = {
  type: "object",
  reqProps: { id: { type: "number" }, role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string" } },
};
export const chatMessageListSchema = {
  type: "object",
  reqProps: { items: { type: "array", items: { type: "string" } } },
};
`
  );
  w(
    "src/server/endpoints/chat.ts",
    `import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { chatInputSchema, chatMessageListSchema, chatMessageSchema } from "../contract.ts";

export const chatAsk = defineCommand("chat.ask", {
  contract: chatInputSchema,
  output: chatMessageSchema,
  handler: async (input) => ({ id: 1, role: "user", content: input.content }),
});

export const chatList = defineQuery("chat.list", {
  contract: chatInputSchema,
  output: chatMessageListSchema,
  live: { invalidate: ["table:messages"] },
  handler: () => ({ items: [] }),
});
`
  );
  w(
    "specs/chat.md",
    `# Chat

## 端点意图（specs 扩展段）
- chat.ask（command）：发送一条消息 → 持久化 → 失效 table:messages
  验收：atelier call chat.ask '{"content":"hi"}' → 200
- chat.list（query·live）：按 chatId 列出消息，失效键 table:messages
- auth.login（command）：登录建立会话（未实现——骨架目标）
- chat.remove（command）：删除消息（骨架目标，但域文件已存在 → 永不覆盖）

## 非端点段
- fake.call（command）：不在端点意图段内，扫描器不得误收
`
  );
  return root;
}

describe("gen endpoint 生成器（§7.1-7.2：静态扫描 / api.ts / 骨架 / regen 幂等）", () => {
  it("静态扫描：端点清单 name/kind/contract/output/live/invalidate；契约单源常量；specs 意图段边界", () => {
    const root = makeFixture();
    const endpoints = scanEndpoints(root);
    expect(endpoints.map((e) => e.name)).toEqual(["chat.ask", "chat.list"]);
    const ask = endpoints[0];
    expect(ask).toMatchObject({ kind: "command", contract: "chatInputSchema", output: "chatMessageSchema", live: false });
    const list = endpoints[1];
    expect(list).toMatchObject({ kind: "query", live: true, invalidate: ["table:messages"] });

    expect(scanContracts(root).idents).toEqual(["chatInputSchema", "chatMessageSchema", "chatMessageListSchema"]);

    const intents = scanSpecIntents(root);
    expect(intents.map((i) => i.name)).toEqual(["auth.login", "chat.ask", "chat.list", "chat.remove"]); // 排序输出
    expect(intents.find((i) => i.name === "chat.list")).toMatchObject({ kind: "query", live: true });
    expect(intents.find((i) => i.name === "auth.login")).toMatchObject({ kind: "command", live: false });
    expect(intents.some((i) => i.name === "fake.call")).toBe(false); // 段外行不收（## 边界生效）
  });

  it("扫描器：泛型标注形态 defineCommand<In, Out>(…) 必须被扫到（模板 example.ts 的应用规范形态，泛型≠盲区）", () => {
    const src = `import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
export const echo = defineCommand<{ message: string }, { echoed: string; length: number; time: string }>("app.echo", {
  contract: echoInput,
  output: echoOutput,
  handler: (input) => ({ echoed: input.message, length: 1, time: "" }),
});
export const ping = defineQuery("app.ping", { handler: () => ({ ok: true }) });
`;
    const eps = scanEndpointSource(src);
    expect(eps.map((e) => e.name)).toEqual(["app.echo", "app.ping"]);
    expect(eps[0]).toMatchObject({ kind: "command", contract: "echoInput", output: "echoOutput" });
  });

  it("api.ts 产物形态（§4.4）：name as const / POST 路径 / EventSource / 类型 import 自 contract + FlatOf / streamValue 自 vendor", () => {
    const root = makeFixture();
    const { content, endpoints, notes } = generateApi(root, { mount: "/api" });
    expect(endpoints.length).toBe(2);
    expect(notes).toEqual([]);
    // 显式 import 闭合：契约单源 + FlatOf（排序确定）+ live 端点才带 streamValue
    expect(content).toContain(`import { chatInputSchema, chatMessageListSchema, chatMessageSchema } from "../contract.ts";`);
    expect(content).toContain(`import type { FlatOf } from "../vendor/atelier/server/index.ts";`); // FlatOf 单源自框架 server 面（生成器自闭合）
    expect(content).toContain(`import { streamValue } from "../vendor/atelier/runtime/index.ts";`);
    // 类型投影别名（生成物零内联重复类型——FlatOf 单源投影）
    expect(content).toContain(`type ChatAskInput = FlatOf<typeof chatInputSchema>;`);
    expect(content).toContain(`type ChatListOutput = FlatOf<typeof chatMessageListSchema>;`);
    // command 端点：冻结命名空间 + name as const + POST + ATR 四段式透传
    expect(content).toContain(`export const chatAsk = Object.freeze({`);
    expect(content).toContain(`name: "chat.ask" as const,`);
    expect(content).toContain(`async call(input: ChatAskInput): Promise<ChatAskOutput> {`);
    expect(content).toContain(`fetch("/api/chat.ask", {`);
    expect(content).toContain(`if (!res.ok) throw await res.json();`);
    // live 端点：EventSource + data→push + dispose 句柄
    expect(content).toContain(`new EventSource("/api/chat.list/live?input=" + encodeURIComponent(JSON.stringify(input)))`);
    expect(content).toContain(`sv.push(JSON.parse((e as MessageEvent).data) as ChatListOutput);`);
    expect(content).toContain(`dispose: () => es.close(),`);
    expect(content.indexOf("live(input: ChatListInput)")).toBeGreaterThan(0);
  });

  it("regen 字节幂等（§7.3 门禁 2）：连续两次生成逐字节一致；writeApi 二次落盘 changed=false", () => {
    const root = makeFixture();
    const a = generateApi(root, { mount: "/api" }).content;
    const b = generateApi(root, { mount: "/api" }).content;
    expect(a).toBe(b); // 无时间戳、端点排序、定长模板 → diff 必为空
    const first = writeApi(root, { mount: "/api" });
    expect(first.changed).toBe(true);
    const second = writeApi(root, { mount: "/api" });
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(path.join(root, "src", "generated", "api.ts"), "utf8")).toBe(a);
  });

  it("骨架（--from-specs）：只为缺失端点生成、诚实 stub 形态（AtrEndpointError 501）、已存在文件永不覆盖", () => {
    const root = makeFixture();
    const sk = generateSkeletons(root);
    // chat.remove 的域文件 chat.ts 已存在（含 chat.ask/chat.list）→ 跳过；auth.login → auth.ts 骨架
    expect(sk.written.map((w) => w.file)).toEqual(["src/server/endpoints/auth.ts"]);
    expect(sk.written[0].endpoints).toEqual(["auth.login"]);
    expect(sk.skipped).toEqual([{ file: "src/server/endpoints/chat.ts", reason: "已存在的端点文件永不覆盖", endpoints: ["chat.remove"] }]);
    const skel = fs.readFileSync(path.join(root, "src", "server", "endpoints", "auth.ts"), "utf8");
    expect(skel).toContain(`import { AtrEndpointError, defineCommand, endpointError } from "../../vendor/atelier/server/index.ts";`);
    expect(skel).toContain(`export const authLogin = defineCommand("auth.login", {`);
    expect(skel).toContain(`// contract: /* TODO：从 src/contract.ts 挂输入契约（FlatSchema 单源） */,`);
    expect(skel).toContain(`throw new AtrEndpointError(`);
    expect(skel).toContain(`501`); // 诚实失败：501 Not Implemented
    // 幂等 + 永不覆盖：二次生成时 auth.login 已被 auth.ts 定义（不算缺失）→ 只剩 chat.ts 域跳过
    const sk2 = generateSkeletons(root);
    expect(sk2.written).toEqual([]);
    expect(sk2.skipped.map((s) => s.file)).toEqual(["src/server/endpoints/chat.ts"]);
    expect(fs.readFileSync(path.join(root, "src", "server", "endpoints", "auth.ts"), "utf8")).toBe(skel);
  });

  it("impact 两跳静态链（§2.5）：契约键 → 端点（contract/output 双向）→ 调用点 file:line；未命中诚实注记", () => {
    const root = makeFixture();
    writeApi(root, { mount: "/api" }); // 生成物就位（端点名 → 导出标识符映射源）
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "pages", "Chat.atr.ts"),
      `import { chatAsk, chatList } from "../generated/api.ts";

export async function send() {
  const msg = await chatAsk.call({ content: "hi" });
  return msg;
}

export function subscribe() {
  return chatList.live({ content: "" });
}
`,
      "utf8"
    );
    const r = impactReport(root, "chatInputSchema");
    expect(r.endpoints.map((e) => `${e.name}:${e.roles.join("+")}`).sort()).toEqual(["chat.ask:contract", "chat.list:contract"]);
    const callAsk = r.callSites.find((c) => c.ident === "chatAsk");
    expect(callAsk).toMatchObject({ usage: "call", file: "src/pages/Chat.atr.ts", line: 4 });
    const callLive = r.callSites.find((c) => c.ident === "chatList");
    expect(callLive).toMatchObject({ usage: "live", file: "src/pages/Chat.atr.ts", line: 9 });

    // output 侧引用也算影响面；未命中 → 空链 + 诚实注记（导航非门禁，绝不抛错）
    const outSide = impactReport(root, "chatMessageSchema");
    expect(outSide.endpoints.map((e) => e.name)).toEqual(["chat.ask"]);
    const miss = impactReport(root, "noSuchSchema");
    expect(miss.endpoints).toEqual([]);
    expect(miss.callSites).toEqual([]);
    expect(miss.notes.join("\n")).toContain("未发现静态引用");
  });

  it("CLI 直跑（--root/--mount/--from-specs）：诚实清单输出 + 产物落盘", () => {
    const root = makeFixture();
    const out = execFileSync(process.execPath, [GEN_SCRIPT, "--root", root, "--mount", "/rpc", "--from-specs"], { encoding: "utf8" });
    expect(out).toContain("gen endpoint");
    expect(out).toContain("/rpc");
    expect(out).toContain("骨架写入");
    expect(out).toContain("永不覆盖");
    const api = fs.readFileSync(path.join(root, "src", "generated", "api.ts"), "utf8");
    expect(api).toContain(`fetch("/rpc/chat.ask"`);
  });
});

/* ---------- auth 面（FS-M2-d 挂账销账：api.ts 客户端覆盖 gen auth 产物） ---------- */

/** 写夹具文件（auth 面专用——makeFixture 的 w 不外泄，避免动既有用例） */
function writeFixtureFile(root: string, rel: string, text: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text, "utf8");
}

/** auth 夹具：契约单源存在但不含 auth 契约（auth 契约单源 = gen auth 产物自身）+ 真实 genAuth 产物 */
function makeAuthFixture(): string {
  const root = makeRoot();
  writeFixtureFile(root, "src/contract.ts", `export const appUnusedSchema = { type: "object", reqProps: { x: { type: "string" } } };\n`);
  genAuth(root); // 真实产物五件套（§6.1）：sessions.table/cookie/auth/endpoints + 迁移对
  return root;
}

describe("auth 面（FS-M2-d 挂账销账：api.ts 客户端覆盖 gen auth 产物三形态）", () => {
  it("负例（加法语义）：无 gen auth 产物时扫描面零影响——端点清单与产物均无 auth 痕迹", () => {
    const root = makeFixture(); // chat 夹具，无 src/server/auth/
    expect(scanEndpoints(root).map((e) => e.name)).toEqual(["chat.ask", "chat.list"]);
    const { content, notes } = generateApi(root, { mount: "/api" });
    expect(notes).toEqual([]);
    expect(content).not.toContain("authLogin");
    expect(content).not.toContain("auth 投影段");
  });

  it("gen auth 产物三形态投影：内联字面量合成名 / pick 本地表投影 / auth:{type:\"none\"} 容忍；regen 幂等；notes 零警告", () => {
    const root = makeAuthFixture();
    const eps = scanEndpoints(root).filter((e) => e.authSurface);
    expect(eps.map((e) => e.name)).toEqual(["auth.login", "auth.logout", "auth.me"]);
    const { content, notes, endpoints } = generateApi(root, { mount: "/api" });
    expect(endpoints.filter((e) => e.authSurface).length).toBe(3);
    expect(notes).toEqual([]); // 合成名不触发「契约单源未声明」；pick 投影解析成功
    // ① 端点级内联契约字面量（仅 auth 扫描面放行）→ 合成名投影类型（M7-C 先例 auth.login.input/.output 同款）
    expect(content).toContain("type AuthLoginInput = { email: string; password: string };");
    expect(content).toContain("type AuthLoginOutput = { ok: boolean };");
    expect(content).toContain("type AuthLogoutOutput = { ok: boolean };");
    // ② pick(users.rowSchema, […]) 本地投影 → 列子集类型（与 server/db.ts table/pick 语义对表）
    expect(content).toContain("type AuthMeOutput = { email: string; role: string };");
    // 投影段显式区块 + 来源注记；本地 pick 标识符绝不漏进产物（双源红线）；auth 契约不来自契约单源
    expect(content).toContain("// —— auth 投影段");
    expect(content).toContain("gen auth 产物投影");
    expect(content).not.toContain("meOutput");
    expect(content).not.toContain(`from "../contract.ts";`);
    // 客户端形态与既有端点同构（全 POST）；auth:{type:"none"} 不影响解析（login 契约已投影即证）
    expect(content).toContain(`export const authLogin = Object.freeze({`);
    expect(content).toContain(`name: "auth.login" as const,`);
    expect(content).toContain(`fetch("/api/auth.login", {`);
    expect(content).toContain(`export const authMe = Object.freeze({`);
    expect(content).toContain(`async call(input: Record<string, unknown>): Promise<AuthMeOutput> {`);
    // Set-Cookie 语义 JSDoc（同源 fetch 自动携带，无需 credentials 配置）
    expect(content).toContain("Set-Cookie");
    // regen 字节幂等（§7.3 门禁 2，auth 面同门禁）
    expect(generateApi(root, { mount: "/api" }).content).toBe(content);
    expect(writeApi(root, { mount: "/api" }).changed).toBe(true);
    expect(writeApi(root, { mount: "/api" }).changed).toBe(false);
  });

  it("pick 列→TS 映射对表（server/db.ts table/pick 语义）：notNull→必填、nullable→可选、enum→字面量联合、integer→number", () => {
    const root = makeRoot();
    writeFixtureFile(root, "src/contract.ts", `export const appUnusedSchema = { type: "object", reqProps: { x: { type: "string" } } };\n`);
    writeFixtureFile(
      root,
      "src/server/auth/sessions.table.ts",
      `import { table } from "../../vendor/atelier/server/db.ts";
export const users = table("users", {
  id: { type: "integer", primaryKey: true },
  email: { type: "text", notNull: true },
  nickname: { type: "text" },
  level: { type: "integer", notNull: true, enum: [1, 2, 3] },
  role: { type: "text", notNull: true, enum: ["user", "admin"] },
});
`
    );
    writeFixtureFile(
      root,
      "src/server/auth/endpoints.ts",
      `import { defineQuery } from "../../vendor/atelier/server/index.ts";
import { users } from "./sessions.table.ts";

const profileOutput = pick(users.rowSchema, ["email", "nickname", "level", "role"]);

export const authProfile = defineQuery("auth.profile", {
  output: profileOutput,
  auth: { type: "session" },
  handler: () => ({ email: "", nickname: null, level: 1, role: "user" }),
});
`
    );
    const { content, notes } = generateApi(root, { mount: "/api" });
    expect(notes).toEqual([]);
    // reqProps 先于 optProps（pick 产物结构序）；键序 = pick 键序过滤后的声明序（字节确定性）
    expect(content).toContain(`type AuthProfileOutput = { email: string; level: 1 | 2 | 3; role: "user" | "admin"; nickname?: string };`);
  });

  it("诚实降级：pick 键漂移 → 定向 note + 契约单源路径红检传导；内联字面量解析失败 → 回退 note", () => {
    const root = makeRoot();
    writeFixtureFile(root, "src/contract.ts", `export const appUnusedSchema = { type: "object", reqProps: { x: { type: "string" } } };\n`);
    writeFixtureFile(
      root,
      "src/server/auth/sessions.table.ts",
      `import { table } from "../../vendor/atelier/server/db.ts";
export const users = table("users", {
  id: { type: "integer", primaryKey: true },
  email: { type: "text", notNull: true },
});
`
    );
    writeFixtureFile(
      root,
      "src/server/auth/endpoints.ts",
      `import { defineCommand, defineQuery } from "../../vendor/atelier/server/index.ts";
import { users } from "./sessions.table.ts";

const meOutput = pick(users.rowSchema, ["nope"]);

export const authMe = defineQuery("auth.me", {
  output: meOutput,
  auth: { type: "session" },
  handler: () => ({ email: "" }),
});
export const authBroken = defineCommand("auth.broken", {
  contract: { type: "object", reqProps: { ...spreadNotALiteral } },
  handler: async () => ({ ok: true }),
});
`
    );
    const { content, notes } = generateApi(root, { mount: "/api" });
    const joined = notes.join("\n");
    expect(joined).toContain("auth.me");
    expect(joined).toContain("meOutput"); // 定向 note：pick 投影解析失败（键漂移可导航）
    expect(joined).toContain("解析失败");
    expect(joined).toContain("auth.broken"); // 内联字面量解析失败（展开 = 扁平纪律外）note
    // 红检传导（§7.3 门禁四）：解析失败的标识符照旧走契约单源路径 → 生成物带类型错误出现
    expect(content).toContain(`import { meOutput } from "../contract.ts";`);
    expect(content).toContain(`type AuthMeOutput = FlatOf<typeof meOutput>;`);
    // 解析失败的内联字面量 → 诚实回退（绝不猜）
    expect(content).toContain(`async call(input: Record<string, unknown>): Promise<unknown> {`);
  });

  it("用户端点面行内字面量禁令原样保留（allowInlineLiterals 仅 auth 扫描面传入）", () => {
    const src = `export const xy = defineCommand("x.y", {
  contract: { type: "object", reqProps: { a: { type: "string" } } },
  handler: () => ({ ok: true }),
});`;
    const plain = scanEndpointSource(src);
    expect(plain[0]?.contract).toBeNull(); // 行内字面量不识别（诚实边界，原样保留）
    const allowed = scanEndpointSource(src, { allowInlineLiterals: true });
    expect(allowed[0]).toMatchObject({ contract: "x.y.input", output: null });
    expect(allowed[0]?.contractFlat).toMatchObject({ type: "object" });
  });

  it("scanApiClient 看见 auth 客户端（端点名 → 导出标识符映射，impact 链路可接通）", () => {
    const root = makeAuthFixture();
    writeApi(root, { mount: "/api" });
    const clients = scanApiClient(root).clients.filter((c) => c.endpoint.startsWith("auth."));
    expect(clients.map((c) => `${c.endpoint}=${c.ident}`).sort()).toEqual(["auth.login=authLogin", "auth.logout=authLogout", "auth.me=authMe"]);
  });
});
