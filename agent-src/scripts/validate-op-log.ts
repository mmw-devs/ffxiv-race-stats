#!/usr/bin/env node

/**
 * validate-op-log.ts — 操作日志校验脚本
 *
 * CI 在 content/* PR 时运行。校验 commit message 中的结构化日志块的完整性、合法性、一致性。
 * 零运行时依赖：Node.js 内置模块 + ./op-log-schema.ts。
 *
 * 三阶段校验：
 *   阶段 1 — 提取操作日志：从每个 commit message 中解析 JSON 日志块
 *   阶段 2 — 日志结构校验：必填字段 + 类型 + operator 权限
 *   阶段 3 — 修改一致性校验：日志声明的 changes vs data.json 实际变更
 *
 * 演进：
 *   - PR #1（scripts TS 化）：保持与 .js 完全等价；将 CLI 逻辑封装到 main() 便于 vitest 导入
 *   - PR #2（字段精简）：删 risk 分级判断段，OPERATOR_REGISTRY 校验改用 user_id
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getOperatorName,
  isOperatorAllowed,
  parseLogFromMessage,
  validateLogStructure,
  validateOperatorPermission,
} from "./op-log-schema.js";
import type { DeepDiffResult, LogEntry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ══════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface CliState {
  errors: number;
  warnings: number;
}

function fail(state: CliState, msg: string): void {
  console.error(`${RED}  ✗ ${msg}${RESET}`);
  state.errors++;
}

function warn(state: string | CliState extends never ? never : CliState, msg: string): void {
  console.warn(`${YELLOW}  ⚠ ${msg}${RESET}`);
  (state as CliState).warnings++;
}

function ok(msg: string): void {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}

// ══════════════════════════════════════════════════════════════
// 辅助函数：深度对象对比
// ══════════════════════════════════════════════════════════════

/**
 * 深度对比两个 JSON 值，返回所有字段级变更。
 * @param oldObj 旧值
 * @param newObj 新值
 * @param prefix 路径前缀（递归使用）
 */
export function deepDiff(oldObj: unknown, newObj: unknown, prefix = ""): DeepDiffResult[] {
  const changes: DeepDiffResult[] = [];

  // 如果两者都是原始类型
  if (
    typeof oldObj !== "object" ||
    typeof newObj !== "object" ||
    oldObj === null ||
    newObj === null
  ) {
    if (JSON.stringify(oldObj) !== JSON.stringify(newObj)) {
      changes.push({ field: prefix || "(root)", from: oldObj, to: newObj });
    }
    return changes;
  }

  // 如果都是数组
  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    const maxLen = Math.max(oldObj.length, newObj.length);
    for (let i = 0; i < maxLen; i++) {
      const fieldPath = prefix ? `${prefix}[${i}]` : `[${i}]`;
      if (i >= oldObj.length) {
        changes.push({ field: fieldPath, from: undefined, to: newObj[i] });
      } else if (i >= newObj.length) {
        changes.push({ field: fieldPath, from: oldObj[i], to: undefined });
      } else {
        const subChanges = deepDiff(oldObj[i], newObj[i], fieldPath);
        changes.push(...subChanges);
      }
    }
    return changes;
  }

  // 如果都是对象
  if (typeof oldObj === "object" && typeof newObj === "object") {
    const oldRecord = oldObj as Record<string, unknown>;
    const newRecord = newObj as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);
    for (const key of allKeys) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (!(key in oldRecord)) {
        changes.push({ field: fieldPath, from: undefined, to: newRecord[key] });
      } else if (!(key in newRecord)) {
        changes.push({ field: fieldPath, from: oldRecord[key], to: undefined });
      } else {
        const subChanges = deepDiff(oldRecord[key], newRecord[key], fieldPath);
        changes.push(...subChanges);
      }
    }
    return changes;
  }

  return changes;
}

// ══════════════════════════════════════════════════════════════
// 祖先字段判断（导出供测试使用）
// ══════════════════════════════════════════════════════════════

/**
 * 祖先字段判断：loggedField 是否为 actualField 的祖先路径。
 * 用于数组操作日志声明（如 "news"）与 deepDiff 产出（如 "news[2].text"）的字段匹配。
 */
export function isAncestorField(loggedField: string, actualField: string): boolean {
  if (loggedField === actualField) return true;
  return actualField.startsWith(loggedField + ".") || actualField.startsWith(loggedField + "[");
}

