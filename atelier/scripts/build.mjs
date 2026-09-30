#!/usr/bin/env node
/**
 * build.mjs — `atelier build`：自托管单容器产线（D-F14，FS-DESIGN §12 v1 两 target）。
 *
 *   atelier build --root <dir> --target=node|bun [--out <dir>] [--no-smoke]
 *
 * 产物（§12：node/bun 单入口 + SQLite 卷；差异 = 启动壳 30 行——壳本身，框架侧零差异）：
 *   <out>/index.html + assets/   前端静态产物（应用自身 vite build——devDependency 零新增依赖；
 *                                vite.config build define 注入 __ATELIER_BUILD_PROD__ → 决策 27
 *                                浏览器面 DCE 通道，dev serve 不注）
 *   <out>/server.mjs             服务端启动壳（生成物）：prod 旗预置（决策 27 服务面激活通道——
 *                                置位先于 await import 装配单源）+ 框架版本注入（__ATELIER_VERSION__，
 *                                build 时点动态读 package.json——health 面 version 消费）+ env 三件
 *                                解析 + withStaticHost 合成静态/端点双面 + serve()（node-host 单源）
 *                                监听握手
 * 装配单源 = 应用 src/server/main-server.ts 的 createAppHandler()（dev 托管与产物同一份端点
 * 注册——绝不生成第二份注册表）。vendor 单源 = src/vendor/atelier/server/{node-host,static-host}.ts。
 *
 * target 语义：
 *   node  产物壳由 node 直跑（.ts import 走原生 strip-types，Node ≥22.6）；
 *   bun   产物同构生成；探测 bun——本机有 bun → spawn 产物冒烟自证跑通；无 bun → 产物照出 +
 *         输出诚实标注「未实测」（挂账既有口径，绝不假绿称实测）；
 *   edge/serverless 等 → **显式拒绝 exit 2**（§12 不做清单：SQLite 数据层与 serverless 天然错配
 *         ——拒绝位即文档，绝不静默产出跑不起来的产物）。
 *
 * 产物冒烟自证（--no-smoke 跳过）：PORT=0 spawn 产物入口 → 收 ATELIER_SERVER_READY 握手 →
 * POST <mount>/app.ping（模板自带探活端点）+ GET / 静态 index + GET <mount>/__atelier/server-status
 * → 405 ATR-311（决策 27 服务面激活实证：壳预置旗后调试面隐身，journal-subprocess.test.ts prod
 * 负例同款断言口径）→ 杀进程。失败 exit 1 诚实红
 * （无探活端点的应用用 --no-smoke 显式跳过——不静默跳过）。
 *
 * 诚实边界（随手记）：
 * - 产物非自包含：server.mjs 相对引用 ../src/vendor（单容器**整目录部署**语义——目录整体进镜像/
 *   卷，不拆件拷贝；单文件 exe 归 package/桌面线 `bun build --compile`）；
 * - 前端走 `pnpm exec vite build --outDir <out> --emptyOutDir` 直调（模板 build script 即 vite
 *   build 等价；应用自定义 build 管线——tailwind 后处理等——不在此执行，挂账）；token 主题 AOT
 *   经 vite.config 的 generateThemeFile() 照常触发；
 * - 接库应用先迁移再起服（迁移器不在此自动执行——`atelier migrate up` 的活绝不静默代办）；
 * - TLS/压缩/缓存 CDN 化归反代（node-host §11.1 既有口径）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import url from "node:url";

const PKG = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."); // atelier/

// die 签名全仓大一统（建议书 A5）：die(msg, code = 2)——fix 文案以 "\nfix: " 并入 msg（原第三参废止）
function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

/* ---------------- 用法与 target 门 ---------------- */

const rest = process.argv.slice(2);
// --k v 与 --k=v 两种形态都认（CLI 惯例两写法；门禁测试即用 = 形态抓过这里）
const argOf = (k) => {
  const i = rest.indexOf(k);
  if (i >= 0) return rest[i + 1];
  const hit = rest.find((a) => a.startsWith(`${k}=`));
  return hit === undefined ? undefined : hit.slice(k.length + 1);
};
const root = path.resolve(argOf("--root") ?? process.cwd());
const target = argOf("--target");
const noSmoke = rest.includes("--no-smoke");
const outDir = path.resolve(argOf("--out") ?? path.join(root, "dist"));

