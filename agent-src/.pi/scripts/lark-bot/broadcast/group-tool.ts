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
  /** 发送成功后返回飞书 message_id（用于后续"引用回复"场景） */
  messageId?: string;
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
  sendGroupMessage(
    chatId: string,
    content: { text: string; mentionOpenId?: string; replyToMessageId?: string }
  ): Promise<SendResult>;

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
          // lark-cli stdout 可能有非 JSON 提示行（如 "[page 1] fetching..." "Found 6 user(s) and 1 bot(s)"），
          // 从末尾找最后一个 '{' 作为 JSON 起点。
          const jsonStart = out.indexOf("{");
          if (jsonStart < 0) return null;
          const obj = JSON.parse(out.slice(jsonStart)) as {
            data?: { users?: Array<{ member_id?: string }>; bots?: unknown[] };
          };
          const users = obj.data?.users;
          if (!Array.isArray(users)) return null;
          return users
            .filter((it) => typeof it.member_id === "string")
            .map((it) => it.member_id as string);
        } catch {
          return null;
        }
      },
    );
  }

  async function sendGroupMessage(
    chatId: string,
    content: { text: string; mentionOpenId?: string; replyToMessageId?: string }
  ): Promise<SendResult> {
    if (!isValidChatId(chatId)) {
      return { ok: false, error: "invalid chat_id" };
    }

    // 构造飞书 rich_text content JSON（post type，zh_cn locale 格式）：
    //   - mentionOpenId 有值时插入 <at user_id="..."> 元素（真正 at 提及）
    //   - replyToMessageId 有值时插入顶层 root_id（飞书 im/v1/messages 引用回复）
    const richTextElements: Array<Record<string, unknown>> = [
      { tag: "text", text: content.text },
    ];
    if (content.mentionOpenId) {
      richTextElements.push({ tag: "at", user_id: content.mentionOpenId });
    }
    const contentJson = {
      zh_cn: {
        title: "",
        content: [richTextElements],  // 二维数组（一行）
      },
    };

    // 复用回复路径：有 replyToMessageId 时走 `im +messages-reply --message-id <root>`（不需要 --chat-id，lark-cli 通过 message-id 自动定位父消息），
    // 否则走 `im +messages-send`。两种路径 content JSON 格式一致。
    const subCommand = content.replyToMessageId ? "+messages-reply" : "+messages-send";
    const args: string[] = [
      "im",
      subCommand,
      "--content",
      JSON.stringify(contentJson),
      "--msg-type",
      "post",
      "--as",
      "bot",
      "--format",
      "json",
    ];
    if (content.replyToMessageId) {
      // +messages-reply：通过 message-id 自动定位父消息，不传 --chat-id
      args.push("--message-id", content.replyToMessageId);
    } else {
      // +messages-send：需要 --chat-id 定位目标
      args.push("--chat-id", chatId);
    }
    try {
      const out = execFileSync(cliPath, args, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const obj = JSON.parse(out) as { data?: { message_id?: string } };
        if (typeof obj.data?.message_id === "string") {
          return { ok: true, messageId: obj.data.message_id };
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