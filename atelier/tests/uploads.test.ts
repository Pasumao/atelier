/**
 * uploads.test.ts — B1 文件上传/资产管道（2026-09-28 差距批；决策 32：显式注册上传面——
 * `defineUpload({ name, accept?, maxBytes?, auth? })` 兄弟注册表 + `POST <mount>/upload/<name>`
 * + `GET <mount>/assets/<id>`；磁盘内容寻址 `<uploads.dir>/<yyyy-mm>/<sha256>.<ext>` +
 * `atelier_assets` 记账。依据 docs/research/2026-09-28-fullstack-feature-gap.md §3-B1 与
 * FS-DESIGN §3.4 落地注记。
 *
 * 断言面（红检两段已随实现转绿，红/绿两段 commit 链可溯）：
 *   ① 路由契约（红检段）：multipart 打端点面 → 400 ATR-312 **永久负例**（端点面纯 JSON 纪律
 *      不放松）；未装配上传面的 upload/assets 路由 → 404 ATR-310 诚实指路装配（红态时为
 *      405 ATR-311「改 POST」误导 / 「未知端点」文案不指认上传面——红检 commit 91fa951 实证）；
 *   ② 注册面：defineUpload/registerUpload 同构端点纪律（NAME_RE/重名/maxBytes/accept → ATR-313）
 *      + introspect 端点表零变化负例（兄弟注册表不入端点表）；
 *   ③ 上传六事实 + 内容寻址去重（同 sha 单文件单行、响应名 = 首传名）+ ext 白名单清洗；
 *   ④ 闸位：定义精闸（声明值快速拒 + 无 content-length 缓冲兜底，413 ATR-346）/ accept
 *      前缀与通配（415 ATR-415）/ 非 multipart 415 / 缺 boundary·截断·多文件 part 400 ATR-312；
 *   ⑤ 解析器边界：引号转义 filename / RFC 2231 filename* 优先 + 坏 charset 回落 + fallback 名 /
 *      裸 UTF-8 中文文件名 / 二进制体逐字节保真（CRLF 归一：内容字节不含收尾行尾）；
 *   ⑥ 下载：200 流式逐字节同上传 + content-type/length + Cache-Control immutable；404 未知 id；
 *      账在盘不在 → 404 指路重传 + 重传幂等补写修复（不产生第二行）；
 *   ⑦ 原子性两态：记账失败删孤儿文件（盘上零残留）；rename 注入失败 → 临时文件清干净；
 *   ⑧ auth 拦截链：缺省 session fail-closed（401 ATR-340）/ none 显式开放 / role 403 ATR-341 /
 *      apikey 通道 + 会话优先 / readAuth 每请求恰一次；
 *   ⑨ node-host 桥：serve() 真实端口 FormData/Blob 上传→下载一轮（真 multipart 编码）；
 *      桥粗闸 max(maxBodyBytes, 20MB)——multipart 越过 JSON 桥闸、面精闸接管；JSON 桥闸不变。
 *
 * skip 策略：宿主无 node:sqlite → db 相关组诚实 skip（email.test.ts 同款 guard）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineQuery, EndpointRegistry } from "../server/endpoints";
import { ASSETS_TABLE, createUploadsFace, defineUpload, UPLOADS_DEFAULT_MAX_BYTES, type UploadDef } from "../server/uploads";
import { serve } from "../server/node-host";
import { openSqlite, type SqliteDb } from "../server/sqlite";
import { serverStatusSnapshot } from "../server/introspect";

/** multipart/form-data 测试体构造（CRLF 行尾，RFC 7578 形态） */
function multipartBody(parts: { name: string; filename?: string; contentType?: string; data: string | Uint8Array }[], boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (s: string) => chunks.push(enc.encode(s));
  const pushBytes = (b: Uint8Array) => chunks.push(b);
  for (const p of parts) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${p.name}"`);
    if (p.filename != null) push(`; filename="${p.filename}"`);
    push("\r\n");
    if (p.contentType != null) push(`Content-Type: ${p.contentType}\r\n`);
    push("\r\n");
    if (typeof p.data === "string") push(p.data);
    else pushBytes(p.data);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/* ---------------- 共享夹具 ---------------- */

const tmpDirs: string[] = [];
const openDbs: SqliteDb[] = [];
afterEach(() => {
  while (openDbs.length > 0) {
    try {
      openDbs.pop()!.close();
    } catch {
      /* 重复 close 幂等跳过 */
    }
  }
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

// node:sqlite 仅 Node ≥22.5 内建；本环境 Node 24 可用（email.test.ts 同款 skip-guard）。
let nodeSqlite = false;
try {
  await import("node:sqlite");
  nodeSqlite = true;
} catch {
  nodeSqlite = false;
}
const describeSqlite = nodeSqlite ? describe : describe.skip;

async function fixtureDb(): Promise<SqliteDb> {
  const db = await openSqlite(":memory:");
  openDbs.push(db);
  return db;
}

function fixtureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-uploads-"));
  tmpDirs.push(dir);
  return dir;
}

function assetRows(db: SqliteDb): { id: number; name: string; mime: string; size: number; sha256: string; path: string; created_at: number }[] {
  return db.prepare(`SELECT id, name, mime, size, sha256, path, created_at FROM ${ASSETS_TABLE} ORDER BY id`).all() as never;
}

/** 组装注册表 + 上传面 handler（mount /api） */
async function fixtureHandler(uploadsDef: Partial<UploadDef> & { name: string }, opts: { dir?: string; db?: SqliteDb; auth?: (req: Request) => unknown; apiKeys?: { keys: string[] }; maxBytesOverride?: number } = {}) {
  const db = opts.db ?? (await fixtureDb());
  const dir = opts.dir ?? fixtureDir();
  const reg = new EndpointRegistry();
  // 夹具缺省 = auth none（开放）——闸位与 auth 语义由专项套件显式声明覆盖；缺省 session 语义在 auth 套件内联构造验证
  reg.registerUpload(defineUpload({ auth: { type: "none" }, ...uploadsDef }));
  const face = createUploadsFace({ db, dir });
  const handlerFn = reg.createHandler({
    mount: "/api",
    db,
    uploads: face,
    ...(opts.auth ? { auth: opts.auth as (req: Request) => never } : {}),
    ...(opts.apiKeys ? { apiKeys: opts.apiKeys } : {}),
    ...(opts.maxBytesOverride != null ? { maxBodyBytes: opts.maxBytesOverride } : {}),
  });
  const post = (name: string, body: Uint8Array, contentType: string, headers?: Record<string, string>) =>
    handlerFn(new Request(`http://local.test/api/${name}`, { method: "POST", headers: { "content-type": contentType, ...headers }, body }));
  const handler = Object.assign(handlerFn, { post });
  return { db, dir, reg, handler, post };
}

/** 当前 UTC 年月（磁盘布局 yyyy-mm 段——创建时刻与断言时刻跨月概率极低，同 UTC 月内即成立） */
function utcYm(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("B1 路由契约：端点面纯 JSON 永久负例 + 未装配面诚实 404（红检段转绿）", () => {
  it("现状负例（永久）：multipart/form-data POST 打端点面 → 400 ATR-312（端点面纯 JSON 纪律，本批不放松）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.plain", { handler: () => ({ ok: true }) }));
    const body = multipartBody([{ name: "file", filename: "a.png", contentType: "image/png", data: "PNG" }], "xxboundxx");
    const res = await reg.createHandler({ mount: "/api" })(
      new Request("http://local.test/api/q.plain", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=xxboundxx" }, body })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("ATR-312");
  });

  it("红：GET /api/assets/1（未装配上传面）→ 目标 404 ATR-310 指路装配（现状 405 ATR-311「改为 POST」误导）", async () => {
    const reg = new EndpointRegistry();
    const res = await reg.createHandler({ mount: "/api" })(new Request("http://local.test/api/assets/1", { method: "GET" }));
    expect(res.status).toBe(404); // 红态：405 ATR-311（落进非 POST 兜底）
    const err = (await res.json()) as { code: string; message: string };
    expect(err.code).toBe("ATR-310");
    expect(err.message).toContain("上传");
  });

  it("红：POST /api/upload/avatar（multipart，未装配上传面）→ 404 文案须指认上传面与装配位（现状「未知端点」不指认）", async () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.other", { handler: () => ({ ok: true }) }));
    const body = multipartBody([{ name: "file", filename: "a.png", contentType: "image/png", data: "PNG" }], "xxboundxx");
    const res = await reg.createHandler({ mount: "/api", db: undefined })(
      new Request("http://local.test/api/upload/avatar", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=xxboundxx" }, body })
    );
    expect(res.status).toBe(404);
    const err = (await res.json()) as { code: string; message: string; fix: string };
    expect(err.code).toBe("ATR-310");
    expect(err.message).toContain("上传"); // 红态：「未知端点：upload/avatar」不指认上传面
    expect(err.fix).toContain("createUploadsFace"); // fix 指向上传面装配单源
  });
});
/* ================= ② 注册面：兄弟注册表 + 端点表零变化负例 ================= */

describe("B1 注册面：defineUpload/registerUpload 同构端点纪律（ATR-313 同码）", () => {
  it("注册 + 读取：reg.upload 取定义、uploadNames 排序；端点表/list() 与 introspect 端点段零变化（兄弟注册表不入端点表）", () => {
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.plain", { handler: () => ({ ok: true }) }));
    reg.registerUpload(defineUpload({ name: "zeta", accept: ["image/"] }));
    reg.registerUpload(defineUpload({ name: "alpha", maxBytes: 1024 }));
    expect(reg.upload("alpha")!.maxBytes).toBe(1024);
    expect(reg.uploadNames()).toEqual(["alpha", "zeta"]);
    expect(reg.names()).toEqual(["q.plain"]); // 端点表零混入
    expect(reg.list().map((s) => s.name)).toEqual(["q.plain"]);
    const snap = serverStatusSnapshot(reg, {});
    expect(snap.endpoints.map((e) => e.name)).toEqual(["q.plain"]); // introspect 端点表形状零变化
  });

  it("非法名 / 重名 / maxBytes 非法 / accept 非法 → 注册期 ATR-313（显式失败优于静默）", () => {
    const reg = new EndpointRegistry();
    expect(() => reg.registerUpload(defineUpload({ name: "9bad" }))).toThrow(/上传面名非法/);
    reg.registerUpload(defineUpload({ name: "avatar" }));
    expect(() => reg.registerUpload(defineUpload({ name: "avatar" }))).toThrow(/上传面重复注册/);
    expect(() => reg.registerUpload(defineUpload({ name: "x", maxBytes: 0 }))).toThrow(/maxBytes 非法/);
    expect(() => reg.registerUpload(defineUpload({ name: "x", maxBytes: -1 }))).toThrow(/maxBytes 非法/);
    expect(() => reg.registerUpload(defineUpload({ name: "x", maxBytes: Number.POSITIVE_INFINITY }))).toThrow(/maxBytes 非法/);
    expect(() => reg.registerUpload(defineUpload({ name: "x", accept: ["image/", ""] }))).toThrow(/accept 非法/);
    expect(() => reg.registerUpload(defineUpload({ name: "x", accept: "image/" as unknown as string[] }))).toThrow(/accept 非法/);
    // 端点名与上传面名互不干扰（不同注册表）
    reg.register(defineQuery("avatar", { handler: () => 1 }));
    expect(reg.names()).toContain("avatar");
  });
});

/* ================= ③ 上传六事实 + 内容寻址去重 + ext 白名单 ================= */

describeSqlite("B1 上传主径：六事实 / 磁盘 sha 命名 / 记账行 / 去重 / ext 白名单", () => {
  it("上传 → 200 六事实（id/name/mime/size/sha256/url）+ 磁盘 <yyyy-mm>/<sha256>.<ext> + 表行齐", async () => {
    const { handler, dir, db } = await fixtureHandler({ name: "avatar", accept: ["image/"] });
    const data = new TextEncoder().encode("PNG-bytes-⚙");
    const body = multipartBody([{ name: "file", filename: "logo.png", contentType: "image/png", data }], "b1test");
    const res = await handler(new Request("http://local.test/api/upload/avatar", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, unknown>;
    const sha = sha256Hex(data);
    expect(out).toEqual({ id: expect.any(Number), name: "logo.png", mime: "image/png", size: data.byteLength, sha256: sha, url: `/api/assets/${out.id}` });

    const files = fs.readdirSync(path.join(dir, utcYm()));
    expect(files).toEqual([`${sha}.png`]); // 内容寻址命名 + ext 白名单保留
    expect(new Uint8Array(fs.readFileSync(path.join(dir, utcYm(), `${sha}.png`)))).toEqual(data);

    const rows = assetRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: Number(out.id), name: "logo.png", mime: "image/png", size: data.byteLength, sha256: sha, path: `${utcYm()}/${sha}.png` });
    expect(Number.isFinite(rows[0]!.created_at)).toBe(true);
  });

  it("同内容重传去重：不同上传名 → 同 id/同 url/单文件单行（响应名 = 首传名——内容寻址资产身份）", async () => {
    const { handler, dir, db } = await fixtureHandler({ name: "avatar" });
    const data = new TextEncoder().encode("dedup-me");
    const post = (filename: string) =>
      handler(new Request("http://local.test/api/upload/avatar", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: multipartBody([{ name: "file", filename, contentType: "text/plain", data }], "b1test") }));
    const first = (await (await post("first.txt")).json()) as { id: number };
    const second = (await (await post("second.txt")).json()) as { id: number };
    expect(second.id).toBe(first.id);
    expect(second.url).toBe(`/api/assets/${first.id}`);
    expect(second.name).toBe("first.txt"); // 名保留首传——内容寻址资产身份
    expect(assetRows(db)).toHaveLength(1); // 单行
    expect(fs.readdirSync(path.join(dir, utcYm()))).toHaveLength(1); // 单文件
  });

  it("ext 白名单清洗：大写小写化 / 多点取末段 / 非法字符与超长 → bin / 无扩展名 → bin", async () => {
    const { handler, dir } = await fixtureHandler({ name: "files" });
    const post = (filename: string) =>
      handler(new Request("http://local.test/api/upload/files", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: multipartBody([{ name: "file", filename, contentType: "application/octet-stream", data: `x-${filename}` }], "b1test") }));
    await post("PHOTO.JPEG");
    await post("archive.tar.gz");
    await post("bad.e!xt");
    await post("long.123456789");
    await post("noext");
    const files = fs.readdirSync(path.join(dir, utcYm()));
    expect(files).toHaveLength(5);
    expect(
      files
        .map((f) => f.slice(f.lastIndexOf(".") + 1))
        .sort()
    ).toEqual(["bin", "bin", "bin", "gz", "jpeg"]); // 逐名清洗规则生效（大小写归一/多点取末段/非法→bin/缺省→bin）
  });
});

