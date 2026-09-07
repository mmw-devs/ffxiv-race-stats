/**
 * group-tool.ts — L4a Broadcast 工具层（群组 API 适配，事件驱动版）
 *
 * 职责：
 *   - 群组元数据查询（im chats get）
 *   - 群成员列表查询（im +chat-members-list）
 *   - 群组消息发送（im +messages-send）
 *   - 列出 lark-bot 所在全量群组（im +chat-list）—— 启动冷启动用
 *
 * 设计：
 *   - 纯函数式工厂 `createGroupTool(opts)`，依赖注入（cliPath / log）
 *   - 不持有全局可变状态
 *   - fail-closed：任何调用失败返回 null / { ok: false }
 *
 * 调用方契约：
 *   - 本模块**不缓存**任何群组/成员数据
 *   - 调用方（AuthModule）按需调用 + 自管内存缓存 + 事件维护实时性
 *   - 调用频次由调用方决定（本模块零轮询）
 *
 * 配置来源：
 *   - cliPath：lark-cli 可执行文件路径（复用 config.ts 的 CLI 常量）
 */

import { execFileSync } from "node:child_process";

// ═══════════════════ 类型定义 ═══════════════════

/** 群组元数据 */
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

/** GroupTool 接口（无缓存语义：调用即返回实时数据） */
export interface GroupTool {
  /**
   * 查询单个群组元数据。失败返回 null。
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

  /**
   * 列出 lark-bot 所在全量群组。仅启动期冷启动使用一次。
   * 失败返回 null。
   */
  listAllBotGroups(): Promise<GroupInfo[] | null>;
}

/** 工厂选项 */
export interface GroupToolOptions {
  cliPath: string;
  log: (msg: string) => void;
}

// ═══════════════════ 实现 ═══════════════════

export function createGroupTool(opts: GroupToolOptions): GroupTool {
  const { cliPath, log } = opts;

  function isValidChatId(chatId: string): boolean {
    return /^oc_[0-9a-f]{32}$/i.test(chatId);
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

    return callLarkCli(
      ["im", "chats", "get", "--chat-id", chatId, "--as", "bot", "--format", "json"],
      (out) => {
        try {
          const obj = JSON.parse(out) as { data?: { name?: string; description?: string } };
          const name = obj.data?.name;
          if (typeof name !== "string") return null;
          return {
            chatId,
            name,
            description: obj.data?.description ?? "",
          };
        } catch {
          return null;
        }
      },
    );
  }

  async function listGroupMembers(chatId: string): Promise<string[] | null> {
    if (!isValidChatId(chatId)) {
      log(`⚠️ [group-tool] chat_id 格式非法: ${chatId.slice(0, 12)}...`);
      return null;
    }

    return callLarkCli(
      ["im", "+chat-members-list", "--chat-id", chatId, "--as", "bot", "--format", "json"],
      (out) => {
        try {
          const obj = JSON.parse(out) as {
            data?: { items?: Array<{ member_id?: string; type?: string }> };
          };
          const items = obj.data?.items;
          if (!Array.isArray(items)) return null;
          return items
            .filter((it) => it.type === "user" && typeof it.member_id === "string")
            .map((it) => it.member_id as string);
        } catch {
          return null;
        }
      },
    );
  }

  async function sendGroupMessage(chatId: string, text: string): Promise<SendResult> {
    if (!isValidChatId(chatId)) {
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
          return { ok: true };
        }
        return { ok: false, error: "no message_id in response" };
      } catch {
        return { ok: false, error: "invalid JSON response" };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message?.slice(0, 200) };
    }
  }

  async function listAllBotGroups(): Promise<GroupInfo[] | null> {
    // 拉全量 lark-bot 所在群组（含分页）
    const all: GroupInfo[] = [];
    let pageToken: string | undefined = undefined;
    const maxPages = 10;

    for (let i = 0; i < maxPages; i++) {
      const args = ["im", "+chat-list", "--as", "bot", "--format", "json"];
      if (pageToken) args.push("--page-token", pageToken);

      const parsed = callLarkCli(args, (out) => {
        try {
          const obj = JSON.parse(out) as {
            ok?: boolean;
            data?: {
              chats?: Array<{
                chat_id?: string;
                name?: string;
                description?: string;
              }>;
              has_more?: boolean;
              page_token?: string;
            };
          };
          if (obj.ok === false) return null;
          return {
            chats: obj.data?.chats ?? [],
            has_more: obj.data?.has_more ?? false,
            page_token: obj.data?.page_token ?? "",
          };
        } catch {
          return null;
        }
      });

      if (parsed === null) return null;

      for (const c of parsed.chats) {
        if (typeof c.chat_id !== "string" || !isValidChatId(c.chat_id)) continue;
        all.push({
          chatId: c.chat_id,
          name: typeof c.name === "string" ? c.name : "",
          description: typeof c.description === "string" ? c.description : "",
        });
      }

      if (!parsed.has_more || !parsed.page_token) break;
      pageToken = parsed.page_token;
    }

    return all;
  }

  return {
    getGroupInfo,
    listGroupMembers,
    sendGroupMessage,
    listAllBotGroups,
  };
}