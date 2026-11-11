#!/usr/bin/env node

/**
 * gen-operations-doc.ts — 从 contract/operations.json 生成运营指令文档
 *
 * 用法：
 *   npm run contract:gen     # 重新生成 COMMANDS.md 与 .pi/commands.md
 *   npm run contract:check   # 只校验：契约合法 + 生成物已是最新（CI 用）
 *
 * 生成物是只读视图，不是来源；手改生成物会被 CI 拒绝。
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  COMMANDS_PATH,
  CONTRACT_PATH,
  PI_COMMANDS_PATH,
  PROJECT_ROOT,
  loadContract,
  renderCommandsDoc,
  validateContract,
} from "./ops-contract.js";

function display(file: string): string {
  return path.relative(PROJECT_ROOT, file).split(path.sep).join("/");
}

/** Windows 检出可能把生成物转成 CRLF，比较时统一按 LF 处理。 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function main(): void {
  const check = process.argv.includes("--check");

  const contract = loadContract();
  const errors = validateContract(contract);
  if (errors.length > 0) {
    console.error(`✗ 契约校验失败（${display(CONTRACT_PATH)}）：`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const content = renderCommandsDoc(contract);
  const targets = [COMMANDS_PATH, PI_COMMANDS_PATH];
  let stale = 0;

  for (const target of targets) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = "";
    }

    if (normalize(current) === content) continue;

    if (check) {
      console.error(`✗ 生成物过期：${display(target)}`);
      stale++;
    } else {
      writeFileSync(target, content);
      console.log(`✓ 已生成 ${display(target)}`);
    }
  }

  if (check && stale > 0) {
    console.error("  → 运行 `npm run contract:gen` 后提交生成物。");
    process.exitCode = 1;
  } else if (check) {
    console.log("✓ 契约与生成物一致");
  }
}

main();