/* ================= ④ 闸位：定义精闸 / accept / multipart 结构 ================= */

describeSqlite("B1 定义精闸与 accept：413 ATR-346 / 415 ATR-415 / 400 ATR-312", () => {
  it("超限（声明 content-length 诚实头）→ 413 ATR-346；无 content-length（流式体）→ 缓冲实测兜底同码", async () => {
    const { handler } = await fixtureHandler({ name: "small", maxBytes: 64 });
    const big = multipartBody([{ name: "file", filename: "big.bin", contentType: "application/octet-stream", data: new Uint8Array(128) }], "b1test");
    const declared = await handler(new Request("http://local.test/api/upload/small", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: big }));
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { code: string }).code).toBe("ATR-346");

    // 无 content-length：ReadableStream 体（duplex half）——声明值闸不触发，缓冲后实测闸兜底
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(big);
        c.close();
      },
    });
    const streamed = await handler(new Request("http://local.test/api/upload/small", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: stream, duplex: "half" } as RequestInit));
    expect(streamed.status).toBe(413);
    expect(((await streamed.json()) as { code: string }).code).toBe("ATR-346");
  });

  it("accept 前缀/通配/精确三语义；不匹配与 part 缺 content-type → 415 ATR-415；缺省 accept 不限", async () => {
    const png = (ct?: string) => multipartBody([{ name: "file", filename: "a.png", ...(ct !== undefined ? { contentType: ct } : {}), data: "PNG" }], "b1test");
    const post = async (accept: string[] | undefined, ct?: string) => {
      const f = await fixtureHandler({ name: "u", ...(accept ? { accept } : {}) });
      const res = await f.post("upload/u", png(ct), "multipart/form-data; boundary=b1test");
      return res.status;
    };
    expect(await post(["image/"], "image/png")).toBe(200); // 前缀
    expect(await post(["image/*"], "image/png")).toBe(200); // 通配
    expect(await post(["image/png"], "image/png")).toBe(200); // 精确
    expect(await post(["image/"], "text/plain")).toBe(415); // 不匹配
    expect(await post(["image/"], undefined)).toBe(415); // part 缺 content-type = 不可验证 → 拒
    expect(await post(undefined, "text/plain")).toBe(200); // 缺省 accept = 不限
    const f = await fixtureHandler({ name: "u", accept: ["image/"] });
    const mismatch = await f.post("upload/u", png("text/plain"), "multipart/form-data; boundary=b1test");
    expect(((await mismatch.json()) as { code: string }).code).toBe("ATR-415");
  });

  it("非 multipart content-type → 415 ATR-415（W6 dev 面同号同语义）；multipart 缺 boundary → 400 ATR-312", async () => {
    const { handler } = await fixtureHandler({ name: "u" });
    const json = await handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(json.status).toBe(415);
    expect(((await json.json()) as { code: string }).code).toBe("ATR-415");
    const noBoundary = await handler.post("upload/u", multipartBody([{ name: "file", filename: "a.bin", data: "x" }], "b1test"), "multipart/form-data");
    expect(noBoundary.status).toBe(400);
    expect(((await noBoundary.json()) as { code: string }).code).toBe("ATR-312");
  });

  it("截断体 / 无文件 part / 多文件 part → 400 ATR-312（多文件文案点名单文件语义）；非文件 form 字段忽略不消费", async () => {
    const { handler } = await fixtureHandler({ name: "u" });
    const enc = new TextEncoder();
    const truncated = enc.encode("--b1test\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n\r\nno-close");
    const t = await handler.post("upload/u", truncated, "multipart/form-data; boundary=b1test");
    expect(t.status).toBe(400);
    expect(((await t.json()) as { code: string }).code).toBe("ATR-312");

    const noFile = multipartBody([{ name: "note", data: "just text" }], "b1test");
    const nf = await handler.post("upload/u", noFile, "multipart/form-data; boundary=b1test");
    expect(nf.status).toBe(400);

    const twoFiles = multipartBody(
      [
        { name: "a", filename: "a.txt", data: "A" },
        { name: "b", filename: "b.txt", data: "B" },
      ],
      "b1test"
    );
    const tf = await handler.post("upload/u", twoFiles, "multipart/form-data; boundary=b1test");
    expect(tf.status).toBe(400);
    expect(((await tf.json()) as { message: string }).message).toContain("单文件");

    const withTextField = multipartBody(
      [
        { name: "note", data: "ignored field" },
        { name: "file", filename: "ok.txt", contentType: "text/plain", data: "real" },
      ],
      "b1test"
    );
    const ok = await handler.post("upload/u", withTextField, "multipart/form-data; boundary=b1test");
    expect(ok.status).toBe(200); // 非文件字段忽略，文件照常入账
  });
});

