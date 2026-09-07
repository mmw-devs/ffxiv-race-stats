/**
 * broadcast.ts — L4a 业务层广播模块
 *
 * 职责：
 *   - 在授权群组中广播鉴权结果（工作留痕）
 *   - MVP 阶段：固定格式模板（参见 renderBroadcastText）
 *
 * 触发场景：
 *   - 鉴权成功（matched）→ 广播到匹配群组："用户 X 申请业务私聊成功"
 *   - 鉴权失败 / 用户不在成员列表（not_member）→ 广播到匹配群组："用户 X 申请业务私聊失败"
 *
 * 设计：
 *   - 纯函数形态（业务层文档 §4）
 *   - 不持有缓存、不写 journal
 *   - 仅调用 GroupTool.sendGroupMessage
 */

import type { GroupTool } from "../broadcast/group-tool.js";

// ══════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════

/** 鉴权结果的广播侧语义（与 AuthResult.status 对齐，但不含 no_match / auth_module_error） */
export type BroadcastOutcome = "matched" | "not_member" | "ended";

export type BroadcastEvent = {
  /** 申请人飞书 open_id */
  openId: string;
  /** 目标群组 chat_id */
  groupId: string;
  /** 群组名称（用于模板渲染） */
  groupName: string;
  /** 鉴权结果：matched=成功 / not_member=失败 */
  outcome: BroadcastOutcome;
  /** 失败原因（仅 not_member 时填充；缺省为"不在成员列表"） */
  reason?: string;
  /** @ 提及的用户 open_id（可选） */
  mentionOpenId?: string;
  /** 引用回复的消息 message_id（仅 ended outcome 用：引用会话开启的 matched 广播消息） */
  replyToMessageId?: string;
};

export type BroadcastResult = {
  ok: boolean;
  error?: string;
};

export interface BroadcastModule {
  /**
   * 广播鉴权结果到指定群组。
   * 失败（groupTool.sendGroupMessage 返回 ok=false）返回 { ok: false, error }。
   * 返回 message_id（群组发出的消息 id，可用于后续"引用回复"）。
   */
  announce(event: BroadcastEvent): Promise<BroadcastResult & { messageId?: string }>;
}

/** 工厂选项 */
export interface BroadcastModuleOptions {
  groupTool: GroupTool;
  log: (msg: string) => void;
}

// ══════════════════════════════════════════════════════════════
// 固定格式模板（K4 确认）
// ══════════════════════════════════════════════════════════════

/**
 * 渲染广播文本（固定格式模板）
 *   - 成功：🔔 [业务私聊] ✅ 用户 <openId> 申请成功（群组：<groupName>）
 *   - 失败：🔔 [业务私聊] ❌ 用户 <openId> 申请失败（群组：<groupName>）：<reason>
 *   - 结束：🔔 [业务私聊] 🏁 用户 <openId> 申请结束（群组：<groupName>）
 */
export function renderBroadcastText(event: BroadcastEvent): string {
  const prefix = "🔔 [业务私聊]";
  if (event.outcome === "matched") {
    return `${prefix} ✅ 用户 ${event.openId} 申请成功（群组：${event.groupName}）`;
  }
  if (event.outcome === "ended") {
    return `${prefix} 🏁 用户 ${event.openId} 申请结束（群组：${event.groupName}）`;
  }
  // not_member
  const reason = event.reason ?? "不在成员列表";
  return `${prefix} ❌ 用户 ${event.openId} 申请失败（群组：${event.groupName}）：${reason}`;
}

// ══════════════════════════════════════════════════════════════
// 实现
// ══════════════════════════════════════════════════════════════

export function createBroadcastModule(opts: BroadcastModuleOptions): BroadcastModule {
  const { groupTool, log } = opts;

  async function announce(event: BroadcastEvent): Promise<BroadcastResult & { messageId?: string }> {
    const text = renderBroadcastText(event);
    // sendGroupMessage 走 rich_text post 类型，支持 at 提及 + root_id 引用回复
    const result = await groupTool.sendGroupMessage(event.groupId, {
      text,
      mentionOpenId: event.mentionOpenId ?? event.openId,
      replyToMessageId: event.replyToMessageId,
    });
    if (result.ok) {
      log(`✓ [broadcast] 广播成功: group=${event.groupId} outcome=${event.outcome} mention=${event.mentionOpenId ?? "-"} reply=${event.replyToMessageId ?? "-"}`);
    } else {
      log(`⚠️ [broadcast] 广播失败: group=${event.groupId} outcome=${event.outcome} error=${result.error}`);
    }
    return result;
  }

  return { announce };
}