// ══════════════════════════════════════════════════════════════
// main(): CLI 主体（仅在直接调用时执行）
// ══════════════════════════════════════════════════════════════

/**
 * CLI 主体函数。返回 exit code（0 / 1），便于测试与直接调用分离。
 */
export function main(): number {
  const state: CliState = { errors: 0, warnings: 0 };

  // ══════════════════════════════════════════════════════════════
  // 参数解析
  // ══════════════════════════════════════════════════════════════

  // CI 环境中，base ref 通过 git 获取
  // 第一个 CLI 参数可以是 base ref（如 origin/main），默认 origin/main
  const baseRef = process.argv[2] ?? "origin/main";

  // ══════════════════════════════════════════════════════════════
  // 阶段 1：提取操作日志
  // ══════════════════════════════════════════════════════════════

  console.log(`${BOLD}── 1. 提取操作日志 ──${RESET}`);

  interface CommitBlock {
    hash: string;
    message: string;
  }

  let commits: CommitBlock[];
  try {
    const format = "%H%n%B%n---COMMIT_END---";
    // --no-merges: 跳过 GHA 模拟合并产生的 merge commit（不含日志块）
    const raw = execSync(`git log --no-merges ${baseRef}..HEAD --format="${format}"`, {
      encoding: "utf-8",
      cwd: path.resolve(__dirname, ".."),
    });
    commits = raw
      .split("---COMMIT_END---")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((block) => {
        const newline = block.indexOf("\n");
        return {
          hash: block.slice(0, newline),
          message: block.slice(newline + 1),
        };
      });
  } catch (e) {
    fail(state, `无法获取 commit: ${(e as Error).message}`);
    process.exit(1);
  }

  if (commits.length === 0) {
    warn(state, "未检测到 commit（可能是首次 PR），跳过日志校验");
    return 0;
  }

  ok(`共 ${commits.length} 个 commit`);

  // ══════════════════════════════════════════════════════════════
  // 阶段 2：日志结构校验
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 2. 日志结构校验 ──${RESET}`);

  interface LoggedCommit {
    commitHash: string;
    log: LogEntry;
  }

  const allLogs: LoggedCommit[] = [];

  for (const commit of commits) {
    const log = parseLogFromMessage(commit.message);

    if (!log) {
      fail(state, `commit ${commit.hash.slice(0, 7)} 缺少结构化日志块`);
      continue;
    }

    ok(`commit ${commit.hash.slice(0, 7)} 找到日志块`);

    // 结构校验
    const structResult = validateLogStructure(log);
    if (!structResult.valid) {
      for (const err of structResult.errors) {
        fail(state, `commit ${commit.hash.slice(0, 7)} 日志结构: ${err}`);
      }
      continue;
    }

    // 权限校验：PR #2 起仅校验 operator 是否在 OPERATOR_REGISTRY
    // 无风险分级、无 action 校验；未授权硬阻断（fail-closed）
    if (!isOperatorAllowed(log.operator)) {
      fail(state, `commit ${commit.hash.slice(0, 7)} 权限: ${log.operator} 不在 Operator 注册表中`);
      continue;
    }
    // 兼容旧调用（validateOperatorPermission 仅做 operator 检查，与 isOperatorAllowed 等价）
    const permResult = validateOperatorPermission(log);
    if (!permResult.valid) {
      for (const err of permResult.errors) {
        fail(state, `commit ${commit.hash.slice(0, 7)} 权限: ${err}`);
      }
      continue;
    }

    // 展示 operator 时附带注册表中的展示名（便于审计排查）
    const operatorName = getOperatorName(log.operator);
    ok(`  operator: ${log.operator} (${operatorName ?? "-"}), changes: ${log.changes.length} 项`);
    allLogs.push({ commitHash: commit.hash.slice(0, 7), log });
  }

  if (allLogs.length === 0) {
    fail(state, "所有 commit 均未通过日志校验，无法进行一致性比对");
    return 1;
  }

  // ══════════════════════════════════════════════════════════════
  // 阶段 3：修改一致性校验
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 3. 修改一致性校验 ──${RESET}`);

  // 获取 data.json 的实际变更
  try {
    const diffOutput = execSync(
      `git diff ${baseRef}..HEAD -- public/data.json`,
      { encoding: "utf-8", cwd: path.resolve(__dirname, "..") },
    );

    if (!diffOutput.trim()) {
      ok("data.json 无变更（可能是首次 PR 或仅重组），跳过一致性校验");
    } else {
      ok("成功获取 data.json diff");
    }
  } catch (e) {
    fail(state, `无法获取 data.json diff: ${(e as Error).message}`);
    return 1;
  }

  // 获取 data.json 新旧内容进行字段级对比
  let actualChanges: DeepDiffResult[] = [];
  try {
    const oldRaw = execSync(`git show ${baseRef}:public/data.json`, {
      encoding: "utf-8",
      cwd: path.resolve(__dirname, ".."),
    });
    const oldData = JSON.parse(oldRaw);
    const newRaw = readFileSync(
      path.resolve(__dirname, "..", "public", "data.json"),
      "utf-8",
    );
    const newData = JSON.parse(newRaw);

    // 深度对比，收集所有变更
    actualChanges = deepDiff(oldData, newData);
  } catch (e) {
    // 如果 base 中没有 data.json（首次创建），跳过一致性比对
    warn(state, `无法进行字段级对比: ${(e as Error).message}`);
  }

  if (actualChanges.length > 0) {
    ok(`实际 data.json 变更: ${actualChanges.length} 项`);

    // 汇总日志中声明的所有变更
    const loggedChanges: Array<{ commitHash: string; field: string; from: unknown; to: unknown }> = [];
    for (const { commitHash, log } of allLogs) {
      for (const change of log.changes) {
        loggedChanges.push({ commitHash, field: change.field, from: change.from, to: change.to });
      }
    }

    ok(`日志中声明的变更: ${loggedChanges.length} 项`);

    // 归一化：将 undefined 转为 null，确保与 JSON 日志中的 null 可比对
    // deepDiff 对"新增/删除"输出 undefined，但 JSON 中只能表示 null
    const norm = (v: unknown): unknown => (v === undefined ? null : v);

    // 逐项比对：每项 actual 变更必须在日志中找到对应声明
    for (const actual of actualChanges) {
      const matched = loggedChanges.find((lc) => {
        // 精确字段匹配：值的 JSON 表示必须一致
        if (lc.field === actual.field) {
          return (
            JSON.stringify(norm(lc.from)) === JSON.stringify(norm(actual.from)) &&
            JSON.stringify(norm(lc.to)) === JSON.stringify(norm(actual.to))
          );
        }
        // 祖先匹配：日志声明的字段是 actual 字段的父级路径
        // 用于数组操作（addNews 日志声明 "news"，deepDiff 产出 "news[2].text"）
        if (isAncestorField(lc.field, actual.field)) {
          return true;
        }
        return false;
      });

      if (!matched) {
        const fromStr = JSON.stringify(norm(actual.from));
        const toStr = JSON.stringify(norm(actual.to));
        fail(state, `未记录的变更: ${actual.field} ${fromStr}→${toStr}`);
      }
    }

    // 反向检查：日志中声明的变更是否在 actual 中存在
    for (const lc of loggedChanges) {
      const matched = actualChanges.find((ac) => {
        if (lc.field === ac.field) {
          return (
            JSON.stringify(norm(ac.from)) === JSON.stringify(norm(lc.from)) &&
            JSON.stringify(norm(ac.to)) === JSON.stringify(norm(lc.to))
          );
        }
        if (isAncestorField(lc.field, ac.field)) {
          return true;
        }
        return false;
      });

      if (!matched) {
        warn(state, `日志声明了但未检测到的变更: ${lc.field} (commit ${lc.commitHash}) — 可能被后续 commit 覆盖`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 结果汇总
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
  if (state.errors === 0) {
    console.log(`${GREEN}${BOLD}  操作日志校验通过 ✓${RESET}`);
    if (state.warnings > 0) {
      console.log(`${YELLOW}  ${state.warnings} 条提醒（不阻断）${RESET}`);
    }
    return 0;
  } else {
    console.log(`${RED}${BOLD}  操作日志校验失败: ${state.errors} 条错误${RESET}`);
    if (state.warnings > 0) {
      console.log(`${YELLOW}  ${state.warnings} 条提醒${RESET}`);
    }
    return 1;
  }
}

// ══════════════════════════════════════════════════════════════
// CLI 入口守卫：仅在直接调用本脚本时执行 main()
// vitest 等工具 import 本模块不会触发 main()
// ══════════════════════════════════════════════════════════════

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  process.exit(main());
}