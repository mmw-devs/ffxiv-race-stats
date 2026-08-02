#!/usr/bin/env node

/**
 * 操作日志校验脚本 — CI 在 content/* PR 时运行。
 * 校验 commit message 中的结构化日志块的完整性、合法性、一致性。
 * 零运行时依赖：Node.js 内置模块 + ../scripts/op-log-schema.js。
 *
 * 三阶段校验：
 *   阶段 1 — 提取操作日志：从每个 commit message 中解析 JSON 日志块
 *   阶段 2 — 日志结构校验：必填字段 + 类型 + operator 权限
 *   阶段 3 — 修改一致性校验：日志声明的 changes vs data.json 实际变更
 */

const { execSync } = require("child_process");
const path = require("path");
const {
  parseLogFromMessage,
  validateLogStructure,
  validateOperatorPermission,
  getOperatorName,
} = require("./op-log-schema");

// ══════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

let errors = 0;
let warnings = 0;

function fail(msg) { console.error(`${RED}  ✗ ${msg}${RESET}`); errors++; }
function warn(msg) { console.warn(`${YELLOW}  ⚠ ${msg}${RESET}`); warnings++; }
function ok(msg) { console.log(`${GREEN}  ✓ ${msg}${RESET}`); }

// ══════════════════════════════════════════════════════════════
// 参数解析
// ══════════════════════════════════════════════════════════════

// CI 环境中，base ref 通过 git 获取
// 第一个 CLI 参数可以是 base ref（如 origin/main），默认 origin/main
const baseRef = process.argv[2] || "origin/main";

// ══════════════════════════════════════════════════════════════
// 阶段 1：提取操作日志
// ══════════════════════════════════════════════════════════════

console.log(`${BOLD}── 1. 提取操作日志 ──${RESET}`);

let commits;
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
  fail(`无法获取 commit 历史: ${e.message}`);
  process.exit(1);
}

if (commits.length === 0) {
  warn("未检测到 commit（可能是首次 PR），跳过日志校验");
  process.exit(0);
}

ok(`共 ${commits.length} 个 commit`);

// ══════════════════════════════════════════════════════════════
// 阶段 2：日志结构校验
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 2. 日志结构校验 ──${RESET}`);

let allLogs = [];

for (const commit of commits) {
  const log = parseLogFromMessage(commit.message);

  if (!log) {
    fail(`commit ${commit.hash.slice(0, 7)} 缺少结构化日志块`);
    continue;
  }

  ok(`commit ${commit.hash.slice(0, 7)} 找到日志块`);

  // 结构校验
  const structResult = validateLogStructure(log);
  if (!structResult.valid) {
    for (const err of structResult.errors) {
      fail(`commit ${commit.hash.slice(0, 7)} 日志结构: ${err}`);
    }
    continue;
  }

  // 权限校验：身份未解析时无论风险等级都硬阻断；其余操作沿用 PR #73 的风险分级
  const permResult = validateOperatorPermission(log);
  const isUnknownOperator = !log.operator || log.operator === "unknown";
  if (!permResult.valid) {
    const levelLabel = { high: "高风险", medium: "中风险", low: "低风险" }[permResult.riskLevel];
    const shouldBlock = isUnknownOperator || permResult.riskLevel === "high";
    for (const err of permResult.errors) {
      if (shouldBlock) {
        fail(`commit ${commit.hash.slice(0, 7)} 权限(${levelLabel}): ${err}`);
      } else {
        warn(`commit ${commit.hash.slice(0, 7)} 权限(${levelLabel}): ${err}`);
      }
    }
    // 高风险或身份未解析的操作不继续记录日志（无法进入一致性比对）
    if (shouldBlock) continue;
  }

  const operatorName = getOperatorName(log.operator);
  const operatorLabel = operatorName
    ? `${log.operator} (${operatorName})`
    : `${log.operator} (未登记)`;
  ok(`  operator: ${operatorLabel}, action: ${log.action}, target: ${log.target}, changes: ${log.changes.length} 项`);
  allLogs.push({ commitHash: commit.hash.slice(0, 7), log });
}

if (allLogs.length === 0) {
  fail("所有 commit 均未通过日志校验，无法进行一致性比对");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
// 阶段 3：修改一致性校验
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 3. 修改一致性校验 ──${RESET}`);

// 获取 data.json 的实际变更
// 阶段 3 的实际字段级对比由 deepDiff 完成（见下方）
try {
  const diffOutput = execSync(
    `git diff ${baseRef}..HEAD -- public/data.json`,
    { encoding: "utf-8", cwd: path.resolve(__dirname, "..") }
  );

  if (!diffOutput.trim()) {
    ok("data.json 无变更（可能是首次 PR 或仅重组），跳过一致性校验");
  } else {
    ok("成功获取 data.json diff");
  }
} catch (e) {
  fail(`无法获取 data.json diff: ${e.message}`);
  process.exit(1);
}

