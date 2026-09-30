/**
 * extract-schema.mjs — Atelier compiler：(props: {...}) 类型注解 → FlatSchema 提取器（决策 26）。
 *
 * 决策 6 完整版承诺兑现：作者在 .atr.ts 里写的 `(props: { title: string; level?: number })`
 * 注解由编译期扫描提取为 FlatSchema（{type:"object", reqProps, optProps?}，形状对齐
 * runtime/contract.ts 的 FlatSchema/FlatField），替代手写组件元数据双份维护。
 * 产出随 stage ② 落 .atr/ast/<Component>.json 的 schema 字段（纯加法），dev 面注入与
 * 本文件共用 extractPropsSchemas 单一真相（决策 26，不漂移）。
 *
 * 扫描器边界（刻意约束，纪律红线）：
 * - 纯文本扫描，禁 TS 解析器；零 import 自包含（连相对 import 都没有）——vendor 闭包最小化
 *   的硬要求；花括号配对用 matchBrace 技法本地实现（语义对齐 runtime/template.ts 但不 import）。
 * - 架构：codeMaskOf 先对全文做单遍状态机（code / '、" 字符串 / ` 模板（${} 插值恢复代码态）/
 *   // 与 /** *\/ 注释）产出「真实代码区」标记；签名搜索只在 code 区进行。decl 定位沿用
 *   dump.mjs 遗留 regex（字节等价）——落在注释/字符串里的假 decl（如注释掉的组件）会被
 *   regex 命中，但 codeMask 判非代码区 → schema:null + warn 跳过，绝不把注释文本误映射成 schema。
 * - 映射面 = 决策 26：string/number/boolean → {type}；Array<叶> → {type:"array", items:{type}}；
 *   字符串字面量联合（单双引号都认）→ {type:"string", enum}；`prop?: T` → optProps、
 *   `prop: T` → reqProps。属性分隔符逗号与分号都认（TS 类型字面量两种写法，ContractProbe 用分号）。
 * - 超出映射面（泛型/交叉/工具类型/含非字面量成员的联合/嵌套对象/any/unknown/模板字面量类型等）
 *   → ATR-102 四段式显式拒绝：message 含组件名+属性名+原文类型，fix 指路手写 schema
 *   （「复杂类型手写 schema 不变」）。
 * - 注解体闭合后参数列表必须立即闭合（下一非空白字符 = `)`）：首对象之外的交叉/联合残留
 *   （`{ a: string } & { b: number }` 形态）= ATR-102（P1-7：尾残留静默截断缺口的收口——
 *   此前 matchBraceAt 只配对首个 `{`，残留被静默丢弃成缺字段错 schema）。
 * - 注解缺省或首参名非 props → 静默跳过 + warn（向后兼容，非错误；既有组件零破坏）。
 * - v1 已知边界（诚实不误映射）：codeMask 不解析正则字面量（正则文本里的引号/花括号按 code
 *   处理——正则里嵌 "(props: {" 属病理输入）；注解内注释文本照切不剥离——含注释的类型文本无法
 *   精确映射，必然 ATR-102，绝不静默产出错 schema；签名 token 间只跨空白，注解前置注释
 *   （(props /* c *\/ : {...}）不命中 → warn 跳过。
 */

/* ---------- 组件声明定位（自 dump.mjs 搬迁的单一真相，行为逐字节一致，既有测试锁定） ---------- */
export function extractComponentDecls(src) {
  const decls = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*component\s*\(/g;
  for (let m; (m = re.exec(src));) decls.push({ name: m[1], offset: m.index });
  return decls;
}

/* ---------- 全文单遍状态机 → 真实代码区标记（Uint8Array，1 = code）。
 * 帧模型：code（顶层或模板插值）/ q（'、"）/ tpl（`，${} 插值推回 code 帧并按花括号深度归位）；
 * // 与 /* *\/ 注释、字符串字面量、模板文本均不标记。正则字面量不解析（v1 边界，见头注）。
 * P1-5 起导出共享：dump.mjs 的 extractHtmlLiterals/decl 过滤消费同一掩码（compiler 侧
 * codeMask 单一真相，绝不两份手抄漂移）。 ---------- */
export function codeMaskOf(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const stack = [{ kind: "code", interp: false, depth: 0 }];
  while (i < src.length) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top.kind === "q") {
      if (c === "\\") i++;
      else if (c === top.q) stack.pop();
      i++;
      continue;
    }
    if (top.kind === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      else if (c === "$" && src[i + 1] === "{") {
        stack.push({ kind: "code", interp: true, depth: 0 });
        i += 2; // 越过 ${ 整体——若只越 $，{ 会被新插值帧当一层花括号深度计数，闭合 } 永远差一层，
        continue; //        插值帧吞掉后续代码区标记（R1-C 在端点扫描器同款状态机中实证后归零）
      }
      i++;
      continue;
    }
    // code 帧（顶层或模板插值内；插值帧按花括号深度归位，顶层帧的 } 只是普通代码字符）
    if (top.interp && c === "}" && top.depth === 0) {
      stack.pop();
      mask[i] = 1;
      i++;
      continue;
    }
    if (top.interp && c === "{") {
      top.depth++;
      mask[i] = 1;
      i++;
      continue;
    }
    if (top.interp && c === "}") {
      top.depth--;
      mask[i] = 1;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      stack.push({ kind: "q", q: c });
      i++;
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "tpl" });
      i++;
      continue;
    }
    mask[i] = 1;
    i++;
  }
  return mask;
}