/* ================= ⑤ 解析器边界：filename 形态 + 二进制保真 ================= */

describeSqlite("B1 解析器边界：引号转义 / RFC 2231 filename* / 裸 UTF-8 / 二进制逐字节", () => {
  it("引号 filename 含转义引号与分号 → 原文保留（splitParams 引号感知 + unquote 还原）", async () => {
    const { handler, db } = await fixtureHandler({ name: "u" });
    const raw = '--b1test\r\nContent-Disposition: form-data; name="file"; filename="we\\"ird;name.txt"\r\nContent-Type: text/plain\r\n\r\nbody\r\n--b1test--\r\n';
    const res = await handler.post("upload/u", new TextEncoder().encode(raw), "multipart/form-data; boundary=b1test");
    expect(res.status).toBe(200);
    expect(assetRows(db)[0]!.name).toBe('we"ird;name.txt');
  });

  it("RFC 2231/5987：filename*（UTF-8 pct）优先于 filename；坏 charset 回落 filename；皆不可得 → fallback 名 upload；裸 UTF-8 直取", async () => {
    const mk = (disposition: string, tag: string) => `--b1test\r\nContent-Disposition: ${disposition}\r\nContent-Type: text/plain\r\n\r\nbody-${tag}\r\n--b1test--\r\n`;
    const { handler, db } = await fixtureHandler({ name: "u" });
    const post = (disposition: string, tag: string) => handler.post("upload/u", new TextEncoder().encode(mk(disposition, tag)), "multipart/form-data; boundary=b1test");

    await post('form-data; name="file"; filename="plain.txt"; filename*=UTF-8\'\'%E2%82%AC.txt', "1");
    expect(assetRows(db)[0]!.name).toBe("€.txt"); // filename* 优先（与出现顺序无关）

    await post('form-data; name="file"; filename="plain.txt"; filename*=x-bogus\'\'%41.txt', "2");
    expect(assetRows(db)[1]!.name).toBe("plain.txt"); // 坏 charset 回落 filename

    await post('form-data; name="file"; filename*=x-bogus\'\'%41.txt', "3");
    expect(assetRows(db)[2]!.name).toBe("upload"); // 皆不可得 → fallback 名（诚实边界）

    await post('form-data; name="file"; filename="中文文件名.txt"', "4");
    expect(assetRows(db)[3]!.name).toBe("中文文件名.txt"); // 裸 UTF-8 直取
  });

  it("二进制体逐字节保真：内容含 0x0D0A 与 0x00/0xFF 全字节——解析器只吃分隔符行尾，内容零改动", async () => {
    const { handler, dir, db } = await fixtureHandler({ name: "u" });
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const enc = new TextEncoder();
    const chunks = [
      enc.encode('--b1test\r\nContent-Disposition: form-data; name="file"; filename="bin.dat"\r\n\r\n'),
      data, // 原始二进制（内部含 \r\n 序列——解析器不得吃掉）
      enc.encode('\r\n--b1test--\r\n'),
    ];
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const body = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      body.set(c, off);
      off += c.byteLength;
    }
    const res = await handler.post("upload/u", body, "multipart/form-data; boundary=b1test");
    expect(res.status).toBe(200);
    const sha = sha256Hex(data);
    expect(new Uint8Array(fs.readFileSync(path.join(dir, utcYm(), `${sha}.dat`)))).toEqual(data);
    expect(assetRows(db)[0]!.size).toBe(256);
  });
});

