/**
 * 结构化操作日志模块 — Issue #50
 * 定义日志格式、操作人白名单、权限矩阵，提供生成/校验/解析功能。
 * 零运行时依赖：仅使用 Node.js 内置模块。
 */

// ══════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════

/**
 * 运营者注册表 — 权限身份与展示名称的最小元数据。
 * key 是 OP_LOG.operator 使用的稳定飞书 user_id；name 仅用于展示。
 */
const OPERATOR_REGISTRY = {
  "38a32652": { name: "weunimix" },
  "311a2ea5": { name: "赤墓" },
};

/** 允许的操作人列表（由注册表派生，保持 string[]） */
const OPERATOR_ALLOWLIST = Object.keys(OPERATOR_REGISTRY);

/** 获取操作人的展示名称，不参与权限判断。 */
function getOperatorName(operator) {
  return OPERATOR_REGISTRY[operator]?.name || null;
}

/** 允许的操作类型 */
const ACTION_TYPES = [
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
 */
const ACTION_RISK_LEVELS = {
  deleteBroadcaster: "high",
  updateMeta:        "high",
  updateTeam:        "medium",
  updateBroadcaster: "medium",
  addNews:           "low",
  addBroadcaster:    "low",
};

// ══════════════════════════════════════════════════════════════
// 权限校验
// ══════════════════════════════════════════════════════════════

function isOperatorAllowed(operator) {
  return OPERATOR_ALLOWLIST.includes(operator);
}

function isActionAllowed(action) {
  return ACTION_TYPES.includes(action);
}

/**
 * 获取操作的风险等级
 * @param {string} action
 * @returns {"high"|"medium"|"low"}
 */
function getActionRiskLevel(action) {
  return ACTION_RISK_LEVELS[action] || "low";
}

/**
 * 校验操作人是否有权限执行指定操作类型
 * 返回值包含风险等级，供 CI 根据等级决定阻断/warn
 * @param {object} log
 * @returns {{ valid: boolean, errors: string[], riskLevel: "high"|"medium"|"low" }}
 */
function validateOperatorPermission(log) {
  const errors = [];
  if (!isOperatorAllowed(log.operator)) {
    errors.push(`操作人 "${log.operator}" 不在白名单中`);
  }
  if (!isActionAllowed(log.action)) {
    errors.push(`操作类型 "${log.action}" 不在允许列表中`);
  }
  return {
    valid: errors.length === 0,
    errors,
    riskLevel: getActionRiskLevel(log?.action),
  };
}

// ══════════════════════════════════════════════════════════════
// 日志生成
// ══════════════════════════════════════════════════════════════

/**
 * 生成操作日志对象（自动填充 UTC 时间戳）
 * @param {string} operator - 操作人
 * @param {string} action - 操作类型
 * @param {string} target - 操作目标
 * @param {Array<{field: string, from: *, to: *}>} changes - 变更记录
 * @returns {object} 完整日志对象
 */
function generateLog(operator, action, target, changes) {
  return {
    operator,
    timestamp: new Date().toISOString(),
    action,
    target,
    changes,
  };
}

/**
 * 将日志对象格式化为 commit message 中的 JSON 代码块
 * @param {object} log
 * @returns {string}
 */
function formatCommitBlock(log) {
  const json = JSON.stringify(log, null, 2);
  // 使用 4 反引号包围以防止与 JSON 中的反引号冲突
  return "````json\n" + json + "\n````";
}

/**
 * 一步生成完整 commit message（简短描述 + 日志块）
 * @param {string} shortDesc - 简短描述，如 "t1 bossHP 15.0→12.5"
 * @param {object} log - 日志对象
 * @returns {string}
 */
function formatCommitMessage(shortDesc, log) {
  return "content: " + shortDesc + "\n\n" + formatCommitBlock(log);
}

// ══════════════════════════════════════════════════════════════
// 日志结构校验
// ══════════════════════════════════════════════════════════════

const REQUIRED_LOG_FIELDS = ["operator", "timestamp", "action", "target", "changes"];

/**
 * 校验日志对象结构完整性
 * @param {object} log
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateLogStructure(log) {
  const errors = [];

  if (!log || typeof log !== "object") {
    errors.push("日志对象不存在或不是对象");
    return { valid: false, errors };
  }

  // 必填字段
  for (const field of REQUIRED_LOG_FIELDS) {
    if (!(field in log)) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  // 类型校验
  if (typeof log.operator !== "string") {
    errors.push("operator 必须是字符串");
  }
  if (typeof log.timestamp !== "string") {
    errors.push("timestamp 必须是字符串");
  }
  if (typeof log.action !== "string") {
    errors.push("action 必须是字符串");
  }
  if (typeof log.target !== "string") {
    errors.push("target 必须是字符串");
  }
  if (!Array.isArray(log.changes)) {
    errors.push("changes 必须是数组");
  } else if (log.changes.length === 0) {
    errors.push("changes 不能为空");
  } else {
    // 逐项校验 changes
    for (let i = 0; i < log.changes.length; i++) {
      const change = log.changes[i];
      if (!change || typeof change !== "object") {
        errors.push(`changes[${i}] 必须是对象`);
        continue;
      }
      if (typeof change.field !== "string") {
        errors.push(`changes[${i}].field 必须是字符串`);
      }
      if (!("from" in change)) {
        errors.push(`changes[${i}] 缺少 from 字段`);
      }
      if (!("to" in change)) {
        errors.push(`changes[${i}] 缺少 to 字段`);
      }
    }
  }

  // timestamp 格式校验（ISO 8601 近似检测）
  if (typeof log.timestamp === "string") {
    const ts = new Date(log.timestamp);
    if (isNaN(ts.getTime())) {
      errors.push(`timestamp "${log.timestamp}" 无法解析为有效日期`);
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
 * @param {string} commitMessage
 * @returns {object|null} 解析后的日志对象，失败返回 null
 */
function parseLogFromMessage(commitMessage) {
  // 匹配 `````json ... ````` 或 ```json ... ```
  const blockPattern = /`{3,4}json\s*\n([\s\S]*?)\n`{3,4}/;
  const match = commitMessage.match(blockPattern);

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// 导出
// ══════════════════════════════════════════════════════════════

module.exports = {
  // 常量
  OPERATOR_REGISTRY,
  OPERATOR_ALLOWLIST,
  ACTION_TYPES,
  ACTION_RISK_LEVELS,
  // 展示元数据
  getOperatorName,
  // 权限
  isOperatorAllowed,
  isActionAllowed,
  getActionRiskLevel,
  // 生成
  generateLog,
  formatCommitBlock,
  formatCommitMessage,
  // 结构校验
  validateLogStructure,
  validateOperatorPermission,
  // 解析
  parseLogFromMessage,
};
