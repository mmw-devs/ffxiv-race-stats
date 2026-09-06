# lark-bot 群聊工具层设计文档

> L4a Broadcast 层从「占位」升级为实质工具模块。本文档只描述工具层（不绑业务语义）。
> 业务逻辑（用工具做什么）由 skill 层规范。

## 1. 模块定位

L4a Broadcast（lark-bot 分层架构，参见 `agent-src/.pi/scripts/lark-bot/README.md` §1）。
本模块只提供原子工具能力，不包含业务决策。

L4a 群聊侧整体由工具层（本文档）+ 业务层（参见 `lark-bot-broadcast-business-design.md`）组成。

## 2. 职责边界

包含：
- 群组元数据查询（chat_id → { name, description, members[] }）
- 群组消息发送
- 必要的 lark-cli 适配层封装
- 缓存（避免重复 API 调用）
- fail-closed 兜底（lark-bot 规范 §4）

不包含：
- 群组授权判定（业务层决策）
- 业务消息内容生成（skill 层）
- 群聊会话生命周期（独立于私聊 PiSession）

## 3. 分层依赖

- L4a Broadcast → L1 Protocol
- 复用 `protocol/feishu.ts` 的 lark-cli 适配模式
- 不绕过中间层调底层 fs / 子进程（lark-bot 规范 §3）

## 4. 接口形状

参照 `identity-resolver.ts` 的纯函数工厂模式：

```typescript
// GroupInfo 字段来源：飞书 chats get API 透传（im chats get 响应 schema）
export type GroupInfo = {
  chatId: string;
  name: string;
  description: string; // 群描述，用于鉴权模块业务匹配
  // 其他字段按需扩展
};

export interface GroupTool {
  getGroupInfo(chatId: string): Promise<GroupInfo | null>;
  listGroupMembers(chatId: string): Promise<string[] | null>;
  sendGroupMessage(chatId: string, text: string): Promise<SendResult>;
  clearCache(): void;
  cacheSize(): number;
}
```