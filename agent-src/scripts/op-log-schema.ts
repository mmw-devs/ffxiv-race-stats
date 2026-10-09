/**
 * op-log-schema.ts — 结构化操作日志模块 (Issue #50)
 *
 * 定义日志格式，提供生成/校验/解析功能。
 * 零运行时依赖：仅使用 Node.js 内置模块。
 *
 * 演进：
 *   - PR #1（scripts TS 化）：保持与 .js 完全等价的 API
 *   - PR #2（字段精简）：业务 skill 全部移除 → 删除 ACTION_TYPES / ACTION_RISK_LEVELS / target 字段
 *   - PR-XYZ（清理 OPERATOR_REGISTRY）：删除 Operator 白名单、isOperatorAllowed、
 *     getOperatorName、validateOperatorPermission（运行时 PR-#196 已停用，
 *     CI PR-#200 清理）
 */

import type { ChangeEntry, LogEntry, ValidationResult } from "./types.js";

// ══════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════

// OPERATOR_REGISTRY 已废除（PR-#196 运行时停用，PR-#200 CI 清理）
// 任何 user_id 现在都可作为 operator（PR 合入不再有 user 身份校验）

// ══════════════════════════════════════════════════════════════
// 权限校验
// ══════════════════════════════════════════════════════════════

// isOperatorAllowed / getOperatorName / validateOperatorPermission 已废除

// ══════════════════════════════════════════════════════════════
// 日志生成
// ══════════════════════════════════════════════════════════════
    errors,
  };
}

// ══════════════════════════════════════════════════════════════
// 日志生成
// ══════════════════════════════════════════════════════════════

/**
 * 生成操作日志对象（自动填充 UTC 时间戳）。
 * PR #2 签名：generateLog(operator, changes)
 *   - operator：飞书 user_id（由 lark-bot 注入，原样使用，不得推断）
 *   - changes：字段级变更清单
 * @param operator 操作人飞书 user_id
 * @param changes 变更记录
 */
export function generateLog(operator: string, changes: ChangeEntry[]): LogEntry {
  return {
    operator,
    timestamp: new Date().toISOString(),
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

/** 日志必填字段（PR #2：3 字段）。 */
const REQUIRED_LOG_FIELDS: (keyof LogEntry)[] = ["operator", "timestamp", "changes"];

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