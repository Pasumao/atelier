/**
 * main.ts — 应用入口（Atelier starter）。
 * 流程：加载 atelier.config.json（token 单源）→ 导入组件（注册）→ 挂载根组件 → dev 状态桥。
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

// dev 状态桥（决策 7）：$state 图 → dev 面 → MCP `state.snapshot`。须在挂载后安装以捕获既有信号集。
installStateBridge();

// 会话初始锚点：代理经 MCP `checkpoint.list` 即有非空时间线可依
store.commit("session-start");

// 控制台自检：注册表查询面（决策 7；devFetch 携 token，避免 ATR-402 噪音）
devFetch("/__atelier/registry")
  .then((r) => r.json())
  .then((j) => console.info("[atelier] registry:", j.components.map((c: { name: string }) => c.name)));
