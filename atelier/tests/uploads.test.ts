/**
 * uploads.test.ts — B1 文件上传/资产管道（2026-09-28 差距批；决策 32：显式注册上传面——
 * `defineUpload({ name, accept?, maxBytes?, auth? })` 兄弟注册表 + `POST <mount>/upload/<name>`
 * + `GET <mount>/assets/<id>`；磁盘内容寻址 `<uploads.dir>/<yyyy-mm>/<sha256>.<ext>` +
 * `atelier_assets` 记账。依据 docs/research/2026-09-28-fullstack-feature-gap.md §3-B1 与
 * FS-DESIGN §3.4 落地注记。
 *
 * 本文件红检段（现状无 multipart/FormData 通路——W6 收紧后上传被显式挡在门外且无替代通路）：
 *   - 只 import 既有模块（endpoints.ts），路由级钉死现状缺口与目标契约；
 *   - 「multipart 打端点面 → 400 ATR-312」是**永久负例**（端点面纯 JSON 纪律不因本批放松）；
 *   - 「未装配上传面的 upload/assets 路由 → 404 ATR-310 诚实指路装配」现状红（405 ATR-311
 *     误导指路 / "未知端点"文案不指认上传面），实现后转绿。
 * 实现段（uploads.ts 落地后追加）：上传六事实 / 去重 / 闸位 / 解析器边界 / 原子性两态 /
 * auth 三态 / 下载头面 / node-host 真实端口一轮 / introspect 端点表零变化负例。
 */
import { describe, expect, it } from "vitest";
import { defineQuery, EndpointRegistry } from "../server/endpoints";

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

describe("B1 红检：上传通路现状缺口（路由级——只依赖既有分发器）", () => {
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
