/**
 * auth.ts — L4a 业务层鉴权模块（事件驱动版）
 *
 * 职责：
 *   - 判定用户是否拥有「业务私聊」资格
 *   - 从内存群组缓存匹配业务描述
 *   - MVP 匹配策略：归一化子串（含空格 / 标点 / 全角半角 / 大小写处理）
 *
 * 数据来源：事件驱动缓存（零轮询）
 *   - 启动期冷启动：1 次 im +chat-list + N 次 im +chat-members-list
 *   - 运行时：飞书推送 im.chat.* / im.chat.member.* 事件 → 增量更新内存
 *   - 鉴权路径：纯内存匹配，零飞书 API 调用
 *
 * 设计：
 *   - 工厂形态（无单例）
 *   - 内部状态：groups Map<chatId, GroupInfo> + members Map<chatId, Set<openId>>
 *   - 匹配是纯函数（输入确定 → 输出确定）
 *
 * 演进：
 *   - 临时替代：归一化子串（本期 PR）
 *   - 最终方案：agentMatcher 钩子（PI Agent prompt 综合判定）
 */

import type { GroupTool } from "../broadcast/group-tool.js";
import type { GroupInfo } from "../broadcast/group-tool.js";

// ═══════════════════ 类型定义 ═══════════════════

/**
 * AuthModule 输入：用户身份 + 业务描述
 * 注意：移除 authorizedGroupIds（PR4+ 演进）—— 群组列表改为内部缓存
 */
export type AuthInput = {
  /** 飞书 open_id（飞书稳定用户标识）*/
  openId: string;
  /** 用户的业务描述（来自 p2p 消息原文去命令前缀） */
  businessDescription: string;
};

export type AuthResult =
  | { status: "matched"; groupId: string; groupName: string; description: string }
  | { status: "no_match" }
  | { status: "not_member"; groupId: string; groupName: string }
  | { status: "auth_module_error"; reason: string };

/**
 * 方案 D 钩子：PI Agent 综合判定（本期未实现，保留接口）
 * 输入：归一化后的业务描述 + 候选群组列表（按 description 非空过滤）
 * 输出：匹配的 chat_id 或 null
 */
export type AgentMatcher = (
  businessDescription: string,
  candidates: GroupInfo[],
) => Promise<string | null>;

export interface AuthModuleOptions {
  groupTool: GroupTool;
  log: (msg: string) => void;
  /** 方案 D 钩子：可空；为空时降级到归一化子串匹配 */
  agentMatcher?: AgentMatcher;
}

export interface AuthModule {
  /**
   * 启动期冷启动：拉 lark-bot 所在全量群组 + 每个群组的成员。
   * 失败（lark-cli 调用失败 / 超时）→ 抛错，调用方应 fail-fast。
   */
  initBoot(): Promise<void>;

  /** 鉴权判定。纯内存，零飞书 API 调用。 */
  authorize(input: AuthInput): Promise<AuthResult>;

  // ═══════════ 事件处理（飞书推送增量更新内存） ═══════════

  /** im.chat.member.bot.added_v1 事件 */
  onChatAdded(payload: ChatAddedPayload): Promise<void>;

  /** im.chat.member.bot.deleted_v1 事件 */
  onChatDeleted(chatId: string): void;

  /** im.chat.member.user.added_v1 事件 */
  onUserAdded(payload: UserMembershipPayload): void;

  /** im.chat.member.user.deleted_v1 事件 */
  onUserDeleted(payload: UserMembershipPayload): void;

  /** im.chat.updated_v1 事件（payload 含 description） */
  onChatUpdated(payload: ChatUpdatedPayload): void;

  /** im.chat.disbanded_v1 事件 */
  onChatDisbanded(chatId: string): void;

  /** 调试用：当前缓存群组数 */
  groupCount(): number;
}

// ═══════════ 事件 Payload 类型（按飞书 schema） ═══════════

export type ChatAddedPayload = {
  chat_id: string;
  external?: boolean;
  name?: string;
  i18n_names?: { en_us?: string; ja_jp?: string; zh_cn?: string };
  operator_id?: { open_id?: string; union_id?: string; user_id?: string };
};

export type UserMembershipPayload = {
  chat_id: string;
  user_id_list?: Array<{ open_id?: string; union_id?: string; user_id?: string }>;
  operator_id?: { open_id?: string; union_id?: string; user_id?: string };
};

