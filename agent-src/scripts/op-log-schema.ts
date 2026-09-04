/**
 * op-log-schema.ts — 结构化操作日志模块 (Issue #50)
 *
 * 定义日志格式、操作人白名单、权限矩阵，提供生成/校验/解析功能。
 * 零运行时依赖：仅使用 Node.js 内置模块。
 *
 * 演进：
 *   - PR #1（scripts TS 化）：保持与 .js 完全等价的 API，仅模块系统从 CJS 改 ESM + 添加 TS 类型
 *   - PR #2（字段精简）：删 OPERATOR_ALLOWLIST 改 OPERATOR_REGISTRY、删 ACTION_TYPES / ACTION_RISK_LEVELS / target
 */

import type { ChangeEntry, LogEntry, RiskLevel, ValidationResult } from "./types.js";

// ══════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════

/** 允许的操作人列表（飞书账号/用户名）。PR #2 改为 OPERATOR_REGISTRY（user_id → {name}）。 */
export const OPERATOR_ALLOWLIST: string[] = ["weunimix"];

/** 允许的操作类型。PR #2 将删除（业务 skill 已全部移除）。 */
export const ACTION_TYPES: string[] = [
  "updateTeam",
  "addNews",
  "addBroadcaster",
  "updateBroadcaster",
  "deleteBroadcaster",
  "updateMeta",
];

/**
 * 操作风险等级
 * high   — 不可逆或影响面大，权限不足时 CI 硬阻断
 * medium — 核心运营操作，权限不足时 warn 不阻断
 * low    — 新增内容（可再修改），权限不足时 warn 不阻断
 *
 * PR #2 将删除（操作类型不再存在）。
 */
export const ACTION_RISK_LEVELS: Record<string, RiskLevel> = {
  deleteBroadcaster: "high",
  updateMeta: "high",
  updateTeam: "medium",
  updateBroadcaster: "medium",
  addNews: "low",
  addBroadcaster: "low",
};

// ══════════════════════════════════════════════════════════════
// 权限校验
// ══════════════════════════════════════════════════════════════

/** 校验 operator 是否在白名单。PR #2 将改为 `operator in OPERATOR_REGISTRY`。 */
export function isOperatorAllowed(operator: string): boolean {
  return OPERATOR_ALLOWLIST.includes(operator);
}

/** 校验 action 是否在允许列表。PR #2 将删除（action 字段不再存在）。 */
export function isActionAllowed(action: string): boolean {
  return ACTION_TYPES.includes(action);
}

/**
 * 获取操作的风险等级。PR #2 将删除。
 * @param action 操作类型
 * @returns 风险等级；未知 action 默认为 low
 */
export function getActionRiskLevel(action: string): RiskLevel {
  return ACTION_RISK_LEVELS[action] ?? "low";
}

/**
 * 校验操作人是否有权限执行指定操作类型
 * 返回值包含风险等级，供 CI 根据等级决定阻断/warn
 * @param log 日志对象
 */
export function validateOperatorPermission(log: LogEntry): ValidationResult {
  const errors: string[] = [];
  if (!isOperatorAllowed(log.operator)) {
    errors.push(`操作人 "${log.operator}" 不在白名单中`);
  }
  if (!isActionAllowed(log.action)) {
    errors.push(`操作类型 "${log.action}" 不在允许列表中`);
  }
  return {
    valid: errors.length === 0,
    errors,
    riskLevel: getActionRiskLevel(log.action),
  };
}

// ══════════════════════════════════════════════════════════════
// 日志生成
// ══════════════════════════════════════════════════════════════

/**
 * 生成操作日志对象（自动填充 UTC 时间戳）。
 * PR #2 签名将改为 generateLog(operator, changes)，删除 action/target 参数。
 * @param operator 操作人
 * @param action 操作类型
 * @param target 操作目标
 * @param changes 变更记录
 */
export function generateLog(
  operator: string,
  action: string,
  target: string,
  changes: ChangeEntry[],
): LogEntry {
  return {
    operator,
    timestamp: new Date().toISOString(),
    action,
    target,
    changes,
  };
}

