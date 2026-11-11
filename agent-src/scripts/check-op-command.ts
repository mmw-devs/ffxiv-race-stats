#!/usr/bin/env node
/**
 * check-op-command.ts — 校验 content/* PR 的操作日志里声明的指令 id 与级别
 *
 * CI 在 content/* PR 时运行（ops 仓库 validate.yml）。把「必须查表」从 skill 里的
 * 自然语言变成 CI 闸门：
 *   1. commit 消息里的操作日志块必须声明 command（指令 id）；
 *   2. command 必须存在于 contract/operations.json；
 *   3. 如果日志里同时声明了 level，必须与契约一致（防止自报级别）。
 *
 * 日志结构本身的完整性由 validate-op-log.ts 负责；没有日志块的 commit 直接跳过，
 * 避免和既有校验重复报错。
 *
 * 用法：npx tsx scripts/check-op-command.ts [base-ref]，默认 origin/main。
 */
import { execFileSync } from "node:child_process";

import { parseLogFromMessage } from "./op-log-schema.js";
import { loadContract } from "./ops-contract.js";
import type { OperationsContract } from "./ops-contract.js";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

interface CommandDef {
  id: string;
  level: string;
}

export function commandIndex(contract: OperationsContract): Map<string, CommandDef> {
  const index = new Map<string, CommandDef>();
  for (const domain of contract.domains) {
    for (const command of domain.commands) {
      index.set(command.id, { id: command.id, level: command.level });
    }
  }
  return index;
}

/** 校验单条 commit 消息；返回错误列表（空数组表示通过）。 */
export function checkMessage(
  message: string,
  index: Map<string, CommandDef>,
): string[] {
  const entry = parseLogFromMessage(message) as Record<string, unknown> | null;
  if (!entry) return [];

  const errors: string[] = [];
  const command = entry.command;

  if (typeof command !== "string" || command.trim() === "") {
    errors.push(
      "日志块缺少 command：请写指令 id（如 progress.update），id 见 COMMANDS.md",
    );
    return errors;
  }

  const def = index.get(command.trim());
  if (!def) {
    errors.push(
      `未知 command "${command}"：不在 contract/operations.json 中，id 见 COMMANDS.md`,
    );
    return errors;
  }

  if (entry.level !== undefined && entry.level !== def.level) {
    errors.push(
      `command ${def.id} 的级别是 ${def.level}，日志却写成 ${String(entry.level)}；级别以契约为准，不要自报`,
    );
  }

  return errors;
}

/** 读取 baseRef..HEAD 的提交消息。 */
export function readMessages(baseRef: string): { sha: string; message: string }[] {
  const raw = execFileSync(
    "git",
    ["log", "--no-merges", "--format=%H%x1f%B%x1e", `${baseRef}..HEAD`],
    { encoding: "utf8" },
  );
  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const [sha, ...rest] = chunk.split("\x1f");
      return { sha: (sha ?? "").slice(0, 7), message: rest.join("\x1f") };
    });
}

function main(): void {
  const baseRef = process.argv[2] ?? "origin/main";
  const contract = loadContract();
  const index = commandIndex(contract);
  const commits = readMessages(baseRef);

  if (commits.length === 0) {
    console.log(`（${baseRef}..HEAD 没有提交，跳过）`);
    return;
  }

  let failed = 0;
  for (const { sha, message } of commits) {
    const errors = checkMessage(message, index);
    if (errors.length === 0) continue;
    failed++;
    console.error(`${RED}✗ ${sha}${RESET}`);
    for (const error of errors) console.error(`  - ${error}`);
  }

  if (failed > 0) {
    console.error(`${RED}✗ ${failed} 个提交的指令声明不合法${RESET}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${GREEN}✓ ${commits.length} 个提交的指令声明全部合法${RESET}`);
}

// 仅在直接运行时执行 main（被测试 import 时不跑）
if (process.argv[1] && /check-op-command\.(ts|js)$/.test(process.argv[1])) {
  main();
}