export type ChatUpdatedPayload = {
  chat_id: string;
  before_change?: Partial<GroupInfo>;
  after_change?: Partial<GroupInfo & {
    add_member_permission?: string;
    at_all_permission?: string;
    avatar?: string;
    edit_permission?: string;
    group_message_type?: string;
    i18n_names?: Record<string, string>;
    join_message_visibility?: string;
    leave_message_visibility?: string;
  }>;
  operator_id?: { open_id?: string; union_id?: string; user_id?: string };
};

// ═══════════ 归一化（去空格/标点/全角转半角/小写化） ═══════════

/**
 * 归一化文本用于子串匹配：
 *   1. 全角转半角（仅 ASCII 可转部分，U+FF01-FF5E → 21-3E）
 *   2. 统一小写
 *   3. 去空白字符（\s 全部去除）
 *   4. 去标点（中英常见标点）
 *
 * 用于子串匹配前的双方归一化，确保"mmw攻略组" 能命中 "mmw攻略组智能体开发者群"，
 * 也允许"智能体开发者" 命中 "智能体开发"（前者是后者的子串）。
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")              // 全角→半角 + 各类归一化（含兼容分解）
    .toLowerCase()                   // 大小写归一
    .replace(/[\s\u3000]+/g, "")    // 去所有空白（含全角空格 \u3000）
    .replace(/[，。！？；：、·…—\-_/\\()（）【】《》「」『』"\u201c\u201d\u2018\u2019`´~～@#\$%\^&\*\+=|<>?:;{}\[\].,!?;:'"`~]/g, ""); // 去标点
}

/**
 * 子串匹配：归一化后判断双向包含。
 * 任一为空串视为不匹配。
 */
export function substringMatch(userDesc: string, groupDesc: string): boolean {
  const u = normalizeForMatch(userDesc);
  const g = normalizeForMatch(groupDesc);
  if (!u || !g) return false;
  return u.includes(g) || g.includes(u);
}

// ═══════════ 实现 ═══════════

