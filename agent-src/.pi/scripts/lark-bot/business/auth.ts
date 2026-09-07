/**
 * auth.ts — L4a 业务层鉴权模块
 *
 * 职责：
 *   - 判定用户是否拥有「业务私聊」资格
 *   - 调用 GroupTool 拉群组 description + 成员列表
 *   - MVP 阶段：业务描述精确匹配群组 description（占位实现）
 *
 * 设计：
 *   - 纯函数形态（业务层文档 §4）：不持有缓存、不写 journal、不调协议层
 *   - 依赖 GroupTool 完成数据获取
 *
 * 演进：
 *   - MVP 阶段：精确匹配作为占位实现
 *   - 后续阶段：可升级到「agent 通过 prompt 综合匹配」（PR 4+）
 */

import type { GroupTool } from "../broadcast/group-tool.js";

// ═══════════════════ 类型定义 ═══════════════════

export type AuthInput = {
  /** 飞书 open_id（飞书稳定用户标识） */
  openId: string;
  /** 用户的业务描述（来自 p2p 消息原文去命令前缀） */
  businessDescription: string;
  /** 候选授权群组 chat_id 列表（由调用方从 settings.json 传入） */
  authorizedGroupIds: string[];
};

export type AuthResult =
  | { status: "matched"; groupId: string; groupName: string; description: string }
  | { status: "no_match" }
  | { status: "not_member"; groupId: string; groupName: string }
  | { status: "auth_module_error"; reason: string };

export interface AuthModule {
  /**
   * 鉴权判定。失败（openId 非法 / 所有候选群组拉取失败）返回 auth_module_error。
   */
  authorize(input: AuthInput): Promise<AuthResult>;
}

/** 工厂选项 */
export interface AuthModuleOptions {
  groupTool: GroupTool;
  log: (msg: string) => void;
}

// ═══════════════════ 实现 ═══════════════════

export function createAuthModule(opts: AuthModuleOptions): AuthModule {
  const { groupTool, log } = opts;

  function isValidOpenId(openId: string): boolean {
    // 飞书 open_id 形如 "ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    return /^ou_[0-9a-f]{32}$/i.test(openId);
  }

  /**
   * MVP 占位：业务描述与群组 description 做精确匹配。
   * 后续可升级为 agent 综合匹配（精确 / 关键词 / 语义）。
   */
  function matchDescription(businessDescription: string, groupDescription: string): boolean {
    if (!businessDescription.trim() || !groupDescription.trim()) return false;
    return businessDescription.trim() === groupDescription.trim();
  }

  async function authorize(input: AuthInput): Promise<AuthResult> {
    const { openId, businessDescription, authorizedGroupIds } = input;

    // 1. openId 格式校验
    if (!isValidOpenId(openId)) {
      log(`⚠️ [auth] open_id 格式非法: ${openId.slice(0, 12)}...`);
      return { status: "auth_module_error", reason: "invalid open_id format" };
    }

    // 2. 遍历候选群组，拉 description
    let lastError = "";
    for (const groupId of authorizedGroupIds) {
      const info = await groupTool.getGroupInfo(groupId);
      if (info === null) {
        // 单个群组失败不阻塞整体，继续下一个
        lastError = `getGroupInfo(${groupId}) failed`;
        continue;
      }
      // 3. 精确匹配
      if (!matchDescription(businessDescription, info.description)) continue;

      // 4. 匹配成功 → 验证成员资格
      const members = await groupTool.listGroupMembers(groupId);
      if (members === null) {
        lastError = `listGroupMembers(${groupId}) failed`;
        continue;
      }
      if (members.includes(openId)) {
        log(`✓ [auth] matched: openId=${openId.slice(-8)} group=${groupId} "${info.name}"`);
        return {
          status: "matched",
          groupId,
          groupName: info.name,
          description: info.description,
        };
      } else {
        log(
          `⚠ [auth] matched description but not member: openId=${openId.slice(-8)} group=${groupId}`,
        );
        return { status: "not_member", groupId, groupName: info.name };
      }
    }

    // 5. 全部遍历完：要么没匹配，要么全失败
    if (lastError) {
      log(`⚠️ [auth] 鉴权模块错误: ${lastError}`);
      return { status: "auth_module_error", reason: lastError };
    }
    log(
      `⚠ [auth] no_match: openId=${openId.slice(-8)} desc="${businessDescription.slice(0, 30)}"`,
    );
    return { status: "no_match" };
  }

  return { authorize };
}