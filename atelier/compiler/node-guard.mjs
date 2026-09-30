/**
 * node-guard.mjs — Atelier compiler Node 版本闸纯函数单源（REL-A A4）。
 *
 * 缺口：dump.mjs 顶层静态 import runtime/*.ts 先于 main() 内版本闸求值——Node 22.12~22.17
 * 区间进程在闸前死于 ERR_UNKNOWN_FILE_EXTENSION（无旗标 TS 类型剥离 22.18 起默认开启），
 * 用户第一触点级故障；codegen.mjs 连闸都没有。修法 = 闸做成可单测纯函数（入参版本串），
 * 在动态 import **之前**执行；闸外动态 import 仍炸 ERR_UNKNOWN_FILE_EXTENSION 时（双保险）
 * 转同款四段式，绝不放原始栈出去。
 *
 * 红线（地板决策不动）：atelier/package.json engines ≥22.12、README ≥22.12、server/sqlite.ts
 * ≥22.13 口径全部原样——22.12/22.13/22.18 统一是用户待拍板项。本闸只钉「compiler 直载
 * runtime TS」这一机制的机制地板 = 22.18（类型剥离默认开启版本，与既有死闸 die 文案一致）；
 * 22.12~22.17 语义 = 拒（fail closed：无旗标 import .ts 必死，--experimental-strip-types 存在
 * 但未达支持地板，不走此路）。零 import 自包含（compiler 扫描器族同纪律）。
 */

/** 机制地板：无旗标类型剥离（native type stripping）默认开启的版本。 */
export const TS_IMPORT_NODE_FLOOR = "22.18";

/**
 * 版本串 → 是否可直载 runtime TypeScript（无旗标类型剥离）。
 * 正向判定：maj > 22 || (maj === 22 && min >= 18)——NaN/残缺串一律 false（fail closed，绝不误放行）。
 */
export function nodeSupportsTsImport(version) {
  const [maj, min] = String(version ?? "").split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
}

/** 闸未过的 ATR 风格四段式：message = 是什么/为什么；fix = 怎么修/指路（CLI 以 die(message, fix) 上 stderr）。 */
export function nodeGuardMessage(version) {
  return {
    message:
      `Node ${version} 无法直载 TypeScript runtime——atelier compiler 直接 import runtime/*.ts（与解释器同一解析器，单一真相），` +
      `需要 Node ≥ ${TS_IMPORT_NODE_FLOOR} 的无旗标类型剥离；当前版本会在 import 处死于 ERR_UNKNOWN_FILE_EXTENSION（本闸在动态 import 前显式拦截，不暴露原始栈）`,
    fix:
      `升级 Node ≥ ${TS_IMPORT_NODE_FLOOR}（nodejs.org LTS / nvm install 22；22.12~22.17 虽可 --experimental-strip-types 但未达支持地板，不走此路），` +
      `或改在 vitest 下运行编译流程（vitest 自带 TS 转译）；node --version 查看当前版本`,
  };
}

/** 双保险判别：闸版本判断漏网时（动态 import 仍炸 .ts 扩展名）→ true，调用方转同款四段式。 */
export function isTsExtensionLoadError(e) {
  if (e == null) return false;
  return e.code === "ERR_UNKNOWN_FILE_EXTENSION" || /ERR_UNKNOWN_FILE_EXTENSION/.test(String(e.message ?? ""));
}

/** 闸错对象构造（库消费者延迟抛 / CLI 取出即 die 同款）。code 命名归 ATR 面。 */
export function nodeGuardError(version) {
  const { message, fix } = nodeGuardMessage(version);
  return Object.assign(new Error(message), { fix, code: "ATR-node-guard" });
}