export function createAuthModule(opts: AuthModuleOptions): AuthModule {
  const { groupTool, log, agentMatcher } = opts;

  /** 群组元数据缓存（chat_id → GroupInfo，含 description） */
  const groups = new Map<string, GroupInfo>();

  /** 群成员缓存（chat_id → Set<open_id>） */
  const members = new Map<string, Set<string>>();

  function isValidOpenId(openId: string): boolean {
    return /^ou_[0-9a-f]{32}$/i.test(openId);
  }

  function isValidChatId(chatId: string): boolean {
    return /^oc_[0-9a-f]{32}$/i.test(chatId);
  }

  // ─────────────── 启动期冷启动 ───────────────

  async function initBoot(): Promise<void> {
    log("🚀 [auth] 冷启动：拉取 lark-bot 所在群组列表");
    const allGroups = await groupTool.listAllBotGroups();
    if (allGroups === null) {
      throw new Error("auth initBoot failed: listAllBotGroups returned null");
    }
    log(`✓ [auth] 冷启动：获得 ${allGroups.length} 个群组`);

    for (const g of allGroups) {
      if (!isValidChatId(g.chatId)) continue;
      groups.set(g.chatId, g);
      const m = await groupTool.listGroupMembers(g.chatId);
      if (m === null) {
        log(`⚠️ [auth] 冷启动群成员失败: ${g.chatId}，跳过成员缓存`);
        continue;
      }
      members.set(g.chatId, new Set(m));
    }
    log(`✓ [auth] 冷启动完成：groups=${groups.size} members=${members.size} chats`);
  }

  // ─────────────── 鉴权判定（纯内存） ───────────────

  async function authorize(input: AuthInput): Promise<AuthResult> {
    const { openId, businessDescription } = input;

    // 1. openId 格式校验
    if (!isValidOpenId(openId)) {
      log(`⚠️ [auth] open_id 格式非法: ${openId.slice(0, 12)}...`);
      return { status: "auth_module_error", reason: "invalid open_id format" };
    }

    // 2. 过滤候选群组：description 非空
    const candidates = [...groups.values()].filter((g) => g.description && g.description.trim());

    if (candidates.length === 0) {
      log(`⚠ [auth] no_match: openId=${openId.slice(-8)} (无 description 候选群组)`);
      return { status: "no_match" };
    }

    // 3. 匹配策略：先 agentMatcher（如果存在），降级到归一化子串
    let matchedGroup: GroupInfo | null = null;

    if (agentMatcher) {
      try {
        const matchedId = await agentMatcher(businessDescription, candidates);
        if (matchedId) {
          matchedGroup = groups.get(matchedId) ?? null;
          if (matchedGroup) {
            log(`✓ [auth] agentMatcher matched: group=${matchedId}`);
          }
        }
      } catch (e) {
        log(`⚠️ [auth] agentMatcher 异常，降级到子串匹配: ${(e as Error).message?.slice(0, 200)}`);
        matchedGroup = null;
      }
    }

    if (!matchedGroup) {
      for (const g of candidates) {
        if (substringMatch(businessDescription, g.description)) {
          matchedGroup = g;
          break;
        }
      }
    }

    if (!matchedGroup) {
      log(
        `⚠ [auth] no_match: openId=${openId.slice(-8)} desc="${businessDescription.slice(0, 30)}"`,
      );
      return { status: "no_match" };
    }

    // 4. 成员资格校验
    const memberSet = members.get(matchedGroup.chatId);
    if (!memberSet) {
      log(`⚠️ [auth] 成员列表缺失: group=${matchedGroup.chatId}（事件尚未推送）`);
      return { status: "auth_module_error", reason: "members cache missing" };
    }

    if (memberSet.has(openId)) {
      log(`✓ [auth] matched: openId=${openId.slice(-8)} group=${matchedGroup.chatId} "${matchedGroup.name}"`);
      return {
        status: "matched",
        groupId: matchedGroup.chatId,
        groupName: matchedGroup.name,
        description: matchedGroup.description,
      };
    }

    log(`⚠ [auth] matched desc but not member: openId=${openId.slice(-8)} group=${matchedGroup.chatId}`);
    return { status: "not_member", groupId: matchedGroup.chatId, groupName: matchedGroup.name };
  }

  // ─────────────── 事件处理 ───────────────

  async function onChatAdded(payload: ChatAddedPayload): Promise<void> {
    if (!isValidChatId(payload.chat_id)) return;
    // bot 加入群时事件不含 description，调一次 +chat-get 补全
    const info = await groupTool.getGroupInfo(payload.chat_id);
    if (info === null) {
      log(`⚠️ [auth] onChatAdded: 补 description 失败 chat_id=${payload.chat_id}，仅记录空 description`);
      groups.set(payload.chat_id, {
        chatId: payload.chat_id,
        name: payload.name ?? "",
        description: "",
      });
    } else {
      groups.set(payload.chat_id, info);
    }
    // 补成员列表
    const m = await groupTool.listGroupMembers(payload.chat_id);
    members.set(
      payload.chat_id,
      m ? new Set(m) : new Set(),
    );
    log(`✓ [auth] onChatAdded: chat_id=${payload.chat_id} groups=${groups.size}`);
  }

  function onChatDeleted(chatId: string): void {
    if (!isValidChatId(chatId)) return;
    groups.delete(chatId);
    members.delete(chatId);
    log(`✓ [auth] onChatDeleted: chat_id=${chatId} groups=${groups.size}`);
  }

  function onUserAdded(payload: UserMembershipPayload): void {
    if (!isValidChatId(payload.chat_id)) return;
    const userIds = payload.user_id_list ?? [];
    let set = members.get(payload.chat_id);
    if (!set) {
      set = new Set();
      members.set(payload.chat_id, set);
    }
    for (const u of userIds) {
      if (u.open_id && isValidOpenId(u.open_id)) {
        set.add(u.open_id);
      }
    }
  }

  function onUserDeleted(payload: UserMembershipPayload): void {
    if (!isValidChatId(payload.chat_id)) return;
    const userIds = payload.user_id_list ?? [];
    const set = members.get(payload.chat_id);
    if (!set) return;
    for (const u of userIds) {
      if (u.open_id && isValidOpenId(u.open_id)) {
        set.delete(u.open_id);
      }
    }
  }

  function onChatUpdated(payload: ChatUpdatedPayload): void {
    if (!isValidChatId(payload.chat_id)) return;
    const existing = groups.get(payload.chat_id);
    if (!existing) {
      log(`⚠️ [auth] onChatUpdated: chat_id=${payload.chat_id} 不在缓存，忽略`);
      return;
    }
    const after = payload.after_change ?? {};
    // payload 含 description / name 等字段，直接更新
    groups.set(payload.chat_id, {
      chatId: payload.chat_id,
      name: after.name ?? existing.name,
      description: after.description ?? existing.description,
    });
  }

  function onChatDisbanded(chatId: string): void {
    onChatDeleted(chatId);
  }

  function groupCount(): number {
    return groups.size;
  }

  return {
    initBoot,
    authorize,
    onChatAdded,
    onChatDeleted,
    onUserAdded,
    onUserDeleted,
    onChatUpdated,
    onChatDisbanded,
    groupCount,
  };
}