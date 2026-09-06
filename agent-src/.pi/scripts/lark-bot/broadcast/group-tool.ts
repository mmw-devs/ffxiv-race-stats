/**
 * group-tool.ts — L4a Broadcast 工具层（群组 API 适配）
 *
 * 职责：
 *   - 群组元数据查询（im chats get）
 *   - 群成员列表查询（im +chat-members-list）
 *   - 群组消息发送（im +messages-send）
 *
 * 设计：
 *   - 纯函数式工厂 `createGroupTool(opts)`，依赖注入（cliPath / log）
 *   - 不持有全局可变状态（缓存是 tool 实例内部 Map）
 *   - fail-closed：任何调用失败返回 null / { ok: false }
 *
 * 配置来源：
 *   - cliPath：lark-cli 可执行文件路径（复用 config.ts 的 CLI 常量）
 *
 * 演进：
 *   - 工具层文档 §4（已写入）：本模块实现 GroupTool 接口骨架
 *   - 私聊侧 MVP：被业务层 AuthModule 调用，提供 description / members 数据
 */

import { execFileSync } from "node:child_process";

// ═══════════════════ 类型定义 ═══════════════════

/** 群组元数据（飞书 chats get API 透传） */
export type GroupInfo = {
  chatId: string;
  name: string;
  description: string;
};

/** 消息发送结果 */
export type SendResult = {
  ok: boolean;
  error?: string;
};

/** GroupTool 接口 */
export interface GroupTool {
  /**
   * 查询群组元数据。失败（chat_id 非法 / API 调用失败 / 无效 JSON / 缺字段）返回 null。
   */
  getGroupInfo(chatId: string): Promise<GroupInfo | null>;

  /**
   * 列出群成员 open_id。失败返回 null。
   */
  listGroupMembers(chatId: string): Promise<string[] | null>;

  /**
   * 发送群组消息。失败返回 { ok: false, error }。
   */
  sendGroupMessage(chatId: string, text: string): Promise<SendResult>;

  /** 强制清空缓存（运维 / 测试用） */
  clearCache(): void;

  /** 当前缓存大小（运维 / 测试用） */
  cacheSize(): number;
}

/** 工厂选项 */
export interface GroupToolOptions {
  /** lark-cli 可执行文件路径 */
  cliPath: string;
  /** 日志函数 */
  log: (msg: string) => void;
}

// ═══════════════════ 缓存 ═══════════════════

interface CacheValue {
  /** 缓存的值（getGroupInfo / listGroupMembers 缓存 GroupInfo / string[]） */
  value: GroupInfo | string[] | null;
  expiresAt: number;
}

const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1 小时
const FAILURE_TTL_MS = 30 * 1000; // 30 秒

// ═══════════════════ 实现 ═══════════════════

export function createGroupTool(opts: GroupToolOptions): GroupTool {
  const { cliPath, log } = opts;
  const cache = new Map<string, CacheValue>();

  function isValidChatId(chatId: string): boolean {
    // 飞书 chat_id 形如 "oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    return /^oc_[0-9a-f]{32}$/i.test(chatId);
  }

  function cacheGet(key: string): CacheValue | undefined {
    const v = cache.get(key);
    if (!v) return undefined;
    if (Date.now() >= v.expiresAt) {
      cache.delete(key);
      return undefined;
    }
    return v;
  }

  function cacheSet(key: string, value: GroupInfo | string[] | null, ttlMs: number): void {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function callLarkCli<T>(args: string[], parse: (out: string) => T | null): T | null {
    try {
      const out = execFileSync(cliPath, args, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return parse(out);
    } catch (e) {
      log(`⚠️ [group-tool] lark-cli 失败: ${(e as Error).message?.slice(0, 200)}`);
      return null;
    }
  }

  async function getGroupInfo(chatId: string): Promise<GroupInfo | null> {
    if (!isValidChatId(chatId)) {
      log(`⚠️ [group-tool] chat_id 格式非法: ${chatId.slice(0, 12)}...`);
      return null;
    }

    const cacheKey = `info:${chatId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached.value as GroupInfo | null;

    const parsed = callLarkCli(
      ["im", "chats", "get", "--chat-id", chatId, "--as", "bot", "--format", "json"],
      (out) => {
        try {
          const obj = JSON.parse(out) as { data?: { name?: string; description?: string } };
          const name = obj.data?.name;
          const description = obj.data?.description ?? "";
          if (typeof name !== "string") return null;
          return { chatId, name, description };
        } catch {
          return null;
        }
      },
    );

    if (parsed === null) {
      cacheSet(cacheKey, null, FAILURE_TTL_MS);
      return null;
    }

    cacheSet(cacheKey, parsed, SUCCESS_TTL_MS);
    log(`✓ [group-tool] getGroupInfo: ${chatId} name="${parsed.name.slice(0, 20)}"`);
    return parsed;
  }

  async function listGroupMembers(chatId: string): Promise<string[] | null> {
    if (!isValidChatId(chatId)) {
      log(`⚠️ [group-tool] chat_id 格式非法: ${chatId.slice(0, 12)}...`);
      return null;
    }

    const cacheKey = `members:${chatId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached.value as string[] | null;

    const parsed = callLarkCli(
      ["im", "+chat-members-list", "--chat-id", chatId, "--as", "bot", "--format", "json"],
      (out) => {
        try {
          const obj = JSON.parse(out) as {
            data?: { items?: Array<{ member_id?: string; type?: string }> };
          };
          const items = obj.data?.items;
          if (!Array.isArray(items)) return null;
          // 仅返回用户成员（type === "user"），过滤机器人成员
          const openIds = items
            .filter((it) => it.type === "user" && typeof it.member_id === "string")
            .map((it) => it.member_id as string);
          return openIds;
        } catch {
          return null;
        }
      },
    );

    if (parsed === null) {
      cacheSet(cacheKey, null, FAILURE_TTL_MS);
      return null;
    }

    cacheSet(cacheKey, parsed, SUCCESS_TTL_MS);
    log(`✓ [group-tool] listGroupMembers: ${chatId} count=${parsed.length}`);
    return parsed;
  }

  async function sendGroupMessage(chatId: string, text: string): Promise<SendResult> {
    if (!isValidChatId(chatId)) {
      log(`⚠️ [group-tool] chat_id 格式非法: ${chatId.slice(0, 12)}...`);
      return { ok: false, error: "invalid chat_id" };
    }

    const args = [
      "im",
      "+messages-send",
      "--chat-id",
      chatId,
      "--text",
      text,
      "--as",
      "bot",
      "--format",
      "json",
    ];
    try {
      const out = execFileSync(cliPath, args, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const obj = JSON.parse(out) as { data?: { message_id?: string } };
        if (typeof obj.data?.message_id === "string") {
          log(`✓ [group-tool] sendGroupMessage: ${chatId} msgId=${obj.data.message_id.slice(-8)}`);
          return { ok: true };
        }
        return { ok: false, error: "no message_id in response" };
      } catch {
        return { ok: false, error: "invalid JSON response" };
      }
    } catch (e) {
      log(`⚠️ [group-tool] sendGroupMessage 失败: ${(e as Error).message?.slice(0, 200)}`);
      return { ok: false, error: (e as Error).message?.slice(0, 200) };
    }
  }

  return {
    getGroupInfo,
    listGroupMembers,
    sendGroupMessage,
    clearCache: () => cache.clear(),
    cacheSize: () => cache.size,
  };
}