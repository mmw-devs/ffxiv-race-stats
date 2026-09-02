/**
 * shared/logger.ts — 全进程日志单一出口
 *
 * SSOT 视角：所有 lark-bot 内部模块的日志必须经过 log()，
 * 保证统一 ISO 时间戳 + 自动轮转 + 文件 /tmp/lark-bot.log 持久化。
 *
 * 设计：纯函数模块，process.ts 负责轮转 + 文件 IO，
 * 其他模块只调用 log()。
 *
 * 注意：本模块不导入 process.ts，避免循环依赖。
 */

import { appendFileSync } from "node:fs";
import { LOG_FILE } from "../config.js";
import { rotateLogIfNeeded } from "../process.js";

export function log(msg: string): void {
  // 完整 ISO 8601（带日期）便于跨天、跨服务排查
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}
