/**
 * main.ts — 原型入口（对应未来 create-atelier 产物骨架）。
 * 流程：加载 atelier.config.json（token 单源）→ 导入组件（注册）→ 挂载根组件。
 */
import config from "../atelier.config.json";
import { initTokens, mountComponent, registry, validateFlat } from "./runtime";
import { DeepSeekIntro } from "../components/DeepSeekIntro.atr.ts";

initTokens(config as { tokens: Record<string, Record<string, string>> });

const app = document.getElementById("app")!;
mountComponent(DeepSeekIntro, {}, app, registry, (schema, data) => validateFlat(schema as never, data));

// 控制台自检：注册表查询面（决策 7 雏形）
fetch("/__atelier/registry")
  .then((r) => r.json())
  .then((j) => console.info("[atelier] registry:", j.components.map((c: { name: string }) => c.name)));
