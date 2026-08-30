/**
 * strip-comments.ts — 评分器自用：剥掉 JS/TS 源码中的注释，只留代码文本。
 *
 * 为什么存在：task2 的硬禁词检查（/setInterval|setTimeout/）曾把「注释里复述禁令」
 * 误判成违规（wave-4 skill.task2-stream.r4 事件）。禁令约束的是行为，不是措辞——
 * 检查必须打在代码上而不是散文上。
 *
 * 剥离方向偏保守：任何疑似歧义的构造宁可漏剥（保持旧行为 = 可能误 FAIL，失败显式）
 * 也不误剥（把代码吞进"注释" = 可能放过真违规，静默错误方向）。因此：
 *   · 正则字面量按"前导操作符"启发式识别并原样保留（不进入注释/字符串状态）
 *   · 模板字面量 ${} 内的嵌套串/嵌套模板用栈处理
 * 不支持 import attributes / JSX 等罕见构造——评分对象是 .atr.ts 组件源码，够用。
 */
export function stripComments(src: string): string {
  // regex-start 前导字符集：这些字符后面的 "/" 按正则字面量开头处理
  const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%~^<>".split("").concat(["\n"]));
  // 栈条目 = 当前最内层 ${} 表达式的剩余大括号深度；闭合即回到所属模板串
  const tplStack: { braceDepth: number }[] = [];
  let out = "";
  let str: string | null = null; // ' " ` 之一；null = 代码态
  let state: "code" | "line" | "block" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        state = "code";
        i++;
      }
      continue;
    }
    if (str !== null) {
      if (c === "\\") {
        out += c + (n ?? "");
        i++;
        continue;
      }
      if (str === "`" && c === "$" && n === "{") {
        tplStack.push({ braceDepth: 1 });
        str = null;
        out += "${";
        i++;
        continue;
      }
      if (c === str) str = null;
      out += c;
      continue;
    }
    // 代码态
    if (c === "/" && n === "/") {
      state = "line";
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      state = "block";
      i++;
      continue;
    }
    const prevMeaningful = out.trimEnd().slice(-1);
    if (c === "/" && (prevMeaningful === "" || REGEX_PRECEDERS.has(prevMeaningful))) {
      // 正则字面量：原样保留到未转义的收尾 /（[...] 字符类内的 / 不收尾）
      out += c;
      let inClass = false;
      for (i++; i < src.length; i++) {
        const rc = src[i];
        out += rc;
        if (rc === "\\") {
          out += src[i + 1] ?? "";
          i++;
        } else if (inClass) {
          if (rc === "]") inClass = false;
        } else if (rc === "[") inClass = true;
        else if (rc === "/") break;
        else if (rc === "\n") break; // 不合法的正则（跨行）——保守放弃，按原文保留
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      str = c;
      out += c;
      continue;
    }
    if (tplStack.length > 0) {
      const top = tplStack[tplStack.length - 1];
      if (c === "{") top.braceDepth++;
      if (c === "}") {
        top.braceDepth--;
        if (top.braceDepth === 0) {
          tplStack.pop();
          out += "}";
          str = "`"; // 回到拥有这个 ${ 表达式的模板串
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}