// 获取 data.json 新旧内容进行字段级对比
let actualChanges = [];
try {
  const oldRaw = execSync(`git show ${baseRef}:public/data.json`, {
    encoding: "utf-8",
    cwd: path.resolve(__dirname, ".."),
  });
  const oldData = JSON.parse(oldRaw);
  const newRaw = require("fs").readFileSync(
    path.resolve(__dirname, "..", "public", "data.json"),
    "utf-8"
  );
  const newData = JSON.parse(newRaw);

  // 深度对比，收集所有变更
  actualChanges = deepDiff(oldData, newData);
} catch (e) {
  // 如果 base 中没有 data.json（首次创建），跳过一致性比对
  warn(`无法进行字段级对比: ${e.message}`);
}

if (actualChanges.length > 0) {
  ok(`实际 data.json 变更: ${actualChanges.length} 项`);

  // 汇总日志中声明的所有变更
  const loggedChanges = [];
  for (const { commitHash, log } of allLogs) {
    for (const change of log.changes) {
      loggedChanges.push({ commitHash, field: change.field, from: change.from, to: change.to });
    }
  }

  ok(`日志中声明的变更: ${loggedChanges.length} 项`);

  // 归一化：将 undefined 转为 null，确保与 JSON 日志中的 null 可比对
  // deepDiff 对"新增/删除"输出 undefined，但 JSON 中只能表示 null
  const norm = (v) => v === undefined ? null : v;

  // 祖先字段判断：loggedField 是否为 actualField 的祖先路径
  // 例："news" 是 "news[2].text" 的祖先，"teams" 是 "teams[0].bossHP" 的祖先
  const isAncestorField = (loggedField, actualField) => {
    if (loggedField === actualField) return true;
    return actualField.startsWith(loggedField + ".") || actualField.startsWith(loggedField + "[");
  };

  // 逐项比对：每项 actual 变更必须在日志中找到对应声明
  for (const actual of actualChanges) {
    const matched = loggedChanges.find((lc) => {
      // 精确字段匹配：值的 JSON 表示必须一致
      if (lc.field === actual.field) {
        return JSON.stringify(norm(lc.from)) === JSON.stringify(norm(actual.from)) &&
               JSON.stringify(norm(lc.to)) === JSON.stringify(norm(actual.to));
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
      fail(`未记录的变更: ${actual.field} ${fromStr}→${toStr}`);
    }
  }

  // 反向检查：日志中声明的变更是否在 actual 中存在
  for (const lc of loggedChanges) {
    const matched = actualChanges.find((ac) => {
      if (lc.field === ac.field) {
        return JSON.stringify(norm(ac.from)) === JSON.stringify(norm(lc.from)) &&
               JSON.stringify(norm(ac.to)) === JSON.stringify(norm(lc.to));
      }
      if (isAncestorField(lc.field, ac.field)) {
        return true;
      }
      return false;
    });

    if (!matched) {
      warn(`日志声明了但未检测到的变更: ${lc.field} (commit ${lc.commitHash}) — 可能被后续 commit 覆盖`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 辅助函数：深度对象对比
// ══════════════════════════════════════════════════════════════

/**
 * 深度对比两个 JSON 值，返回所有字段级变更。
 * @param {*} oldObj - 旧值
 * @param {*} newObj - 新值
 * @param {string} prefix - 路径前缀（递归使用）
 * @returns {Array<{field: string, from: *, to: *}>}
 */
function deepDiff(oldObj, newObj, prefix = "") {
  const changes = [];

  // 如果两者都是原始类型
  if (typeof oldObj !== "object" || typeof newObj !== "object" ||
      oldObj === null || newObj === null) {
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
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const key of allKeys) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (!(key in oldObj)) {
        changes.push({ field: fieldPath, from: undefined, to: newObj[key] });
      } else if (!(key in newObj)) {
        changes.push({ field: fieldPath, from: oldObj[key], to: undefined });
      } else {
        const subChanges = deepDiff(oldObj[key], newObj[key], fieldPath);
        changes.push(...subChanges);
      }
    }
    return changes;
  }

  return changes;
}

// ══════════════════════════════════════════════════════════════
// 结果汇总
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
if (errors === 0) {
  console.log(`${GREEN}${BOLD}  操作日志校验通过 ✓${RESET}`);
  if (warnings > 0) {
    console.log(`${YELLOW}  ${warnings} 条提醒（不阻断）${RESET}`);
  }
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}  操作日志校验失败: ${errors} 条错误${RESET}`);
  if (warnings > 0) {
    console.log(`${YELLOW}  ${warnings} 条提醒${RESET}`);
  }
  process.exit(1);
}