if (!target) die("usage: atelier build --root <dir> --target=node|bun [--out <dir>] [--no-smoke]", 2);
if (target !== "node" && target !== "bun") {
  die(
    `error: 不支持的 build target "${target}"\nfix: §12 不做清单：edge/serverless 是编译期观察位（SQLite 数据层与 serverless 天然错配，适配出现真实需求再议）——v1 两 target = node | bun`,
    2,
  );
}

/* ---------------- --out 根目录关系守卫（P1-4：--emptyOutDir 不得清应用源码）----------------
 * vite 以 --emptyOutDir 清空 outDir——outDir 一旦就是 root 本体、越出 root、或覆盖 root 的
 * package.json/src，被清的就是应用源码（"--out ." 实证先例）。backup.mjs 同径「连 --force 也
 * 拒」守卫先例：坏输入在动手前即拦。产物壳以 ../src 相对引用 vendor（单容器整目录部署语义），
 * outDir 本就必须是 root 内 src 的兄弟目录——严在内不是过严而是语义要求。 */
function outDirGuardError(rootDir, out) {
  const rel = path.relative(rootDir, out);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return `error: --out 越出应用目录：${out}（root=${rootDir}）——outDir 必须严格位于 root 内且 ≠ root；vite 以 --emptyOutDir 清空 outDir，outDir 越界时被清的是应用源码本体\nfix: --out 用应用内目录（缺省 dist）——产物壳以 ../src 相对引用 vendor（单容器整目录部署语义），产物本就必须与 src/ 同居一个 root`;
  }
  for (const guarded of ["package.json", "src"]) {
    const vrel = path.relative(path.join(rootDir, guarded), out);
    if (vrel === "" || (!vrel.startsWith("..") && !path.isAbsolute(vrel))) {
      return `error: --out 覆盖应用要件：${out} 含或等于应用 ${guarded}——--emptyOutDir 先清空 outDir 再写产物，要件会被一并清掉\nfix: --out 用应用内独立目录（缺省 dist）——不要指向 src/、package.json 或其任何上层目录`;
    }
  }
  return null;
}
const outGuard = outDirGuardError(root, outDir);
if (outGuard) die(outGuard, 2);

/* ---------------- 应用前提检查（诚实红：缺件指路，绝不猜） ---------------- */

if (!fs.existsSync(path.join(root, "package.json"))) {
  die(`error: ${root} 不是 Atelier 应用（缺 package.json）\nfix: node atelier/cli.mjs init --target <dir> --name <Name>`, 2);
}
const mainServerFile = path.join(root, "src", "server", "main-server.ts");
if (!fs.existsSync(mainServerFile)) {
  die(`error: 缺 ${path.relative(root, mainServerFile)}（server 面装配点）\nfix: init 产物自带；自定义布局请补装配点文件`, 2);
}
const mainServerSrc = fs.readFileSync(mainServerFile, "utf8");
if (!/createAppHandler/.test(mainServerSrc)) {
  die(
    `error: ${path.relative(root, mainServerFile)} 未导出 createAppHandler()（D-F14 build 装配单源——本应用先于该形态）\nfix: 对照框架模板 templates/app/src/server/main-server.ts 重构：导出 createAppHandler()（createHandler 装配收口）+ 主模块判定才 serve；或重 init`,
    2,
  );
}
for (const f of ["node-host.ts", "static-host.ts"]) {
  if (!fs.existsSync(path.join(root, "src", "vendor", "atelier", "server", f))) {
    die(`error: vendor 缺 src/vendor/atelier/server/${f}（应用 vendor 落后于框架时点）\nfix: node atelier/cli.mjs sync --target ${root}`, 2);
  }
}

/* ---------------- ① 前端静态产物：应用自身 vite build（零新增依赖） ---------------- */

console.log(`[atelier build] target=${target} → ${outDir}`);
console.log("[atelier build] ① vite build（前端静态面）…");
const viteArgs = ["exec", "vite", "build", "--outDir", outDir, "--emptyOutDir"];
// win32 单字符串命令（args 数组 + shell:true 触发 Node 24 DEP0190 警告污染 stderr——零噪声纪律）
const vite =
  process.platform === "win32"
    ? spawnSync(`pnpm ${viteArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`, { cwd: root, shell: true, stdio: "inherit", windowsHide: true })
    : spawnSync("pnpm", viteArgs, { cwd: root, stdio: "inherit", windowsHide: true });