/* ================= ⑥ 下载：流式回文件 + 头面 + 404 两态 + 重传修复 ================= */

describeSqlite("B1 下载：200 流式 / 头面 / 404 未知 id / 账在盘不在 404 + 重传幂等修复", () => {
  it("GET assets/<id> → 200 逐字节同上传 + content-type/length + Cache-Control immutable；未知 id → 404 ATR-310", async () => {
    const { handler } = await fixtureHandler({ name: "u" });
    const data = new TextEncoder().encode("download-me-⚙");
    const up = (await (await handler.post("upload/u", multipartBody([{ name: "file", filename: "d.bin", contentType: "application/x-demo", data }], "b1test"), "multipart/form-data; boundary=b1test")).json()) as { id: number; url: string };
    const res = await handler(new Request(`http://local.test${up.url}`, { method: "GET" }));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
    expect(res.headers.get("content-type")).toBe("application/x-demo");
    expect(res.headers.get("content-length")).toBe(String(data.byteLength));
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const missing = await handler(new Request("http://local.test/api/assets/999", { method: "GET" }));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("ATR-310");
  });

  it("账在盘不在（人工删文件）→ 下载 404 指路重传；重传幂等补写修复（同 id 单行、文件还原、再下载 200）", async () => {
    const { handler, dir, db } = await fixtureHandler({ name: "u" });
    const data = new TextEncoder().encode("repair-me");
    const up = (await (await handler.post("upload/u", multipartBody([{ name: "file", filename: "r.txt", contentType: "text/plain", data }], "b1test"), "multipart/form-data; boundary=b1test")).json()) as { id: number };
    const file = path.join(dir, utcYm(), `${sha256Hex(data)}.txt`);
    fs.unlinkSync(file);
    const gone = await handler(new Request(`http://local.test/api/assets/${up.id}`, { method: "GET" }));
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { message: string }).message).toContain("账在盘不在");
    // 重传修复：同内容不同名 → 同 id、行数不变、文件还原
    const again = (await (await handler.post("upload/u", multipartBody([{ name: "file", filename: "other-name.txt", contentType: "text/plain", data }], "b1test"), "multipart/form-data; boundary=b1test")).json()) as { id: number };
    expect(again.id).toBe(up.id);
    expect(assetRows(db)).toHaveLength(1);
    expect(new Uint8Array(fs.readFileSync(file))).toEqual(data);
    const healed = await handler(new Request(`http://local.test/api/assets/${up.id}`, { method: "GET" }));
    expect(healed.status).toBe(200);
  });
});

