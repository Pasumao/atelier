/**
 * r3-route-matchers.test.ts — R3 收口批（2026-09-30 架构评审 §2.2 风险 2 / §4.5 / §6 批次 R3）：
 * createHandler 路由表化的**路由匹配层**单测矩阵。
 *
 * 背景：createHandler 返回闭包约 240 行十段 if-chain——「这条路径属于哪条路由」的匹配判定与
 * 「命中后的闸门/分发」执行交织平铺，匹配逻辑没有可测试面（mount 前缀边界 P1#14 能存活至今，
 * 正说明路由匹配无法被单独测试）。R3 把匹配层提为模块级纯函数（输入 = mount 剥离后的
 * (method, name) + 查表窄口，输出 = RouteDecision 穷尽槽位；零 IO、零闭包），闸门/执行留在
 * 路由表 handle——匹配器自此可单测。
 *
 * 矩阵口径（任务书指定 + 边界补全）：/api/q、/api（挂载根）、/apifoo（mount "/" 边界负例）、
 * /api/upload/x、/api/assets/<sha>、/api/__atelier/health、未知挂载、非 POST 打 query、
 * /live 后缀族、server-status 保留字、终局 405/404 兜底序。
 *
 * 纪律（§14.2）：先红后绿——红检阶段匹配器/stripMountPrefix 尚不存在（命名导出缺失），
 * 本文件跑红；重构落地后转绿。既有 createHandler 行为断言（server/restful-get/uploads/
 * health/server-security 各套件）**零修改**为行为逐字节等价的成功标准——本文件只新增，
 * 不复述集成行为。
 */
import { describe, expect, it } from "vitest";
import {
  defineQuery,
  defineCommand,
  type EndpointDef,
  type RouteDecision,
  type RouteLookup,
  matchAssetsRoute,
  matchEndpointRoute,
  matchHealthRoute,
  matchIntrospectRoute,
  matchLiveRoute,
  matchUploadRoute,
  stripMountPrefix,
} from "../server/endpoints";

/* ---------- 匹配层输入构造：与 createHandler 分发前奏同源同形（strip → trim） ---------- */
const probeOf = (method: string, pathname: string, mount = "/api"): { method: string; name: string } => {
  const rest = stripMountPrefix(pathname, mount);
  return { method, name: rest.replace(/^\/+|\/+$/g, "") };
};

const lookupOf = (defs: EndpointDef[]): RouteLookup => {
  const table = new Map(defs.map((d) => [d.name, d]));
  return { getEndpoint: (n) => table.get(n) };
};

/** 终局匹配的矩阵助手：mount 剥离 + 修剪 + 查表（表序前提 = 前置路由条目已让过——见各用例注） */
const terminal = (method: string, pathname: string, defs: EndpointDef[] = [], mount = "/api"): RouteDecision =>
  matchEndpointRoute(probeOf(method, pathname, mount), lookupOf(defs));

const SHA = "a".repeat(64);

describe("R3 路由匹配层：stripMountPrefix（mount 前缀 / 边界——P1#14 口径单测化）", () => {
  it("挂载内路径剥离：/api/q → /q；挂载根 /api → 空串；尾斜 /api/ → /（修剪交回调用方）", () => {
    expect(stripMountPrefix("/api/q", "/api")).toBe("/q");
    expect(stripMountPrefix("/api", "/api")).toBe("");
    expect(stripMountPrefix("/api/", "/api")).toBe("/");
  });

  it("无 / 边界不剥离（负例）：/apifoo 与 /apiupload/x 原样保留——不得切成端点 foo / upload/x", () => {
    expect(stripMountPrefix("/apifoo", "/api")).toBe("/apifoo");
    expect(stripMountPrefix("/apiupload/x", "/api")).toBe("/apiupload/x");
  });

  it("未知挂载不剥离：/other/q 对 mount /api 原样保留（直挂宿主 404 面）", () => {
    expect(stripMountPrefix("/other/q", "/api")).toBe("/other/q");
  });

  it("根挂载（mount 空串）不剥离：全路径即 rest", () => {
    expect(stripMountPrefix("/q", "")).toBe("/q");
    expect(stripMountPrefix("/a/b", "")).toBe("/a/b");
  });
});