if (vite.status !== 0) {
  die(`error: vite build 失败（exit ${vite.status}）——上方为原样输出`, 1);
}
if (!fs.existsSync(path.join(outDir, "index.html"))) {
  die(`error: 产物缺 ${outDir}/index.html（vite outDir 与 --out 错配？）\nfix: 应用自定义了 outDir 时，--out 传同一目录`, 1);
}

/* ---------------- ② 服务端启动壳（生成物勿手改；重跑 build 再生） ---------------- */

console.log("[atelier build] ② 产物启动壳 server.mjs（装配单源 createAppHandler + vendor serve 单源）…");
// W-A health version：build 执行时动态读框架 atelier/package.json 的 version 注入产物壳——绝不硬编码
// 版本串（跨分支契约：改版本号的分支与本支零耦合）；PKG 即本文件既有的 atelier 根定位。
const atelierVersion = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const shell = `/**
 * server.mjs — \`atelier build --target=${target}\` 产物启动壳（D-F14；生成物勿手改，重跑 build 再生）。
 * 单容器双面：静态前端（本目录）+ <mount>/* 端点面——装配单源 = ../src/server/main-server.ts 的
 * createAppHandler()，监听/握手单源 = vendor node-host.ts serve()（§11.1 三方契约）。
 * env：ATELIER_SERVER_PORT（缺省 5174，0=自动）/ ATELIER_SERVER_MOUNT（缺省 /api）；
 * ATELIER_DB_PATH 归应用装配侧读取（gen db 接线后同一 env）。诚实边界：本目录须与 src/ 整体
 * 部署（相对引用 vendor 单源——单文件打包归 package/桌面线）；TLS/压缩归反代。
 */
import { fileURLToPath } from "node:url";

// 决策 27 F-2 prod 剥离：服务面激活 = 壳预置旗（endpoints.ts/introspect.ts 的 isProd() 逐请求
// 动态读，端点模块零改动即激活：server-status 调试面隐身、生产语义全面点亮）。
// 置位必须先于 await import——静态 import 会 ESM 提升到模块顶部，置位将晚于装配链模块 init，
// 动态读永远赶不上（journal-subprocess.test.ts 生成夹具壳的同类置位陷阱 = 实证先例）。
globalThis.__ATELIER_PROD__ = true;

// W-A health version：壳注入框架版本（build 时点动态读 atelier/package.json，非硬编码——改版本号
// 零耦合）。同款时序：置位先于 await import 装配（main-server.ts 装配点读本值进 health 面 version；
// dev 托管不经壳 = null，旧模板应用无注入同归 null）。
globalThis.__ATELIER_VERSION__ = ${JSON.stringify(atelierVersion)};

const { serve } = await import("../src/vendor/atelier/server/node-host.ts");
const { withStaticHost } = await import("../src/vendor/atelier/server/static-host.ts");
const { createAppHandler } = await import("../src/server/main-server.ts");

const port = Number(process.env.ATELIER_SERVER_PORT ?? 5174);
const mount = process.env.ATELIER_SERVER_MOUNT ?? "/api";
const handler = withStaticHost(await createAppHandler(), { dir: fileURLToPath(new URL("./", import.meta.url)), mount });
serve(handler, { port, host: "127.0.0.1" }).catch((e) => {
  console.error(\`[atelier] 产物 server 启动失败：127.0.0.1:\${port} —— \${e?.message ?? e}\`);
  console.error("[atelier] fix：设 ATELIER_SERVER_PORT 换端口，或释放被占端口后重跑（固定端口不静默换口）。");
  process.exit(1);
});
`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "server.mjs"), shell, "utf8"); // utf8 显式 + 源码字面 LF（无 \r 注入）

/* ---------------- ③ 产物冒烟自证：PORT=0 spawn → 握手 → 双面探活 → 收尸 ---------------- */

