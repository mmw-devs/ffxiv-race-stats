/**
 * identity-resolver.ts — L4b 内部子模块 / Operator 身份解析
 *
 * 职责：
 *   - 把飞书 p2p 消息的 sender_id（open_id）解析为稳定 user_id
 *   - 校验 user_id 是否在 OPERATOR_REGISTRY 内
 *   - 缓存成功解析结果（1h）与失败结果（30s）减少 lark-cli 调用
 *
 * 设计：
 *   - 纯函数式工厂 `createIdentityResolver(opts)`，依赖注入（projectDir / cliPath / log）
 *   - 不持有全局可变状态（缓存是 resolver 实例内部 Map）
 *   - fail-closed：任何解析失败返回 null，调用方拒绝后续流程
 *
 * 配置来源：
 *   - 注册表：`scripts/op-log-schema.ts` 的 `OPERATOR_REGISTRY`（单一来源）
 *   - 调用方式：读 `.pi/settings.json` → `larkBot.identity.provider = "feishu-contact"`
 *     `larkBot.identity.canonicalClaim = "user_id"`
 *
 * 数据流：
 *
 *   Feishu sender_id (open_id)
 *       ↓
 *   `lark-cli contact +get-user --as bot --user-id <open_id> --user-id-type open_id`
 *       ↓
 *   `data.user.user_id`
 *       ↓
 *   `OPERATOR_REGISTRY[user_id]` 校验
 *       ↓
 *   `OperatorContext { operator, claim, name }` 或 null（fail-closed）
 *
 * 演进：
 *   - PR #121（已合）：原始实现（在 lark-bot.ts 单文件中，120 行）
 *   - PR #125（已合）：抽出独立模块，纯函数工厂
 *   - PR #135（已合）：lark-bot.ts 被重构为 lark-bot/ 子目录，identity-resolver.ts 漏迁移 → 静默失效
 *   - PR #3（本次）：恢复 identity-resolver.ts，放进 lark-bot/ 子目录
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPERATOR_REGISTRY } from "../../../scripts/op-log-schema.js";
import type { OperatorRegistry } from "../../../scripts/types.js";

// ══════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════

/**
 * Operator 解析结果。operator 是稳定飞书 user_id，可作为 commit message 的 OP_LOG.operator。
 * claim 标识身份来源（当前固定为 "user_id"），便于审计区分。
 * name 仅用于展示元数据，**不应写入 OP_LOG**（commit message 仅接受 operator 字段）。
 */
export interface OperatorContext {
  operator: string;
  claim: "user_id";
  name: string | null;
}

/** 解析选项 */
export interface ResolveOptions {
  /** 项目根（agent-src/）— 用于读 .pi/settings.json */
  projectDir: string;
  /** lark-cli 可执行文件路径 */
  cliPath: string;
  /** 日志函数（由 logger.ts 注入） */
  log: (msg: string) => void;
}

/** Resolver 接口 */
export interface IdentityResolver {
  /**
   * 解析飞书 open_id → OperatorContext。
   * 失败（open_id 非法 / API 调用失败 / 无效 JSON / 缺 user_id / 未在注册表）返回 null。
   * 调用方必须按 null 做 fail-closed 处理。
   */
  resolveOperator(openId: string): Promise<OperatorContext | null>;

  /** 强制清空缓存（运维侧工具，测试用） */
  clearCache(): void;

  /** 当前缓存大小（运维侧工具） */
  cacheSize(): number;
}

/** 解析策略：当前固定 feishu-contact，未来可扩展（OAuth / 第三方 IdP） */
export type IdentityProvider = "feishu-contact";

/** identity 配置 */
export interface IdentityConfig {
  provider: IdentityProvider;
  /** 身份字段：当前固定 "user_id"（稳定 Feishu 身份） */
  canonicalClaim: "user_id";
}

// ══════════════════════════════════════════════════════════════
// 缓存
// ══════════════════════════════════════════════════════════════

interface CacheValue {
  value: OperatorContext | null;
  expiresAt: number;
}

const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1 小时
const FAILURE_TTL_MS = 30 * 1000; // 30 秒

// ══════════════════════════════════════════════════════════════
// 实现
// ══════════════════════════════════════════════════════════════

/**
 * 创建 identity resolver 实例。
 * 不持有全局状态 — 每个 lark-bot 进程可创建多个实例（测试场景）。
 */