describe("R3 路由匹配层：live 后缀路由（FS-7 SSE 通道）", () => {
  it("GET <name>/live → live 槽位（base = 去后缀名）", () => {
    expect(matchLiveRoute({ method: "GET", name: "q/live" })).toEqual({ route: "live", base: "q" });
    expect(matchLiveRoute({ method: "GET", name: "a.b/live" })).toEqual({ route: "live", base: "a.b" });
  });

  it("非 GET 不命中（POST <name>/live 落端点面 404——live 通道仅 GET）", () => {
    expect(matchLiveRoute({ method: "POST", name: "q/live" })).toBeNull();
    expect(matchLiveRoute({ method: "PUT", name: "q/live" })).toBeNull();
  });

  it("无 /live 后缀不命中；裸 \"live\"（修剪后）不命中——后缀必须有 / 边界", () => {
    expect(matchLiveRoute({ method: "GET", name: "q" })).toBeNull();
    expect(matchLiveRoute({ method: "GET", name: "live" })).toBeNull();
    expect(matchLiveRoute({ method: "GET", name: "livehere" })).toBeNull();
  });
});

describe("R3 路由匹配层：内省保留路由（__atelier/server-status）", () => {
  it("GET 精确名命中；prod 隐身的放行语义在执行层（handle 回 null → 表放行下一条）", () => {
    expect(matchIntrospectRoute({ method: "GET", name: "__atelier/server-status" })).toEqual({ route: "introspect" });
  });

  it("非 GET 不命中（POST server-status 落终局——保留名含 \"/\" 不在端点名文法 → unknown-endpoint 404）", () => {
    expect(matchIntrospectRoute({ method: "POST", name: "__atelier/server-status" })).toBeNull();
  });

  it("近邻名不命中（精确匹配无前缀外溢）", () => {
    expect(matchIntrospectRoute({ method: "GET", name: "__atelier/server-statusx" })).toBeNull();
    expect(matchIntrospectRoute({ method: "GET", name: "x/__atelier/server-status" })).toBeNull();
  });
});

describe("R3 路由匹配层：健康保留路由（__atelier/health）", () => {
  it("精确名命中——匹配层与方法无关（非 GET 的 405 ATR-311 在执行层）", () => {
    expect(matchHealthRoute({ method: "GET", name: "__atelier/health" })).toEqual({ route: "health" });
    expect(matchHealthRoute({ method: "POST", name: "__atelier/health" })).toEqual({ route: "health" });
    expect(matchHealthRoute({ method: "HEAD", name: "__atelier/health" })).toEqual({ route: "health" });
  });

  it("近邻名不命中", () => {
    expect(matchHealthRoute({ method: "GET", name: "__atelier/healthx" })).toBeNull();
    expect(matchHealthRoute({ method: "GET", name: "__atelier/health/sub" })).toBeNull();
  });
});

describe("R3 路由匹配层：上传面路由（upload/ 前缀）", () => {
  it("upload/<name> → upload 槽位（名 = 前缀后剩余）", () => {
    expect(matchUploadRoute({ method: "GET", name: "upload/photos" })).toEqual({ route: "upload", uploadName: "photos" });
    expect(matchUploadRoute({ method: "POST", name: "upload/photos" })).toEqual({ route: "upload", uploadName: "photos" });
  });

  it("匹配层与方法无关（405 改 POST / 面未装配 404 都在执行层）", () => {
    expect(matchUploadRoute({ method: "DELETE", name: "upload/x" })).toEqual({ route: "upload", uploadName: "x" });
  });

  it("空名形态照命中（upload/ 后无名）——未知上传面 404 由执行层承接", () => {
    expect(matchUploadRoute({ method: "POST", name: "upload/" })).toEqual({ route: "upload", uploadName: "" });
  });

  it("无斜缀前缀不命中（upload 整词是端点名空间，不外溢）", () => {
    expect(matchUploadRoute({ method: "POST", name: "upload" })).toBeNull();
    expect(matchUploadRoute({ method: "POST", name: "uploadx/y" })).toBeNull();
  });
});