/* ================= ⑦ 原子性两态：记账失败删孤儿 / rename 注入失败 ================= */

describeSqlite("B1 原子性两态：临时文件 + rename / 记账失败孤儿清理（可注入失败）", () => {
  it("记账失败（INSERT 注入失败）→ 500 ATR-320 且盘上零残留（孤儿文件已删——不留无账字节）", async () => {
    const db = await fixtureDb();
    const dir = fixtureDir();
    const reg = new EndpointRegistry();
    reg.registerUpload(defineUpload({ name: "u", auth: { type: "none" } }));
    // 记账注入面：exec（建表）与读放行，INSERT 精准失败
    const realPrepare = db.prepare.bind(db);
    const sabdb = {
      exec: (sql: string) => db.exec(sql),
      prepare(sql: string) {
        if (sql.startsWith("INSERT INTO atelier_assets")) throw new Error("simulated ledger failure");
        return realPrepare(sql);
      },
    };
    const face = createUploadsFace({ db: sabdb, dir });
    const handler = reg.createHandler({ db, uploads: face, mount: "/api" });
    const data = new TextEncoder().encode("orphan-cleanup");
    const res = await handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: multipartBody([{ name: "file", filename: "o.txt", data }], "b1test") }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe("ATR-320");
    expect(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, String(f))).isFile())).toHaveLength(0); // 孤儿文件 + 临时文件零残留（空月份目录不算）
    expect(fs.existsSync(path.join(dir, utcYm(), `${sha256Hex(data)}.txt`))).toBe(false);
  });

  it("rename 注入失败 → 500 且临时文件清干净（半文件不可见）；恢复后上传成功且无 .tmp 残留", async () => {
    const { handler, dir, db } = await fixtureHandler({ name: "u" });
    const data = new TextEncoder().encode("rename-fail");
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated rename failure");
    });
    try {
      const res = await handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: multipartBody([{ name: "file", filename: "f.txt", data }], "b1test") }));
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code: string }).code).toBe("ATR-320");
      expect(fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, String(f))).isFile())).toHaveLength(0); // 临时文件清理兜底生效（空月份目录不算残留）
    } finally {
      spy.mockRestore();
    }
    const ok = await handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: multipartBody([{ name: "file", filename: "f.txt", data }], "b1test") }));
    expect(ok.status).toBe(200);
    expect(assetRows(db)).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, utcYm()))).toEqual([`${sha256Hex(data)}.txt`]); // 无 .tmp 残留
  });
});

