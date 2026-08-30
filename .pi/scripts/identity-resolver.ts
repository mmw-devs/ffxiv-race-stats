/**
 * identity-resolver.ts — 飞书 open_id → 运营者身份解析
 *
 * 职责：
 *   - 从 .pi/settings.json 读取身份配置（provider / canonicalClaim）
 *   - 调用 lark-cli contact +get-user 把 open_id 查成 user_id
 *   - 校验 user_id 是否在运营者注册表（scripts/op-log-schema.js）中
 *   - 缓存结果：成功 1h，失败 30s
 *
 * 设计：纯函数式工厂 createIdentityResolver({...})，
 * 接收 lark-bot 提供的 projectDir / cliPath / log()，
 * 避免本模块持有任何 lark-bot 内部状态（无全局耦合）。
 *
 * 用法：
 *   import { createIdentityResolver } from "./identity-resolver.js";
 *   const resolver = createIdentityResolver({ projectDir, cliPath, log });
 *   const ctx = resolver.resolveOperator(openId);  // null 表示未登记或解析失败
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// lark-bot 与 CI 共用同一份运营者注册表，避免权限名单出现两份来源。
const require = createRequire(import.meta.url);

export interface IdentityConfig {
  provider: "feishu-contact";
  canonicalClaim: "user_id";
}

export interface OperatorContext {
  operator: string;
  claim: IdentityConfig["canonicalClaim"];
  name: string | null;
}

export interface CachedOperatorContext {
  context: OperatorContext | null;
  expiresAt: number;
}

export interface ResolveOptions {
  /** 项目根目录（lark-bot.ts 的 PROJECT_DIR） */
  projectDir: string;
  /** lark-cli 可执行路径（lark-bot.ts 的 CLI） */
  cliPath: string;
  /** 日志回调（lark-bot.ts 的 log()） */
  log: (msg: string) => void;
}

export interface IdentityResolver {
  resolveOperator: (openId: string) => OperatorContext | null;
}

const OPERATOR_CACHE_TTL_MS = 60 * 60 * 1000;        // 成功 1h
const OPERATOR_FAILURE_CACHE_TTL_MS = 30 * 1000;    // 失败 30s

function loadIdentityConfig(projectDir: string): IdentityConfig {
  const fallback: IdentityConfig = {
    provider: "feishu-contact",
    canonicalClaim: "user_id",
  };
  try {
    const settings = JSON.parse(readFileSync(join(projectDir, ".pi/settings.json"), "utf-8"));
    const identity = settings?.larkBot?.identity;
    if (identity?.provider === "feishu-contact" && identity?.canonicalClaim === "user_id") {
      return {
        provider: identity.provider,
        canonicalClaim: identity.canonicalClaim,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function createIdentityResolver(opts: ResolveOptions): IdentityResolver {
  const { projectDir, cliPath, log } = opts;

  const opLogSchema = require(join(projectDir, "scripts", "op-log-schema.js")) as {
    isOperatorAllowed: (operator: string) => boolean;
    getOperatorName: (operator: string) => string | null;
  };

  // 接口不兼容时启动期崩溃。避免有人改 op-log-schema.js 函数签名后
  // 拿到 undefined 静默失活，导致所有合法运营者被判为未注册。
  if (
    typeof opLogSchema.isOperatorAllowed !== "function" ||
    typeof opLogSchema.getOperatorName !== "function"
  ) {
    throw new Error(
      "op-log-schema.js 接口不兼容：缺少 isOperatorAllowed 或 getOperatorName。",
    );
  }

  const IDENTITY_CONFIG = loadIdentityConfig(projectDir);

  const operatorCache = new Map<string, CachedOperatorContext>();

  /**
   * 使用完整 Feishu open_id 查询 user_id，并检查其是否已登记为运营者。
   * 解析失败、权限失败或未登记均返回 null，由入口 fail-closed。
   */
  function resolveOperator(openId: string): OperatorContext | null {
    const now = Date.now();
    const cached = operatorCache.get(openId);
    if (cached && cached.expiresAt > now) return cached.context;

    let context: OperatorContext | null = null;

    if (typeof openId !== "string" || !openId.startsWith("ou_")) {
      operatorCache.set(openId, { context: null, expiresAt: now + OPERATOR_FAILURE_CACHE_TTL_MS });
      return null;
    }

    try {
      const result = spawnSync(cliPath, [
        "contact", "+get-user", "--as", "bot",
        "--user-id", openId,
        "--user-id-type", "open_id",
        "--format", "json",
      ], {
        timeout: 8000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`lark-cli exit=${result.status}`);

      const payload = JSON.parse(result.stdout);
      if (payload.ok !== true) {
        throw new Error(payload.error?.message || "通讯录查询失败");
      }

      const operator = payload.data?.user?.[IDENTITY_CONFIG.canonicalClaim];
      if (typeof operator !== "string" || !operator.trim()) {
        throw new Error("响应中缺少 user_id");
      }

      const normalizedOperator = operator.trim();
      if (!opLogSchema.isOperatorAllowed(normalizedOperator)) {
        log(`[身份] user_id=${normalizedOperator} 未在运营者注册表中登记`);
      } else {
        context = {
          operator: normalizedOperator,
          claim: IDENTITY_CONFIG.canonicalClaim,
          name: opLogSchema.getOperatorName(normalizedOperator),
        };
      }
    } catch (error: any) {
      log(`[身份] user_id 解析失败: ${error.message?.slice(0, 120) || "未知错误"}`);
    }

    operatorCache.set(openId, {
      context,
      expiresAt: now + (context ? OPERATOR_CACHE_TTL_MS : OPERATOR_FAILURE_CACHE_TTL_MS),
    });
    return context;
  }

  return { resolveOperator };
}