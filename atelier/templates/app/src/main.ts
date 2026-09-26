/**
 * main.ts — 应用入口（Atelier starter）。
 * 流程：加载 atelier.config.json（token 单源）→ 导入组件（注册）→ 挂载根组件 → dev 状态桥
 *（dev 装配三件经 import.meta.env.DEV 门，决策 27：build 时该分支被静态替换剔除）。
 */
import config from "../atelier.config.json";
import "./atelier-tailwind.css"; // 决策 16：token 派生 + Tailwind AOT 编译产物（生成产物，勿手改）
import "./atelier-ui.css"; // 决策 16：recipe 层（.btn/.ppanel/.tab，手写维护）
import {
  devFetch,
  initTokens,
  installStateBridge,
  mountComponent,
  registry,
  store,
  validateFlat,
} from "./runtime";
import { HelloCard } from "./components/HelloCard.atr.ts";
import { ContractProbe } from "./components/ContractProbe.atr.ts"; // P1-9 契约路径演示
import { LiveNotes } from "./components/LiveNotes.atr.ts"; // FS-7 live 直通 + §4.5 乐观对账演示
import { FormBinding } from "./components/FormBinding.atr.ts"; // 决策 25 bind: v1 双向绑定演示
import { SchemaProbe } from "./components/SchemaProbe.atr.ts"; // 决策 26 注解即 schema 核对物（无手写 schema）

initTokens(config as { tokens: Record<string, Record<string, string>> });

const app = document.getElementById("app")!;
mountComponent(HelloCard, { title: "Hello, Atelier" }, app, registry, (schema, data) =>
  validateFlat(schema as never, data),
);

// P1-9 契约路径演示：合法实例 vs 违规实例（缺 reqProps level → ATR-201 错误卡，P2-1 边界兜住不白屏）
const probeSection = document.createElement("section");
probeSection.id = "contract-demo";
app.appendChild(probeSection);
const validate = (schema: unknown, data: Record<string, unknown>) => validateFlat(schema as never, data);
mountComponent(ContractProbe, { title: "契约 OK 实例", level: 2, note: "reqProps 齐全" }, probeSection, registry, validate);
mountComponent(ContractProbe, { title: "契约违规实例（缺 reqProps: level）" } as never, probeSection, registry, validate);

// FS-7 live 直通演示：streamValue + EventSource 手写直通（§4.4，与 gen endpoint 生成物同型）
// + optimisticList 乐观对账（§4.5 协议）。server 面对端：src/server/endpoints/notes.ts
//（app.notes live query + app.addNote command）；pnpm dev 已把 /api/* 托管到 server 子进程。
const liveSection = document.createElement("section");
liveSection.id = "live-demo";
app.appendChild(liveSection);
mountComponent(LiveNotes, { title: "Live Notes — live 直通 + 乐观对账" }, liveSection, registry, validate);

// 决策 25 bind: v1 演示：bind:value × input + bind:checked × checkbox，单 attr 双向（runtime 单点 bindTwoWay）
const formSection = document.createElement("section");
formSection.id = "form-demo";
app.appendChild(formSection);
mountComponent(FormBinding, { title: "Form Binding — bind: 双向绑定" }, formSection, registry, validate);

// 决策 26 注解即 schema 演示：SchemaProbe 无手写 schema——props 注解经编译期提取（dev 插件
// transform 同源注入 sink，component() 兜底取用）。提取器缺失（未 sync）时诚实降级、照常渲染。
const schemaSection = document.createElement("section");
schemaSection.id = "schema-demo";
app.appendChild(schemaSection);
mountComponent(SchemaProbe, { label: "Schema Probe — 注解即 schema", times: 2 }, schemaSection, registry, validate);

/* —— dev 装配门（决策 27 F-2 prod 剥离 v1）：vite 对 import.meta.env.DEV 静态替换——
 * dev serve → true 照旧；build → false → 本分支构建期整体 DCE 剔除（产物不跑 dev 面）。
 * 只门 dev 观测/自检/桥接件：组件挂载与用户态逻辑绝不进门（prod 照常渲染）。
 * 静态 import 保留：installStateBridge/devFetch 模块仍随 barrel 携带（摇树 = 决策 27 诚实边界，不在此解决）。 */
if (import.meta.env.DEV) {
  // dev 状态桥（决策 7）：$state 图 → dev 面 → MCP `state.snapshot`。须在挂载后安装以捕获既有信号集。
  installStateBridge();

  // 会话初始锚点：代理经 MCP `checkpoint.list` 即有非空时间线可依
  store.commit("session-start");

  // 控制台自检：注册表查询面（决策 7；devFetch 携 token，避免 ATR-402 噪音）
  devFetch("/__atelier/registry")
    .then((r) => r.json())
    .then((j) => console.info("[atelier] registry:", j.components.map((c: { name: string }) => c.name)));
}