/* ================= ⑧ auth 拦截链：缺省 session fail-closed / none / role / apikey ================= */

describe("B1 auth 拦截链（gateAuth 单源复用）：缺省 session / none / role / apikey / readAuth 恰一次", () => {
  const body = () => multipartBody([{ name: "file", filename: "a.txt", data: "x" }], "b1test");
  const MP = "multipart/form-data; boundary=b1test";

  it("缺省（未声明 auth）= session fail-closed：无读取器 → 401 ATR-340（消息主语「上传面」）；有效会话 → 200", async () => {
    const db = await fixtureDb();
    const reg = new EndpointRegistry();
    reg.registerUpload(defineUpload({ name: "u" })); // 未声明 auth——缺省 session（决策 32）
    const handler = reg.createHandler({ db, uploads: createUploadsFace({ db, dir: fixtureDir() }), mount: "/api" });
    const denied = await handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP }, body: body() }));
    expect(denied.status).toBe(401);
    const err = (await denied.json()) as { code: string; message: string; fix: string };
    expect(err.code).toBe("ATR-340");
    expect(err.message).toContain("上传面 u");
    expect(err.fix).toContain("createSessionReader");

    const f2 = await fixtureHandler({ name: "u", auth: { type: "session" } }, { auth: (req) => (req.headers.get("x-token") === "good" ? { type: "session", principal: "u1" } : null) });
    const bad = await f2.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP }, body: body() }));
    expect(bad.status).toBe(401); // 读取器在、会话无效
    const ok = await f2.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP, "x-token": "good" }, body: body() }));
    expect(ok.status).toBe(200);
  });

  it("auth none 显式开放（无读取器放行）；role 不匹配 → 403 ATR-341；readAuth 每请求恰一次（与端点同纪律）", async () => {
    const open = await fixtureHandler({ name: "u", auth: { type: "none" } });
    expect((await open.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP }, body: body() }))).status).toBe(200);

    let calls = 0;
    const roled = await fixtureHandler(
      { name: "u", auth: { type: "session", role: "admin" } },
      {
        auth: (req) => {
          calls++;
          const r = req.headers.get("x-role");
          return r ? { type: "session", principal: "u1", role: r } : null;
        },
      }
    );
    const denied = await roled.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP, "x-role": "user" }, body: body() }));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code: string; message: string }).message).toContain("admin");
    const allowed = await roled.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP, "x-role": "admin" }, body: body() }));
    expect(allowed.status).toBe(200);
    expect(calls).toBe(2); // 两次请求各恰一次（拦截处调用复用进面）
  });

  it("auth type apikey：未装配 apiKeys 恒拒 fail-closed；装配 + key 头 → 200；有效会话优先（会话是更强身份）", async () => {
    const noKeys = await fixtureHandler({ name: "u", auth: { type: "apikey" } });
    expect((await noKeys.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP }, body: body() }))).status).toBe(401);

    const keyed = await fixtureHandler({ name: "u", auth: { type: "apikey" } }, { apiKeys: { keys: ["sk-1"] } });
    expect((await keyed.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP }, body: body() }))).status).toBe(401); // 无 key
    const ok = await keyed.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP, "x-api-key": "sk-1" }, body: body() }));
    expect(ok.status).toBe(200);
    const session = await fixtureHandler({ name: "u", auth: { type: "apikey" } }, { apiKeys: { keys: [] }, auth: (req) => (req.headers.get("x-token") === "good" ? { type: "session", principal: "u1" } : null) });
    expect((await session.handler(new Request("http://local.test/api/upload/u", { method: "POST", headers: { "content-type": MP, "x-token": "good" }, body: body() }))).status).toBe(200); // 会话优先，零 key
  });
});