describe("R3 路由匹配层：资产面路由（assets/ 前缀）", () => {
  it("assets/<sha> → assets 槽位；匹配层不做 64-hex 形态闸（非法形态 404 在执行层）", () => {
    expect(matchAssetsRoute({ method: "GET", name: `assets/${SHA}` })).toEqual({ route: "assets", sha: SHA });
    expect(matchAssetsRoute({ method: "GET", name: "assets/not-a-sha" })).toEqual({ route: "assets", sha: "not-a-sha" });
  });

  it("空名形态照命中；非 GET 亦命中（405 改 GET 在执行层）", () => {
    expect(matchAssetsRoute({ method: "GET", name: "assets/" })).toEqual({ route: "assets", sha: "" });
    expect(matchAssetsRoute({ method: "POST", name: `assets/${SHA}` })).toEqual({ route: "assets", sha: SHA });
  });

  it("upload/ 前缀不与 assets/ 相交（兄弟命名空间）", () => {
    expect(matchAssetsRoute({ method: "GET", name: "upload/x" })).toBeNull();
    expect(matchUploadRoute({ method: "GET", name: `assets/${SHA}` })).toBeNull();
  });
});

describe("R3 路由匹配层：终局端点路由（restful GET / POST 分发 / 405-404 兜底）", () => {
  const qDef = defineQuery("q", { handler: () => ({}) });
  const qRestful = defineQuery("qr", { restful: true, handler: () => ({}) });
  const cmdDef = defineCommand("cmd", { handler: () => ({}) });
  const defs = [qDef, qRestful, cmdDef];

  it("POST 已注册端点 → endpoint-post（query 与 command 同走 POST——读写二分不因动词分叉）", () => {
    expect(terminal("POST", "/api/q", defs)).toEqual({ route: "endpoint-post", def: qDef });
    expect(terminal("POST", "/api/cmd", defs)).toEqual({ route: "endpoint-post", def: cmdDef });
  });

  it("POST 未注册 → unknown-endpoint（404 ATR-310 兜底）", () => {
    expect(terminal("POST", "/api/nope", defs)).toEqual({ route: "unknown-endpoint" });
  });

  it("挂载根 POST（/api → name 空串）→ unknown-endpoint（既有兜底：未知端点空名）", () => {
    expect(terminal("POST", "/api", defs)).toEqual({ route: "unknown-endpoint" });
  });

  it("mount \"/\" 边界负例：/apifoo 不切给端点 foo——unknown-endpoint \"apifoo\"", () => {
    const apiFoo = defineQuery("foo", { handler: () => ({}) });
    expect(terminal("POST", "/apifoo", [apiFoo])).toEqual({ route: "unknown-endpoint" });
  });

  it("未知挂载：/other/q 对 mount /api → name \"other/q\" → unknown-endpoint（不命中挂载内端点）", () => {
    expect(terminal("POST", "/other/q", defs)).toEqual({ route: "unknown-endpoint" });
  });

  it("非 POST 打 query：GET 未声明 restful → not-post（405 ATR-311 兜底，fix 补 restful 指路）", () => {
    expect(terminal("GET", "/api/q", defs)).toEqual({ route: "not-post" });
  });

  it("GET 声明 restful:true 的 query → restful-get（决策 34 运行时 GET 分发）", () => {
    expect(terminal("GET", "/api/qr", defs)).toEqual({ route: "restful-get", def: qRestful });
  });

  it("GET 未知名 → not-post（兜底序：405 方法闸先于 404 端点查表——既有口径）", () => {
    expect(terminal("GET", "/api/nope", defs)).toEqual({ route: "not-post" });
  });

  it("其余动词（PUT/DELETE）恒 not-post（端点面只认 POST/restful GET 两通道）", () => {
    expect(terminal("PUT", "/api/q", defs)).toEqual({ route: "not-post" });
    expect(terminal("DELETE", "/api/nope", defs)).toEqual({ route: "not-post" });
  });

  it("保留名落终局：POST __atelier/server-status → unknown-endpoint（名含 \"/\" 不在 NAME_RE 文法）", () => {
    expect(terminal("POST", "/api/__atelier/server-status", defs)).toEqual({ route: "unknown-endpoint" });
  });

  it("终局匹配器只看端点表：upload/、assets/、/live 后缀由前置表项先行命中（表序前提注记）", () => {
    // 终局槽位对这三族路径照查端点表（前置路由已让过的形态在此 404/405）——表序在 createHandler
    // 的 ROUTES 数组单一声明；本断言钉终局自身的诚实语义，不复述表序。
    expect(terminal("POST", "/api/upload/x", defs)).toEqual({ route: "unknown-endpoint" });
    expect(terminal("GET", `/api/assets/${SHA}`, defs)).toEqual({ route: "not-post" });
    expect(terminal("GET", "/api/q/live", defs)).toEqual({ route: "not-post" });
  });
});