/* ---------- 引号感知的 {} 配对（matchBrace 技法本地实现）：返回与 src[start] 的 { 配对的 } 索引，
 * 无配对 → -1。字符串字面量内的花括号不计深度（对齐 runtime/template.ts matchBrace 配对语义）。
 * 注解体文本已由调用方限定为注解内部，注释文本照切不剥离（v1，见头注）。 ---------- */
function matchBraceAt(src, start) {
  let depth = 0;
  let q = null;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/* ---------- 签名搜索：只在真实代码区 [from, to) 找首个 `( props : {`（token 级空白跨越，
 * 等价 /\(\s*props\s*:\s*{/ 且 props 带标识符边界），返回注解体 `{` 的偏移，无命中 → -1。
 * 起点必须是 code 区的 `(`——`(` 与 `props` 之间只允许空白，故命中段的其余 token 必然同在
 * code 区，无需逐位查 mask。opts 实参 {name, schema} 不以 (props 开头，首个命中即函数签名；
 * 搜索上界 = 下一组件声明偏移——首参注解必落在自身 component(...) 调用内、先于后续声明，
 * 无注解组件绝不窃取他人注解。 ---------- */
function findPropsSig(src, from, to, mask) {
  for (let i = from; i < to; i++) {
    if (!mask[i] || src[i] !== "(") continue;
    let j = i + 1;
    while (j < to && /\s/.test(src[j])) j++;
    if (src.startsWith("props", j) && !/[\w$]/.test(src[j + 5] || "")) {
      let k = j + 5;
      while (k < to && /\s/.test(src[k])) k++;
      if (src[k] === ":") {
        let m = k + 1;
        while (m < to && /\s/.test(src[m])) m++;
        if (src[m] === "{") return m;
      }
    }
  }
  return -1;
}

/* ---------- 注解体切分：顶层逗号/分号切属性——引号、()、[]、{}、<> 深度感知；
 * `=>` 的 > 不当角括号闭合（prev === '=' 守卫），函数类型注解不被误切。
 * 字面量联合里的引号内逗号、尖括号内逗号（如 Record<K, V>）均不切。
 * 任何极端形态下的误切只会把类型文本切碎 → 无法映射 → ATR-102，绝不静默产出错 schema。 ---------- */
function splitTopLevel(text) {
  const parts = [];
  let cur = "";
  let depth = 0;
  let q = null;
  let prev = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === "\\") {
        cur += text[i + 1] || "";
        i++;
      } else if (c === q) q = null;
      prev = c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      prev = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{" || c === "<") {
      depth++;
      cur += c;
      prev = c;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      cur += c;
      prev = c;
      continue;
    }
    if (c === ">" && prev !== "=" && depth > 0) {
      depth--;
      cur += c;
      prev = c;
      continue;
    }
    if ((c === "," || c === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
      prev = c;
      continue;
    }
    cur += c;
    prev = c;
  }
  parts.push(cur);
  return parts.filter((p) => p.trim().length > 0);
}

/* ---------- 字面量联合切分：顶层 | 切成员（引号感知——"a|b" 不切），成员 trim ---------- */
function splitUnion(text) {
  const parts = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === "\\") {
        cur += text[i + 1] || "";
        i++;
      } else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

/* ---------- ATR-102 四段式构造：message 含组件名+属性名（或注解片段）+原文类型；fix 指路手写 schema ---------- */
function atr102(compName, propName, typeText) {
  const where = propName ? `属性 ${propName} 的类型 «${typeText}»` : `注解片段 «${typeText}»`;
  const message = `组件 ${compName} ${where}超出注解提取映射面（string/number/boolean/Array<叶>/字符串字面量联合，决策 26）`;
  return Object.assign(new Error(message), {
    code: "ATR-102",
    fix: "该字段类型超出提取映射面（string/number/boolean/Array<叶>/字面量联合），为该组件手写 schema——复杂类型手写 schema 不变",
  });
}

const LEAVES = { string: "string", number: "number", boolean: "boolean" };

/* ---------- 类型文本 → FlatField 映射（映射面 = 决策 26）。顺序：叶子 → Array<叶> → 字面量联合 → ATR-102。
 * 退化单成员字面量（prop: "a"）也映射为 enum:["a"]——校验语义等价，不惩罚作者。 ---------- */
