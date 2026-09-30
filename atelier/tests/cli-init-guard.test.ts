/**
 * cli-init-guard.test.ts — P1 #7 红绿：init 目录守卫 + cli 参数缺值校验（评审 #7）。
 *
 * 背景（两处实跑复现，win32 本机）：
 *   ① `node atelier/cli.mjs init --name Foo --target`（--target 末位缺值）→ undefined 被 spawnSync
 *      强转 "undefined" → 整套脚手架静默落进 ./undefined，exit 0；
 *   ② `node atelier/cli.mjs init --target --name Foo`（flag 充当值）→ 目标目录字面为 `--name`，
 *      exit 0；
 *   ③ init-project.mjs 对已存在非空目录 cpSync(recursive) 合并覆盖——用户改过的 main.ts /
 *      contract.ts / vite.config.ts 被静默重置（未提交即不可恢复）。
 *
 * 修后契约：
 *   cli init 侧：--target/--name 缺值或值以 `--` 起 → usage die exit 2，零目录副作用；
 *   init-project 侧：target 已存在且非空（或为文件）→ die exit 2 指路 atelier sync，
 *   `--force` 为显式覆盖逃生口（模板件覆盖同名、名单外用户文件保留）；
 *   空 target 目录照常脚手架（既有 init 流程零变化——mcp-vendor.test.ts 的 init fixture 依赖此）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // atelier/
const CLI = path.join(PKG, "cli.mjs");
const INIT = path.join(PKG, "scripts", "init-project.mjs");

const tmpDirs: string[] = [];
afterAll(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function run(file: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8", windowsHide: true });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("P1 #7：init-project 目录守卫（已存在非空目录绝不静默覆盖）", () => {
  it("红检：target 已存在且非空 → exit 2 指路 sync；目录内容零触碰", () => {
    const work = tmp("atelier-init-guard-");
    const target = path.join(work, "app");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "user.keep"), "user data", "utf8");
    const r = run(INIT, ["--target", target, "--name", "App", "--no-ai"], work);
    expect(r.status).toBe(2); // 修复前：0——cpSync 合并覆盖静默重置用户文件
    expect(r.stderr).toContain("sync");
    expect(r.stderr).toContain("--force");
    expect(fs.readFileSync(path.join(target, "user.keep"), "utf8")).toBe("user data"); // 零触碰
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(false); // 模板件也不得混入
  });

  it("target 为文件（非目录）→ 同样 die 拒绝", () => {
    const work = tmp("atelier-init-guard-file-");
    const target = path.join(work, "occupied");
    fs.writeFileSync(target, "i am a file", "utf8");
    const r = run(INIT, ["--target", target, "--name", "App", "--no-ai"], work);
    expect(r.status).toBe(2); // 修复前：cpSync 对文件目标抛 ENOTDIR 崩栈或覆盖
    expect(r.stderr).toContain("sync");
    expect(fs.readFileSync(target, "utf8")).toBe("i am a file");
  });

  it("空 target 目录 → 照常脚手架（exit 0；既有 init 流程零变化）", () => {
    const work = tmp("atelier-init-guard-empty-");
    const target = path.join(work, "fresh");
    fs.mkdirSync(target, { recursive: true });
    const r = run(INIT, ["--target", target, "--name", "FreshApp", "--no-ai"], work);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
  });

  it("--force 显式逃生口：非空目录可覆盖，模板件重写、名单外用户文件保留", () => {
    const work = tmp("atelier-init-guard-force-");
    const target = path.join(work, "app");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "user.keep"), "user data", "utf8");
    fs.writeFileSync(path.join(target, "package.json"), "{ broken on purpose", "utf8");
    const r = run(INIT, ["--target", target, "--name", "ForcedApp", "--no-ai", "--force"], work);
    expect(r.status).toBe(0); // 修复前：无 --force 也直接 0（无守卫）——修后显式逃生口语义
    expect(fs.readFileSync(path.join(target, "user.keep"), "utf8")).toBe("user data"); // 名单外保留
    const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")); // 模板件已重写
    expect(pkg.name).toBe("forcedapp");
  });
});

describe("P1 #7：cli init 参数缺值 / `--` 前缀混淆 → usage die（绝不 ./undefined）", () => {
  it("红检：--target 末位缺值 → exit 2 usage；零 ./undefined 目录（实跑复现①）", () => {
    const work = tmp("atelier-cli-init-undef-");
    const r = run(CLI, ["init", "--name", "Foo", "--target"], work);
    expect(r.status).toBe(2); // 修复前：0——undefined 强转 "undefined"，88 个文件落进 ./undefined
    expect(r.stderr).toContain("usage");
    expect(fs.existsSync(path.join(work, "undefined"))).toBe(false); // 修复前：整棵脚手架
  });

  it("红检：--target 的值是下一个 flag（`init --target --name Foo`）→ exit 2；零 `--name` 目录（实跑复现②）", () => {
    const work = tmp("atelier-cli-init-flagval-");
    const r = run(CLI, ["init", "--target", "--name", "Foo"], work);
    expect(r.status).toBe(2); // 修复前：0——目录字面为 `--name`
    expect(r.stderr).toContain("usage");
    expect(fs.existsSync(path.join(work, "--name"))).toBe(false);
  });

  it("红检：--name 末位缺值 → exit 2（不落「undefined」应用名）", () => {
    const work = tmp("atelier-cli-init-noname-");
    const target = path.join(work, "app");
    const r = run(CLI, ["init", "--target", target, "--name"], work);
    expect(r.status).toBe(2); // 修复前：0——spawnSync 强转，package.json name 变 "undefined"
    expect(r.stderr).toContain("usage");
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(false);
  });
});
