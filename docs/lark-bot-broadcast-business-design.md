# lark-bot 群聊业务层设计文档

> L4a 群聊业务层（位于 L4a 工具层之上）。本层只包含业务逻辑，工具能力由工具层提供。

## 1. 模块定位

L4a 群聊业务层。包含两个子模块：

- **鉴权模块**（auth）：判定用户是否拥有「业务私聊」资格
- **广播模块**（broadcast）：在授权群组中广播鉴权结果

业务层不绑定具体业务语义，业务目标由 skill 层规范。

## 2. 职责边界

包含：
- 鉴权判定（业务描述 → 群组匹配 → 成员资格校验）
- 广播内容生成（固定格式模板）
- 鉴权结果产出（结构化判定；后续动作由 ingress 编排：matched / not_member 触发广播）

不包含：
- 飞书 API 调用（归工具层 `GroupTool`）
- 业务私聊会话生命周期（归 L4b 私聊侧）
- 任务状态机逻辑（归 task-state-machine）
- 持久化与 journal 写入（归 `emitTaskJournal`）

## 3. 分层依赖

- 业务层 → L4a 工具层（`GroupTool` 接口）—— 不绕过中间层调 lark-cli
- 业务层 → L4b 私聊侧 —— 私聊侧作为鉴权触发调用方，业务层不直接依赖私聊内部状态
- 日志输出走 `shared/logger.ts` 门面（lark-bot 规范 §3）

## 4. 接口形状（纯函数）

鉴权模块：

```typescript
export interface AuthModule {
  authorize(input: AuthInput): Promise<AuthResult>;
}
```

广播模块：

```typescript
export interface BroadcastModule {
  announce(event: BroadcastEvent): Promise<BroadcastResult>;
}
```

鉴权模块不持有缓存、不写 journal、不调协议层。
广播模块不持有模板字符串、不做鉴权判定。

`AuthInput` / `AuthResult` / `BroadcastEvent` / `BroadcastResult` 的具体字段定义以私聊侧 MVP 文档 `lark-bot-p2p-business-design.md` §3 鉴权阶段的语义为准。

## 5. 与工具层的关系

业务层**不持有**飞书 API 适配细节。
`GroupTool.getGroupInfo` 返回的 `description` 直接作为鉴权判定输入。
`GroupTool.sendGroupMessage` 由 `BroadcastModule` 调用。

## 6. 与私聊侧的接口边界

私聊侧作为鉴权触发调用方，业务层不直接依赖私聊内部状态。
业务层调用方为 ingress（私聊侧 L4b），按 lark-bot 规范 §3 跨层调用允许。
具体私聊流程（临时 / 业务会话状态机、5min / 2 轮鉴权窗口、极端情况处理）以私聊侧 MVP 文档 `lark-bot-p2p-business-design.md` §3 鉴权阶段为准。鉴权模块的入参 / 出参形状作为接口边界预留。