function mapType(typeText, compName, propName) {
  const t = typeText.trim();
  if (LEAVES[t]) return { type: LEAVES[t] };
  const arr = /^Array\s*<([\s\S]*)>$/.exec(t);
  if (arr) {
    const inner = arr[1].trim();
    if (LEAVES[inner]) return { type: "array", items: { type: LEAVES[inner] } };
    throw atr102(compName, propName, t);
  }
  const members = splitUnion(t);
  if (members.length > 1 || /^["']/.test(members[0] || "")) {
    const enumVals = [];
    for (const m of members) {
      const lit = /^(?:"([^"\\]*)"|'([^'\\]*)')$/.exec(m);
      if (!lit) throw atr102(compName, propName, t);
      enumVals.push(lit[1] ?? lit[2]);
    }
    return { type: "string", enum: enumVals };
  }
  throw atr102(compName, propName, t);
}

/* ---------- 主入口：.atr.ts 全文 → 每组件 {name, schema, warn?}。
 * decl regex 遗留命中但落在注释/字符串里（codeMask 判非代码区）→ schema:null + warn 跳过；
 * 真实 decl 在 [decl.offset, 下一 decl.offset) 的 code 区找首个 ( props : { 签名 →
 * matchBraceAt 取注解体（体闭合后尾残留 = ATR-102，见头注 P1-7）→ 逐属性切分 → 类型映射；
 * `prop: T` 入 reqProps、`prop?: T` 入 optProps
 * （optProps 空时省略，对齐 FlatSchema）。无签名 / 注解花括号未闭合 → schema:null + warn（跳过）；
 * 任一属性无法映射 → throw ATR-102（dump 路径 die，四段式上 stderr）。 ---------- */
export function extractPropsSchemas(src) {
  const decls = extractComponentDecls(src);
  const mask = codeMaskOf(src);
  const out = [];
  for (let d = 0; d < decls.length; d++) {
    const decl = decls[d];
    const to = d + 1 < decls.length ? decls[d + 1].offset : src.length;
    if (!mask[decl.offset]) {
      out.push({
        name: decl.name,
        schema: null,
        warn: `${decl.name}: 声明位于注释/字符串等非真实代码区（decl regex 遗留命中）——跳过 schema 提取`,
      });
      continue;
    }
    const open = findPropsSig(src, decl.offset, to, mask);
    if (open < 0) {
      out.push({
        name: decl.name,
        schema: null,
        warn: `${decl.name}: 未找到 (props: {...}) 类型注解（无注解或首参名非 props）——跳过 schema 提取（决策 26 v1 向后兼容）`,
      });
      continue;
    }
    const close = matchBraceAt(src, open);
    if (close < 0) {
      out.push({ name: decl.name, schema: null, warn: `${decl.name}: (props: {...}) 注解花括号未闭合——跳过 schema 提取` });
      continue;
    }
    // P1-7 尾检查：注解体闭合后参数列表必须立即闭合（下一非空白字符 = `)`）。首对象之外的
    // 交叉/联合残留（如 `{ title: string } & { extra: number }`）此前被静默丢弃 → 缺字段错 schema
    // 流入 AST/dev 面/编译产物；现显式 ATR-102（超出映射面 → 显式拒绝，绝不静默产出错 schema）。
    let tail = close + 1;
    while (tail < src.length && /\s/.test(src[tail])) tail++;
    if (tail < src.length && src[tail] !== ")") {
      const tailEnd = src.indexOf(")", tail);
      const residue = (tailEnd >= 0 ? src.slice(close + 1, tailEnd) : src.slice(close + 1, close + 81)).trim();
      throw atr102(decl.name, null, residue);
    }
    const reqProps = {};
    const optProps = {};
    for (const chunk of splitTopLevel(src.slice(open + 1, close))) {
      const pm = /^([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/.exec(chunk.trim());
      if (!pm) throw atr102(decl.name, null, chunk.trim());
      // P2-G4：__proto__ 属性名显式拒绝（ATR-102 款）——reqProps/optProps 挂普通对象，该键
      // 赋值静默改写原型而非声明字段（属性无声消失，schema 与组件真值分叉）；全族「显式 die」
      // 口径（gen-db/export-openapi 同款，标识符最终以裸名进生成代码，护解析面不护产物面）。
      if (pm[1] === "__proto__") {
        throw Object.assign(
          new Error(`组件 ${decl.name} 属性 __proto__ 是原型保留键——普通对象上该键静默改写原型而非声明字段（属性无声消失，schema 与组件真值分叉）`),
          { code: "ATR-102", fix: "改属性名避开 __proto__（原型通道不是合法 props 键）" },
        );
      }
      const field = mapType(pm[3], decl.name, pm[1]);
      if (pm[2]) optProps[pm[1]] = field;
      else reqProps[pm[1]] = field;
    }
    const schema = { type: "object", reqProps };
    if (Object.keys(optProps).length > 0) schema.optProps = optProps;
    out.push({ name: decl.name, schema });
  }
  return out;
}
