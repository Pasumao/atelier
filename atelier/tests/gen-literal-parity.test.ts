/**
 * gen-literal-parity.test.ts — R1-C §4.7：字面量转义解码跨消费面对拍（JSON.parse 语义单源纪律）。
 *
 * 评审坐实的分叉：同一转义序列三条消费链三套解码——gen-endpoint `\\(.)→$1`（把 \n 解成 "n"）、
 * gen-db/export-openapi 仅映射 \n/\t（\u4e2d 解成 "u4e2d"）、端点名同错（`"a\nb"` 静默解成
 * "anb" 绕过 ATR-342，与运行时 TS 字符串语义漂移）。统一为 JSON.parse 语义后，本对拍钉住
 * 「同一组字面量经三条消费链解析结果逐字相同且等于 JSON.parse 真值」——三实现因 vendor 闭包
 * 红线（gen-endpoint 只准 import node:）各自内联同款解码器，本文件是三份内联保持同语义的机检网
 * （改任一份漏改另两份 = 此处红）。
 *
 * 三条消费链（各自真实入口，无平行真相）：
 *   ① gen-endpoint：scanEndpointSource——live.invalidate 字符串数组（stringArrayOf）
 *                    + auth 面内联契约字面量（parseFlatValue）+ 端点名解码（walk）
 *   ② gen-db：      parseSchema——schema.ts 列 enum（parseStringLiteral）
 *   ③ export-openapi：scanContractSchemas——contract.ts 契约字面量（parseFlatLiteral）
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanEndpointSource } from "../gen/gen-endpoint.mjs";
import { parseSchema } from "../gen/gen-db.mjs";
import { scanContractSchemas } from "../gen/export-openapi.mjs";

const BS = String.fromCharCode(92); // 反斜杠（避免嵌套转义写法歧义）

/** 源码字面量体（fixture 里的真实字符序列）→ JSON.parse 真值。覆盖 \n \t \" \\ \/ \uXXXX */
const CASES: Array<[string, string]> = [
  ["a" + BS + "nb", JSON.parse('"' + "a" + BS + "nb" + '"') as string], // \n → LF
  ["c" + BS + "td", JSON.parse('"' + "c" + BS + "td" + '"') as string], // \t → TAB
  ["e" + BS + '"f', JSON.parse('"' + "e" + BS + '"f' + '"') as string], // \" → "
  ["g" + BS + BS + "h", JSON.parse('"' + "g" + BS + BS + "h" + '"') as string], // \\ → \
  ["x" + BS + "/y", JSON.parse('"' + "x" + BS + "/y" + '"') as string], // \/ → /
  [BS + "u4e2d", JSON.parse('"' + BS + "u4e2d" + '"') as string], // \u4e2d → 中
];

/** 把 CASES 的源码体渲染成 JSON 数组字面量文本（字符串数组的源码形态，三条链共用） */
const arrayLiteralSource = (): string => "[" + CASES.map(([body]) => `"${body}"`).join(", ") + "]";
const groundTruth = (): string[] => CASES.map(([, v]) => v);

describe("R1-C：字面量转义解码跨面对拍（JSON.parse 语义——三链逐字相同）", () => {
  it("① gen-endpoint：live.invalidate 字符串数组解码 = JSON 真值（修复前 \\n 解成 n、\\u4e2d 解成 u4e2d）", () => {
    const src = `export const x = defineQuery("p.i", {\n  live: { invalidate: ${arrayLiteralSource()} },\n  handler: () => 1,\n});\n`;
    const ep = scanEndpointSource(src)[0];
    expect(ep?.invalidate).toEqual(groundTruth());
  });

  it("① gen-endpoint：auth 面内联契约字面量（parseFlatValue 链）enum 解码 = JSON 真值", () => {
    const src = `export const x = defineQuery("p.j", {\n  contract: { type: "object", reqProps: { tag: { type: "string", enum: ${arrayLiteralSource()} } } },\n  handler: () => 1,\n});\n`;
    const ep = scanEndpointSource(src, { allowInlineLiterals: true })[0];
    expect(ep?.contractFlat).toMatchObject({ reqProps: { tag: { enum: groundTruth() } } });
  });

  it("② gen-db：schema.ts 列 enum（parseStringLiteral 链）解码 = JSON 真值（修复前 \\u4e2d 解成 u4e2d）", () => {
    const schema = `import { table } from "../../vendor/atelier/server/db.ts";\n\nexport const items = table("items", {\n  id: { type: "integer", primaryKey: true },\n  tag: { type: "text", notNull: true, enum: ${arrayLiteralSource()} },\n});\n`;
    const tables = parseSchema(schema, "schema.ts");
    expect(tables[0]?.def.rowSchema.reqProps.tag).toMatchObject({ enum: groundTruth() });
  });

  it("③ export-openapi：contract.ts 契约字面量（parseFlatLiteral 链）解码 = JSON 真值", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-lit-parity-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "contract.ts"), `export const tagSchema = {\n  type: "object",\n  reqProps: { tag: { type: "string", enum: ${arrayLiteralSource()} } },\n};\n`);
      const sc = scanContractSchemas(root);
      expect(sc.byIdent.tagSchema?.value).toMatchObject({ reqProps: { tag: { enum: groundTruth() } } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("端点名转义同语义：名字面量 \"a\\nb\"（转义序列）解码为真实换行 → ATR-342（修复前静默解成 anb——生成面与运行时名漂移）", () => {
    const src = "export const x = defineQuery(\"a" + BS + "nb\", { handler: () => 1 });";
    let err: (Error & { code?: string }) | null = null;
    try {
      scanEndpointSource(src);
    } catch (e) {
      err = e as Error & { code?: string };
    }
    expect(err, "转义解码为真实换行后必须被名字符集闸拒绝").toBeTruthy();
    expect(err!.code).toBe("ATR-342");
    expect(err!.message).toContain("a\\nb"); // message 对坏值 JSON.stringify 后呈现（真实换行 → \n 两字符）
  });

  it("越界转义显式拒绝（绝不静默猜）：\\x 十六进制转义超出扁平字面量纪律", () => {
    const src = "export const x = defineQuery(\"bad" + BS + "x41name\", { handler: () => 1 });";
    expect(() => scanEndpointSource(src)).toThrow(/转义/);
  });
});