/**
 * 将日志对象格式化为 commit message 中的 JSON 代码块。
 * 使用 4 反引号包围以防止与 JSON 中的反引号冲突。
 */
export function formatCommitBlock(log: LogEntry): string {
  const json = JSON.stringify(log, null, 2);
  return "````json\n" + json + "\n````";
}

/**
 * 一步生成完整 commit message（简短描述 + 日志块）。
 * @param shortDesc 简短描述，如 "t1 bossHP 15.0→12.5"
 * @param log 日志对象
 */
export function formatCommitMessage(shortDesc: string, log: LogEntry): string {
  return "content: " + shortDesc + "\n\n" + formatCommitBlock(log);
}

// ══════════════════════════════════════════════════════════════
// 日志结构校验
// ══════════════════════════════════════════════════════════════

/** 日志必填字段。PR #2 将删除 action / target。 */
const REQUIRED_LOG_FIELDS: (keyof LogEntry)[] = [
  "operator",
  "timestamp",
  "action",
  "target",
  "changes",
];

/**
 * 校验日志对象结构完整性。
 * @param log 待校验对象（接受 unknown 以应对外部输入）
 */
export function validateLogStructure(log: unknown): ValidationResult {
  const errors: string[] = [];

  if (!log || typeof log !== "object") {
    errors.push("日志对象不存在或不是对象");
    return { valid: false, errors };
  }

  const logObj = log as Record<string, unknown>;

  // 必填字段
  for (const field of REQUIRED_LOG_FIELDS) {
    if (!(field in logObj)) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  // 类型校验
  if (typeof logObj.operator !== "string") {
    errors.push("operator 必须是字符串");
  }
  if (typeof logObj.timestamp !== "string") {
    errors.push("timestamp 必须是字符串");
  }
  if (typeof logObj.action !== "string") {
    errors.push("action 必须是字符串");
  }
  if (typeof logObj.target !== "string") {
    errors.push("target 必须是字符串");
  }
  if (!Array.isArray(logObj.changes)) {
    errors.push("changes 必须是数组");
  } else if (logObj.changes.length === 0) {
    errors.push("changes 不能为空");
  } else {
    // 逐项校验 changes
    for (let i = 0; i < logObj.changes.length; i++) {
      const change = logObj.changes[i];
      if (!change || typeof change !== "object") {
        errors.push(`changes[${i}] 必须是对象`);
        continue;
      }
      const changeObj = change as Record<string, unknown>;
      if (typeof changeObj.field !== "string") {
        errors.push(`changes[${i}].field 必须是字符串`);
      }
      if (!("from" in changeObj)) {
        errors.push(`changes[${i}] 缺少 from 字段`);
      }
      if (!("to" in changeObj)) {
        errors.push(`changes[${i}] 缺少 to 字段`);
      }
    }
  }

  // timestamp 格式校验（ISO 8601 近似检测）
  if (typeof logObj.timestamp === "string") {
    const ts = new Date(logObj.timestamp);
    if (isNaN(ts.getTime())) {
      errors.push(`timestamp "${logObj.timestamp}" 无法解析为有效日期`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ══════════════════════════════════════════════════════════════
// 日志解析（从 commit message 提取）
// ══════════════════════════════════════════════════════════════

/**
 * 从 commit message 中提取并解析 JSON 日志块
 * 支持 3 反引号或 4 反引号包围的 json 代码块
 * @param commitMessage 完整的 commit message 文本
 * @returns 解析后的日志对象，失败返回 null
 */
export function parseLogFromMessage(commitMessage: string): LogEntry | null {
  // 匹配 `````json ... ````` 或 ```json ... ```
  const blockPattern = /`{3,4}json\s*\n([\s\S]*?)\n`{3,4}/;
  const match = commitMessage.match(blockPattern);

  if (!match) return null;

  try {
    return JSON.parse(match[1] as string) as LogEntry;
  } catch {
    return null;
  }
}