export function createIdentityResolver(opts: ResolveOptions): IdentityResolver {
  const { projectDir, cliPath, log } = opts;
  const registry: OperatorRegistry = OPERATOR_REGISTRY;
  const cache = new Map<string, CacheValue>();

  function loadIdentityConfig(): IdentityConfig {
    const settingsPath = join(projectDir, ".pi", "settings.json");
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw) as { larkBot?: { identity?: Partial<IdentityConfig> } };
      const identity = settings.larkBot?.identity;
      if (!identity) {
        // 默认配置
        return { provider: "feishu-contact", canonicalClaim: "user_id" };
      }
      if (identity.provider && identity.provider !== "feishu-contact") {
        log(`⚠️ [identity-resolver] 未知 provider "${identity.provider}", fallback feishu-contact`);
      }
      return {
        provider: "feishu-contact",
        canonicalClaim: "user_id",
      };
    } catch {
      // settings.json 缺失或解析失败 → 默认配置
      return { provider: "feishu-contact", canonicalClaim: "user_id" };
    }
  }

  function isValidOpenId(openId: string): boolean {
    // 飞书 open_id 形如 "ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    return /^ou_[0-9a-f]{32}$/i.test(openId);
  }

  function callFeishuContactApi(openId: string): string | null {
    // `lark-cli contact +get-user --as bot --user-id <open_id> --user-id-type open_id --format json`
    const args = [
      "contact",
      "+get-user",
      "--as",
      "bot",
      "--user-id",
      openId,
      "--user-id-type",
      "open_id",
      "--format",
      "json",
    ];
    try {
      const out = execFileSync(cliPath, args, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return out;
    } catch (e) {
      log(`⚠️ [identity-resolver] lark-cli contact 失败: ${(e as Error).message?.slice(0, 200)}`);
      return null;
    }
  }

  function parseFeishuContactResponse(out: string): string | null {
    try {
      const parsed = JSON.parse(out) as { data?: { user?: { user_id?: string } } };
      const userId = parsed.data?.user?.user_id;
      if (typeof userId !== "string" || userId.length === 0) {
        return null;
      }
      return userId;
    } catch {
      return null;
    }
  }

  function isOperatorInRegistry(userId: string): { allowed: boolean; name: string | null } {
    const entry = registry[userId];
    if (!entry) return { allowed: false, name: null };
    return { allowed: true, name: entry.name };
  }

  function cacheGet(openId: string): CacheValue | undefined {
    const v = cache.get(openId);
    if (!v) return undefined;
    if (Date.now() >= v.expiresAt) {
      cache.delete(openId);
      return undefined;
    }
    return v;
  }

  function cacheSet(openId: string, value: OperatorContext | null, ttlMs: number): void {
    cache.set(openId, { value, expiresAt: Date.now() + ttlMs });
  }

  async function resolveOperator(openId: string): Promise<OperatorContext | null> {
    // 1. 格式校验
    if (!isValidOpenId(openId)) {
      log(`⚠️ [identity-resolver] open_id 格式非法: ${openId.slice(0, 12)}...`);
      return null;
    }

    // 2. 缓存命中
    const cached = cacheGet(openId);
    if (cached) return cached.value;

    // 3. 加载配置（每次 resolve 都重读 settings.json，确保 hot reload 生效）
    const config = loadIdentityConfig();
    if (config.provider !== "feishu-contact") {
      log(`⚠️ [identity-resolver] provider ${config.provider} 未实现`);
      cacheSet(openId, null, FAILURE_TTL_MS);
      return null;
    }

    // 4. 调用 lark-cli contact API
    const rawOut = callFeishuContactApi(openId);
    if (rawOut === null) {
      cacheSet(openId, null, FAILURE_TTL_MS);
      return null;
    }

    // 5. 解析响应
    const userId = parseFeishuContactResponse(rawOut);
    if (userId === null) {
      log(`⚠️ [identity-resolver] 响应无效（缺 user_id）`);
      cacheSet(openId, null, FAILURE_TTL_MS);
      return null;
    }

    // 6. 注册表校验
    const { allowed, name } = isOperatorInRegistry(userId);
    if (!allowed) {
      log(`⚠️ [identity-resolver] user_id "${userId}" 不在 OPERATOR_REGISTRY 中`);
      cacheSet(openId, null, FAILURE_TTL_MS);
      return null;
    }

    // 7. 成功解析：构造上下文 + 长 TTL 缓存
    const ctx: OperatorContext = { operator: userId, claim: "user_id", name };
    cacheSet(openId, ctx, SUCCESS_TTL_MS);
    log(`✓ [identity-resolver] 解析成功: ${userId} (${name ?? "-"})`);
    return ctx;
  }

  return {
    resolveOperator,
    clearCache: () => cache.clear(),
    cacheSize: () => cache.size,
  };
}