/* ================= ⑨ node-host 桥：真实端口一轮 + 粗闸语义 ================= */

describe("node-host serve() 真实端口：FormData 上传→下载一轮 + 桥粗闸 max(maxBodyBytes, 20MB)", () => {
  /** stdout 握手行静音 + serve 拉起（health.test.ts 同款形态） */
  async function serveQuiet(handler: (req: Request) => Promise<Response>) {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let server: import("node:http").Server;
    try {
      server = await serve(handler, { port: 0 });
    } finally {
      process.stdout.write = orig;
    }
    return { server, writes };
  }

  it("真 multipart 编码（fetch FormData/Blob）→ 上传六事实 → GET url 逐字节同源（流式回写过真 socket）", async () => {
    const db = await fixtureDb();
    const dir = fixtureDir();
    const reg = new EndpointRegistry();
    reg.registerUpload(defineUpload({ name: "avatar", accept: ["image/"], auth: { type: "none" } }));
    const face = createUploadsFace({ db, dir });
    const { server } = await serveQuiet(reg.createHandler({ db, uploads: face, mount: "/api" }));
    try {
      const port = (server.address() as { port: number }).port;
      const data = new Uint8Array(1024);
      for (let i = 0; i < data.length; i++) data[i] = i % 251;
      const form = new FormData();
      form.append("file", new Blob([data], { type: "image/png" }), "real.png");
      const up = await fetch(`http://127.0.0.1:${port}/api/upload/avatar`, { method: "POST", body: form });
      expect(up.status).toBe(200);
      const out = (await up.json()) as { id: number; name: string; mime: string; size: number; sha256: string; url: string };
      expect(out).toEqual({ id: expect.any(Number), name: "real.png", mime: "image/png", size: 1024, sha256: sha256Hex(data), url: `/api/assets/${out.id}` });
      expect(fs.existsSync(path.join(dir, utcYm(), `${out.sha256}.png`))).toBe(true);

      const dl = await fetch(`http://127.0.0.1:${port}${out.url}`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await dl.arrayBuffer())).toEqual(data);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("桥粗闸：maxBodyBytes=100 时 multipart 2KB 越过桥闸 → 面精闸接管（413 文案含上传面）；JSON 2KB 仍被桥闸拦（全局闸不变）", async () => {
    const db = await fixtureDb();
    const dir = fixtureDir();
    const reg = new EndpointRegistry();
    reg.register(defineQuery("q.plain", { handler: () => ({ ok: true }) }));
    reg.registerUpload(defineUpload({ name: "u", maxBytes: 1024, auth: { type: "none" } }));
    const face = createUploadsFace({ db, dir });
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    let server: import("node:http").Server;
    try {
      server = await serve(reg.createHandler({ db, uploads: face, mount: "/api" }), { port: 0, maxBodyBytes: 100 });
    } finally {
      process.stdout.write = orig;
    }
    try {
      const port = (server.address() as { port: number }).port;
      const big = multipartBody([{ name: "file", filename: "big.bin", data: "x".repeat(2048) }], "b1test");
      const mp = await fetch(`http://127.0.0.1:${port}/api/upload/u`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b1test" }, body: big });
      expect(mp.status).toBe(413);
      const mpErr = (await mp.json()) as { message: string };
      expect(mpErr.message).toContain("上传面 u"); // 面精闸文案（非「桥上限」）——粗闸放行、精闸接管
      const json = await fetch(`http://127.0.0.1:${port}/api/q.plain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "y".repeat(2048) }) });
      expect(json.status).toBe(413);
      const jsonErr = (await json.json()) as { message: string };
      expect(jsonErr.message).toContain("桥上限 100"); // JSON 桥闸原样（multipart 放行不影响全局闸）
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    void dir;
  });
});

/* ================= ⑩ 缺省常量钉 ================= */

describe("B1 常量钉：UPLOADS_DEFAULT_MAX_BYTES = 20MB（独立于 JSON 1MiB——node-host 同值单点复制互指）", () => {
  it("缺省上限常量 20 * 1024 * 1024", () => {
    expect(UPLOADS_DEFAULT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});
