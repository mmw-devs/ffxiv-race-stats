/**
 * scripts/types.ts — scripts/ 子系统共享类型定义
 *
 * SSOT 视角：所有 scripts/ 下脚本的数据类型集中在此。
 * 业务数据本身（data.json 的 RACE_DATA / Schema 类型）由顶层 schema/ + types/ 维护，
 * 本文件仅承载脚本间的中间数据结构。
 *
 * 演进：
 *   - PR #1（scripts TS 化）阶段：保留完整 5 字段（与 .js 等价）
 *   - PR #2（op-log-schema 字段精简）阶段：将 LogEntry 改为 3 字段
 */

/**
 * 单条字段级变更。
 * field 用 JSONPath-like 表示（如 "teams[0].bossHP"、"news[2].text"）。
 * from/to 中 undefined 表示"新增"或"删除"（与 JSON null 区分）。
 */
export interface ChangeEntry {
  field: string;
  from: unknown;
  to: unknown;
}

/** 操作风险等级 */
export type RiskLevel = "high" | "medium" | "low";

/** 结构化操作日志（commit message 中嵌入的 JSON 块）。 */
export interface LogEntry {
  operator: string;
  timestamp: string;
  action: string;
  target: string;
  changes: ChangeEntry[];
}

/** deepDiff 产出的单条字段级变更。 */
export interface DeepDiffResult {
  field: string;
  from: unknown;
  to: unknown;
}

/** validateOperatorPermission / validateLogStructure 的统一返回结构。 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** 仅 validateOperatorPermission 填充；validateLogStructure 为 undefined。 */
  riskLevel?: RiskLevel;
}

/** vitest 用 fixture 描述（仅测试模块内部使用）。 */
export interface ValidatorFixture {
  file: string;
  desc: string;
  expectErrorContains: string;
}