const bunMissing = target === "bun" && spawnSync("bun", ["--version"], { encoding: "utf8", windowsHide: true }).status !== 0;
let smoke = "skipped (--no-smoke)";
if (!noSmoke && bunMissing) {
  smoke = "未实测（本机无 bun——产物照出，挂账既有口径；有 bun 的宿主直接跑下述运行命令即可）";
} else if (!noSmoke) {
  console.log(`[atelier build] ③ 冒烟自证（${target} runtime，PORT=0 → 握手 → app.ping + 静态 index + server-status 405）…`);
  const entry = path.join(outDir, "server.mjs");
  const smokeMount = process.env.ATELIER_SERVER_MOUNT ?? "/api"; // 与产物壳同读一份 env（壳缺省同值）
  const proc = spawn(target === "bun" ? "bun" : process.execPath, [entry], {
    cwd: outDir,
    env: { ...process.env, ATELIER_SERVER_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  proc.stdout?.on("data", (c) => (out += c.toString("utf8")));
  proc.stderr?.on("data", (c) => (out += c.toString("utf8")));
  const ready = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: proc.stdout });
    const timer = setTimeout(() => settle(null), 15_000);
    function settle(v) {
      clearTimeout(timer);
      rl.close();
      resolve(v);
    }
    rl.on("line", (line) => {
      const m = line.match(/^ATELIER_SERVER_READY \{"port":(\d+)\}\s*$/);
      if (m) settle(Number(m[1]));
    });
    proc.on("exit", () => settle(null));
  });
  let ok = false;
  let note = "";
  if (ready != null) {
    try {
      const ping = await fetch(`http://127.0.0.1:${ready}${smokeMount}/app.ping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      const index = await fetch(`http://127.0.0.1:${ready}/`, { signal: AbortSignal.timeout(5_000) });
      // 决策 27 服务面激活实证：壳预置 __ATELIER_PROD__ 旗 → server-status 调试面隐身，GET 落回
      // 非 POST 分支 405 ATR-311（journal-subprocess.test.ts prod 负例同款口径——分发器顺序实读，非 404）
      const hidden = await fetch(`http://127.0.0.1:${ready}${smokeMount}/__atelier/server-status`, { signal: AbortSignal.timeout(5_000) });
      const hiddenBody = await hidden.json().catch(() => ({}));
      ok = ping.status === 200 && index.status === 200 && hidden.status === 405 && hiddenBody?.code === "ATR-311";
      note = `app.ping ${ping.status} · index ${index.status} · server-status ${hidden.status}${hiddenBody?.code ? ` ${hiddenBody.code}` : ""}`;
    } catch (e) {
      note = `探活请求失败：${e?.message ?? e}`;
    }
  } else {
    note = "15s 未收到 ATELIER_SERVER_READY 握手行（或入口提前退出）";
  }
  if (proc.exitCode === null && !proc.killed) proc.kill(); // Windows kill=即终止；握手失败也不留孤儿
  await new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", r)));
  if (!ok) {
    die(`error: 产物冒烟自证未通过（${note}）\n子进程原样输出：\n${out.trim()}\nfix: 产物已生成可人工复查；无 app.ping 探活端点的应用可用 --no-smoke 显式跳过（不静默跳过）`, 1);
  }
  smoke = `app.ping 200 · index 200 · server-status 405 ATR-311（${target} runtime）`;
}

/* ---------------- 出账：产物清单 + 运行指引 + 诚实边界 ---------------- */

const runCmd = target === "bun" ? `bun ${path.relative(root, path.join(outDir, "server.mjs"))}` : `node ${path.relative(root, path.join(outDir, "server.mjs"))}`;
// 决策 27：prod 剥离体积 delta 诚实可见（define DCE 后的 JS 产物实况；数字不冻结——门禁只验行存在）
const assetsDir = path.join(outDir, "assets");
const jsAssets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith(".js")) : [];
const jsKb = (jsAssets.reduce((sum, f) => sum + fs.statSync(path.join(assetsDir, f)).size, 0) / 1024).toFixed(1);
console.log(`[atelier build] 产物齐备 → ${outDir}`);
console.log(`  前端静态面: ${path.relative(root, path.join(outDir, "index.html"))} (+assets/，vite 产物)`);
console.log(`  prod 剥离: JS 产物 ${jsAssets.length} 文件共 ${jsKb} KB（define DCE 后）`);
console.log(`  服务端入口: ${path.relative(root, path.join(outDir, "server.mjs"))}（装配单源 main-server.createAppHandler）`);
console.log(`  冒烟自证: ${smoke}`);
console.log("\n运行（单容器整目录部署——dist 与 src/ 相对引用不拆件）：");
console.log(`  ATELIER_DB_PATH=<sqlite 卷路径> ${runCmd}   # 监听 127.0.0.1:5174（ATELIER_SERVER_PORT 可换，0=自动）`);
console.log(`接库应用先迁移再起服：ATELIER_DB_PATH=<卷> node ${path.relative(root, path.join(PKG, "cli.mjs"))} migrate up --root ${root}`);
console.log("诚实边界：TLS/压缩/缓存 CDN 化归反代；产物非单文件（单文件 exe 归 package/桌面线）；edge/serverless = §12 不做清单。");
