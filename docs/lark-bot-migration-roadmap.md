# 渐进迁移路线图 + registerTool 契约设计（issue #168 第一阶段 N4）

> 综合 N1+N2+N3+N5 的渐进迁移 PR 拆分与 registerTool 接口契约。
> 范围：issue #168 第一阶段综合产出物。
> 不在范围：第一阶段汇总（见 N6）、spawn vs extension 对比（见 N3）、业务流图（见 N1）。

## 0. 阅读对象与范围

- 阅读对象：issue #168 重构方案设计者、lark-bot 维护者、PI Agent 协议设计者、PR reviewer。
- 范围：PR-1 ~ PR-4 拆分细节；registerTool 接口契约；回滚方案；测试覆盖。
- 不在范围：业务语义判断本身（鉴权匹配 / 关闭意图 / 业务执行的判定逻辑在 PR 落地时由 PI Agent LLM 实现）。

## 1. 迁移路线图总览

### 1.1 PR 拆分（路 C，决策 1）

| PR | 内容 | 决策依据 | 前置依赖 |
|----|------|---------|---------|
| PR-1 | 优化 spawn 基础设施 + extension 化 registerTool（**不消除 spawn**） | 决策 1 渐进迁移第一步 | 无 |
| PR-2 | 鉴权判定迁 PI Agent LLM | 决策 4 | PR-1 |
| PR-3 | 关闭意图删除本地正则 | 决策 5 | PR-1 |
| PR-4 | 任务日志对象接入 OPERATOR_LOG | 决策 3 + 决策 5 | PR-1（PR-2 与 PR-3 可作为软依赖） |

### 1.2 依赖图

```
PR-1 (extension 化)
  ├→ PR-2 (鉴权 LLM)
  ├→ PR-3 (关闭意图)
  └→ PR-4 (任务日志)
        ↑
        └ 软依赖：PR-2 完成后 PR-4 才能在业务私聊关闭时正确初始化 task_journal buffer
                    PR-3 完成后 PR-4 才能在 `larkbot_close_business_session` 时简化清理逻辑
```

### 1.3 并行性

- PR-2 / PR-3 / PR-4 必须串行在 PR-1 之后
- PR-2 / PR-3 / PR-4 理论上可并行（无强代码冲突），但代码合并冲突风险高
- **建议顺序**：PR-1 → PR-2 → PR-3 → PR-4

### 1.4 PR 演进节奏一致性

参照 PR #159 / #161 / #163 演进节奏：

| 演进 | 单 PR 范围 | 提交频率 |
|------|-----------|---------|
| 历史 | 解决一个具体不稳定点 | 每 PR 1 周内 |
| 重构期 | 解决一个架构问题 | 每 PR 2 周内 |

## 2. registerTool 清单总览

按 PR 分组：

### 2.1 PR-1（extension 化）— 飞书 I/O registerTool

| registerTool | 替换现有实现 | 持久层 |
|--------------|-------------|--------|
| `feishu_add_reaction` | `protocol/feishu.ts addReaction` | lark-cli `im reactions create` |
| `feishu_remove_reaction` | `protocol/feishu.ts delReaction` | lark-cli `im reactions delete` |
| `feishu_send_reply` | `protocol/feishu.ts sendReply / sendReplyGetId` | lark-cli `im +messages-reply` |
| `feishu_get_group_info` | `broadcast/group-tool.ts getGroupInfo` | lark-cli `im chats get` |
| `feishu_list_group_members` | `broadcast/group-tool.ts listGroupMembers` | lark-cli `im +chat-members-list` |
| `feishu_send_group_message` | `broadcast/group-tool.ts sendGroupMessage` | lark-cli `im +messages-send` / `+messages-reply` |
| `feishu_list_bot_groups` | `broadcast/group-tool.ts listAllBotGroups` | lark-cli `im +chat-list` |
| `larkbot_fetch_pending_events` | 新增（PR-1 飞书 WS 桥接） | module-level 队列 + LLM 拉取 |

### 2.2 PR-2（鉴权 LLM）— 业务 registerTool

| registerTool | 替换现有实现 | 用途 |
|--------------|-------------|------|
| `larkbot_list_candidate_groups` | `auth.ts candidates 过滤逻辑` | 鉴权决策输入（候选群组列表） |
| `larkbot_authorize_user` | `auth.ts authorize / substringMatch` | 鉴权决策执行（成员资格校验） |
| `larkbot_resolve_operator` | `identity-resolver.ts resolveOperator` | open_id → user_id（OPERATOR_REGISTRY 校验） |

### 2.3 PR-4（任务日志）— 业务 registerTool

| registerTool | 替换现有实现 | 用途 |
|--------------|-------------|------|
| `larkbot_record_change` | 无（缺失路径补齐） | 累积 ChangeEntry 到 task_journal buffer |
| `larkbot_commit_changes` | 无 | buffer → LogEntry 转换 + 返回 commitMessage |
| `larkbot_close_business_session` | 无 | cleanupSessionForClose 六步 + ended 广播（不提交 PR） |
| `larkbot_query_journal` | 无（调试用） | 查询当前 session 的 task_journal 状态 |

### 2.4 registerTool 总数

| PR | 飞书 I/O | 业务 | 调试 | 桥接 |
|----|---------|------|------|------|
| PR-1 | 7 | 0 | 0 | 1 |
| PR-2 | 0 | 3 | 0 | 0 |
| PR-4 | 0 | 3 | 1 | 0 |
| **合计** | **7** | **6** | **1** | **1** |

## 3. PR-1 详细设计：extension 化

### 3.1 目标

**修订后**：保留 MVP spawn 模式（每 chat 一个 PI Agent 子进程 `spawn(pi --mode rpc --session-dir <chatId>)`），不消除 PI Agent 子进程层（方案 G）；PR-1 主要工作是**优化 spawn 基础设施**（spawn helper / mutex / restart 防护）+ **extension 化飞书 I/O / 鉴权 / 业务 / 任务日志**为 registerTool 集合，替代 stdin/stdout NDJSON 协议。保留 lark-cli 子进程层（飞书 I/O 必须）。

理由：PI Agent 实际 API（types.d.ts L246-289）不支持 per-chat 并发隔离 sub-session（详见 issue #168 comment 5592358044），唯一可落地的 per-chat LLM 上下文隔离方案是 per-chat spawn，与 doubao 建议一致。

### 3.2 删除项

| 类别 | 具体项 |
|------|-------|
| 进程管理 | `process.ts` 全部（PID / 看门狗 / 双层 restart storm / 心跳 / 内存监控 / stdin shutdown） |
| 进程管理 | `extensions/lark-bot/index.ts` 的 spawn 逻辑（**保留 spawn，但精简为 optimization helper**——不消除 spawn） |
| NDJSON 协议 | `session-manager.ts` `handlePiEvent` NDJSON 解析循环（**改为 lark-bot module-level 事件队列 + registerTool 拉取模式**） |
| NDJSON 协议 | `task-state-machine.ts` 中 pi.stdin.write / pi.stdout 读取（**改为 lark-bot module-level 转发**） |
| 配置 | `.pi/settings.json` 中 `larkBot.autoStart` 配置（不再需要） |
| 持久化 | `/tmp/lark-bot.pid` / `/tmp/lark-bot.restart-history` / `/tmp/lark-bot.pi-restart-history` |
| 保留 | `session-manager.ts` `spawnPiProcess` / `spawnPromises` / `piRestartState`（**精简优化而非删除**，方案 G 保留 per-chat spawn） |
| 保留 | `config.ts` PI_RESTART_* 常量（精简为更合理的 restart 策略） |

### 3.3 保留项

| 类别 | 具体项 |
|------|-------|
| 飞书 WS 接收 | `protocol/feishu.ts startLarkEvents`（仍 spawn lark-cli event consume） |
| 飞书协议 I/O | `protocol/feishu.ts circuit breaker` 状态（移到 module-level） |
| 飞书事件入口 | `ingress.ts` 飞书事件 → LLM 决策桥接（**改为 module-level 事件队列 + registerTool larkbot_fetch_pending_events 拉取模式；PI Agent 由每 chat spawn 提供，无 ingress 直接 spawn**） |
| 鉴权缓存 | `business/auth.ts groups / members Map`（PR-2 复用） |
| 工作留痕 | `business/broadcast.ts announce`（PR-2 复用） |
| 群组 API | `broadcast/group-tool.ts`（被 registerTool feishu_* 复用） |
| 配置 | `config.ts` 路径 / emoji / 超时常量 |
| 日志 | `shared/logger.ts` |
| 类型 | `shared/types.ts` PendingTask / LarkEvent |

### 3.4 新增项

| 类别 | 具体项 |
|------|-------|
| Extension 主入口 | `extensions/lark-bot/index.ts` 改为 registerTool 集合 |
| Module-level 状态 | `sessions Map<chatId, PiSession>` / `authorizedSlots` / `circuitBreaker state` / `groups Map<chatId, GroupInfo>` / `members Map<chatId, Set<openId>>` / `identityCache Map<openId, CacheValue>` |
| 飞书 WS 桥接 | module-level 异步队列：飞书事件 → LLM 上下文注入 / 鉴权触发 |
| registerTool | feishu_add_reaction / feishu_remove_reaction / feishu_send_reply / feishu_get_group_info / feishu_list_group_members / feishu_send_group_message / feishu_list_bot_groups |

### 3.5 extensions/lark-bot/index.ts 改造骨架

```typescript
import { spawn } from "node:child_process";  // 仅用于 lark-cli spawn
import { Type } from "@sinclair/typebox";      // TypeBox schema

export default function (pi: ExtensionAPI) {
  // ── 启动期：初始化飞书 WS 订阅（PR-1 保留 lark-cli spawn）
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") return;
    await initLarkBotModule();           // 启动群组冷启动 + EventKey 订阅
    // 不再 spawn lark-bot 主进程
  });

  // ── 关闭期：清理 module-level 状态
  pi.on("session_shutdown", async (event, ctx) => {
    cleanupLarkBotModule();
  });

  // ── 飞书 I/O registerTool（7 个）
  pi.registerTool({
    name: "feishu_add_reaction",
    label: "添加飞书表情",
    description: "为飞书消息添加 emoji 反应",
    parameters: Type.Object({
      msgId: Type.String(),
      emoji: Type.String(),
    }),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      return await feishuAddReaction(params);
    },
  });
  // ... 其他 6 个飞书 I/O registerTool
}
```

### 3.6 registerTool 契约（PR-1 飞书 I/O）

```typescript
// feishu_add_reaction
{
  name: "feishu_add_reaction",
  label: "添加飞书表情",
  description: "为飞书消息添加 emoji 反应（如 'WAVE' / 'THINKING' / 'DONE' / 'ERROR'）。返回 reaction_id 用于后续切换或删除。",
  parameters: Type.Object({
    msgId: Type.String({ description: "飞书消息 ID" }),
    emoji: Type.String({ description: "emoji 类型，如 'WAVE'" }),
  }),
  execute: async (params, ctx) => {
    // 内部调 lark-cli im reactions create
    // 熔断器检查
    // 返回 {ok: true, reactionId: '...'} 或 {ok: false, error: '...'}
  },
}

// feishu_send_reply
{
  name: "feishu_send_reply",
  label: "回复飞书消息",
  description: "回复飞书私聊消息，返回新消息 ID。超时 18s。",
  parameters: Type.Object({
    msgId: Type.String(),
    text: Type.String({ maxLength: 4000 }),
  }),
  execute: async (params, ctx) => {
    // 内部调 sendReplyGetId（保留超时机制）
    // 返回 {ok: true, replyId: '...'} 或 {ok: false, error: '...', timedOut}
  },
}
```

（其他 5 个 registerTool 契约按相同模式展开，本节不重复）

### 3.7 飞书 WS 桥接（PR-1 关键设计点）

**问题 1**：registerTool 是 LLM 触发的，飞书 WS 事件是被动接收的，两者如何桥接？

**问题 2**（焦发点）：PR-1 后如何隔离不同私聊会话？

**原方案 B（PR-170）的错误**：

> 原计划使用 `ctx.forkOrCreate({ sessionDir })` API 创建 per-chat sub-session，但该 API **不存在**。
>
> PI Agent ExtensionCommandContext 实际仅有 `newSession` / `fork` / `switchSession`（extensions.md L1074），但均为"替换当前 session"操作，且**只能在 command handler 中调用**，event handler / registerTool 中不可用。
>
> 详见 issue #168 comment 5592358044。

**方案 G（当前采用）**：

保留 MVP 现状：每 chat 一个独立 PI Agent 子进程（`spawn(pi --mode rpc --session-dir <chatId>)`）+ 强化应用层隔离。

```typescript
// MVP 当前实现（保留）
// agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts
pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
  // sessionDir = .pi/sessions/bot-p2p-<chatId>/
});

// PR-1 修订：不消除 spawn，改为优化 spawn 基础设施
// agent-src/.pi/extensions/lark-bot/index.ts
pi.on("session_start", async (event) => {
  if (event.reason !== "startup") return;
  await initLarkBotModule();
  // 优化项：spawn helper + spawn mutex + restart 防护
});
```

```typescript
// PR-1 新增：lark-bot module-level 状态 + registerTool 集合
// module-level 事件队列（按 chatId 路由）
const pendingEvents: Map<chatId, LarkEvent[]> = new Map();
// module-level 业务状态（按 chatId 路由）
const sessions: Map<chatId, PiSession> = new Map();
const taskJournals: Map<chatId, TaskJournal> = new Map();

// LLM 拉取当前 chat 的待处理事件（chatId 由 ctx 提供，不接受参数）
registerTool("larkbot_fetch_pending_events", {
  description: "拉取当前 chat 的待处理飞书事件",
  parameters: Type.Object({}),
  execute: async (_, ctx) => {
    // 1. 从 ctx 获取当前 chatId（不接受 LLM 参数，防 LLM 错传）
    const chatId = ctx.chatId;
    // 2. 返回该 chat 的事件队列
    const events = pendingEvents.get(chatId) ?? [];
    pendingEvents.delete(chatId);
    return { events };
  },
});

// lark-cli event consume stdout handler
function onLarkEvent(event: LarkEvent) {
  const queue = pendingEvents.get(event.chat_id) ?? [];
  queue.push(event);
  pendingEvents.set(event.chat_id, queue);
}
```

**隔离层级（4 层）**：

| 层级 | 隔离机制 |
|------|---------|
| **进程隔离** | **每 chat 一个 PI Agent 子进程**（`spawn(pi --session-dir <chatId>)`）——天然 LLM 上下文隔离 |
| **PI Agent session 隔离** | **per-chat sessionDir**（`.pi/sessions/bot-p2p-<chatId>/`）——PI Agent 进程加载独立会话历史 |
| **业务状态隔离** | lark-bot module-level `Map<chatId, ...>` 路由 |
| **任务日志隔离** | per-chat `TaskJournal` |

**为何方案 G 是当前最优解**：

| 替代方案 | 缺陷 |
|---------|------|
| 应用层隔离 + PI Agent 共享 session | LLM 跨 chat 上下文污染（鉴权失效 / 业务错乱 / PR 错误） |
| 自实现 sub-session（绕过 PI Agent session API） | 需绕过 PI Agent skill / tool 系统，工程量大 |
| pi-app-server（多会话网关） | 适用于 Web/桌面/嵌入式，lark-bot 是 extension 模式，与架构冲突 |

方案 G 与 doubao 建议 + PI Agent 官方哲学"spawn pi instances"完全一致，零新 API 依赖，已落地。

**约束**：

- LLM 看不到 chatId 参数（由 ctx 提供），避免跨 chat 错传
- `registerTool execute` 内部统一校验 chatId
- PI Agent 进程崩溃只影响 1 个 chat，不影响其他 chat（进程级故障隔离）
- `pi.on('session_shutdown')` 清理 `sessions` / `taskJournals` Map

**风险与缓解**（4 项强化措施）：

| 风险 | 缓解措施 |
|------|---------|
| LLM 跨 chat 上下文污染（理论上不存在） | ✅ 进程级隔离已彻底消除此风险 |
| LLM 错传 chatId | prompt header 强化 chatId 上下文（`[私聊 | chatId=oc_xxx]`）；registerTool 不接受 chatId 参数 |
| registerTool execute 越界 | 每次 execute 从 ctx 取 chatId，与 `pendingEvents` / `sessions` / `taskJournals` Map 路由对齐 |
| OPERATOR_REGISTRY 校验 | 最终业务操作需 `validateOperatorPermission`（PR-4 落地），保证 user_id 在注册表内 |

### 3.8 测试覆盖（PR-1）

| 测试类型 | 覆盖点 |
|---------|--------|
| 单元测试 | registerTool TypeBox schema 验证（8 个工具） |
| 单元测试 | Module-level 状态并发安全 |
| 单元测试 | 飞书 WS 桥接事件队列正确性 |
| 集成测试 | session_start → 群组冷启动 → registerTool 可用 |
| 集成测试 | session_shutdown → module-level 状态清理 |
| Mock 测试 | lark-cli spawn 子进程 mock（保留） |
| 回归测试 | `spawn 'pi --mode rpc'` 调用次数 ≥ 1（per-chat spawn，方案 G 保留） |
| 回归测试 | `session-manager.ts` 中 per-chat sessionDir 格式（`bot-p2p-<chatId>`）正确性 |
| 回归测试 | process.ts 中 PID / 看门狗 / 重启风暴相关代码不再被引用（**但 spawn 本身保留**） |

### 3.9 回滚方案（PR-1）

保留 feature flag `larkBot.useExtensionMode`：

```typescript
// 启动期根据 settings.json 决定走 spawn 模式还是 extension 模式
if (settings.larkBot?.useExtensionMode === true) {
  // 新路径：registerTool
} else {
  // 旧路径：spawn lark-bot 进程（保留 PR-1 之前代码）
}
```

回滚步骤：修改 settings.json → `useExtensionMode: false` → 重启 PI Agent。

## 4. PR-2 详细设计：鉴权迁 LLM

### 4.1 目标

鉴权判定（业务描述 → 群组匹配）由 PI Agent LLM 决策，lark-bot 仅保留成员资格校验。

### 4.2 删除项

| 类别 | 具体项 |
|------|-------|
| 鉴权判定 | `business/auth.ts` `substringMatch` 函数 |
| 鉴权判定 | `business/auth.ts` `agentMatcher` 钩子类型与 factory 调用 |
| 鉴权判定 | `normalizeForMatch`（substringMatch 辅助函数） |
| 调用 | `ingress.ts` 中 substringMatch 调用点 |

### 4.3 保留项

| 类别 | 具体项 |
|------|-------|
| 鉴权缓存 | `auth.ts groups / members Map`（EventKey 增量更新） |
| 鉴权缓存 | `auth.ts onChatAdded / onChatDeleted / onUserAdded / onUserDeleted / onChatUpdated / onChatDisbanded` |
| 鉴权缓存 | `auth.ts initBoot` 冷启动 |
| 工作留痕 | `business/broadcast.ts announce`（鉴权成功后调用） |
| 注册表 | `OPERATOR_REGISTRY`（larkbot_resolve_operator 用） |

### 4.4 新增项

| 类别 | 具体项 |
|------|-------|
| registerTool | `larkbot_list_candidate_groups` |
| registerTool | `larkbot_authorize_user` |
| registerTool | `larkbot_resolve_operator` |
| 决策协议 | `auth_decision` NDJSON 事件（N2 §9.2）→ PR-2 改为 LLM 直接调用 registerTool |

### 4.5 registerTool 契约（PR-2 鉴权 / 身份）

```typescript
// larkbot_list_candidate_groups
{
  name: "larkbot_list_candidate_groups",
  label: "列出候选群组",
  description: "返回 bot 所在的有 description 的群组列表（用于鉴权决策输入）。返回每群的 chatId、name、description。LLM 据此判断用户消息属于哪个业务群组。",
  parameters: Type.Object({}),
  execute: async (_params, ctx) => {
    const candidates = [...groups.values()]
      .filter(g => g.description?.trim())
      .map(g => ({ chatId: g.chatId, name: g.name, description: g.description }));
    return { candidates };
  },
}

// larkbot_authorize_user
{
  name: "larkbot_authorize_user",
  label: "授权用户业务私聊",
  description: "校验用户是否在指定群组成员列表中。LLM 决策 chatId 后调用。返回 matched / not_member / no_match。",
  parameters: Type.Object({
    openId: Type.String({ description: "飞书用户 open_id" }),
    chatId: Type.String({ description: "LLM 决策的群组 chat_id" }),
  }),
  execute: async ({ openId, chatId }, ctx) => {
    // 校验 openId 格式
    // 校验 chatId 格式
    // 检查 groups 中是否有该 chatId
    // 校验 members.get(chatId).has(openId)
    // 返回 {status: 'matched' | 'not_member' | 'no_match' | 'auth_module_error'}
    // matched 时占用 authorizedSlots + 触发 broadcast
  },
}

// larkbot_resolve_operator
{
  name: "larkbot_resolve_operator",
  label: "解析飞书 user_id",
  description: "把飞书 open_id 解析为稳定 user_id。LRU 缓存（成功 TTL 1h，失败 TTL 30s）。校验 user_id 是否在 OPERATOR_REGISTRY。",
  parameters: Type.Object({
    openId: Type.String({ description: "飞书 open_id" }),
  }),
  execute: async ({ openId }, ctx) => {
    // 调 identity-resolver 逻辑
    // 返回 {operator: 'user_id', name: '...', inRegistry: true} 或 {operator: null, inRegistry: false}
  },
}
```

### 4.6 LLM 决策流（PR-2 后）

```
1. 飞书消息进入 module-level 事件队列
2. LLM 通过 larkbot_fetch_pending_events 拉取
3. LLM 决定"这是鉴权请求"（基于消息内容）
4. LLM 调用 larkbot_list_candidate_groups 拿到 candidates
5. LLM 决策 chatId（基于业务描述 + candidates）
6. LLM 调用 larkbot_authorize_user({openId, chatId})
7. lark-bot 返回 {status: 'matched' | 'not_member' | 'no_match'}
8. matched 时：
   - 占用 authorizedSlots
   - 初始化 task_journal buffer（operator = larkbot_resolve_operator(openId) 的结果）
   - 触发 broadcast(matched)
9. not_member / no_match 时：
   - 触发对应 broadcast
   - 关闭会话（kind=p2p-temp → null）
```

### 4.7 测试覆盖（PR-2）

| 测试类型 | 覆盖点 |
|---------|--------|
| 单元测试 | larkbot_list_candidate_groups 返回 schema |
| 单元测试 | larkbot_authorize_user 四种 status 路径（matched / not_member / no_match / auth_module_error） |
| 单元测试 | larkbot_resolve_operator 缓存 TTL 行为 |
| 集成测试 | LLM 模拟 → candidates → 决策 → authorize → matched broadcast |
| 集成测试 | task_journal buffer 初始化时 operator 校验失败回滚 |
| 回归测试 | substringMatch 调用次数 = 0 |
| 回归测试 | agentMatcher 调用次数 = 0 |

### 4.8 回滚方案（PR-2）

保留 feature flag `larkBot.useAgentMatcher`：

```typescript
const useAgentMatcher = settings.larkBot?.useAgentMatcher !== false; // 默认 true

if (useAgentMatcher) {
  // 新路径：依赖 LLM 调用 larkbot_authorize_user
  // LLM 未调用 → 鉴权失败（no_match）
} else {
  // 旧路径：保留 substringMatch
}
```

回滚步骤：修改 settings.json → `useAgentMatcher: false` → 重启 PI Agent。

## 5. PR-3 详细设计：关闭意图删除

### 5.1 目标

删除 `matchesCloseIntent` 本地正则与 `parseCloseSessionFromText` 文本兜底，依赖 PI Agent emit `close_session` NDJSON 稳定。

### 5.2 删除项

| 类别 | 具体项 |
|------|-------|
| 关闭检测 | `ingress.ts` `matchesCloseIntent` 函数 |
| 关闭检测 | `ingress.ts` `closeSessionFromUserIntent` 调用点 |
| 兜底解析 | `session-manager.ts` `parseCloseSessionFromText` 函数 |
| 兜底解析 | `session-manager.ts` handlePiEvent 中文本兜底分支 |

### 5.3 保留项

| 类别 | 具体项 |
|------|-------|
| 关闭清理 | `session-manager.ts` `cleanupSessionForClose` 六步清单 |
| 关闭清理 | `session-manager.ts` `closeSessionFromAgent`（仅 NDJSON 路径） |
| 关闭清理 | `session-manager.ts` `closeBroadcastHandler`（broadcast ended 触发） |
| 关闭清理 | `task-state-machine.ts` `completeActiveTask` 后清理 |

### 5.4 依赖项

- PI Agent 必须能稳定 emit `close_session` NDJSON（参考 N2 §7.1 不稳定点）
- 若 PI Agent 协议不稳定，PR-3 期间保留 matchesCloseIntent 作为 feature flag（折中方案）

### 5.5 feature flag 折中（PR-3）

保留 `larkBot.useNaturalLanguageClose` 配置：

```typescript
const useNaturalLanguageClose = settings.larkBot?.useNaturalLanguageClose === true; // 默认 false

if (useNaturalLanguageClose) {
  // 旧路径：matchesCloseIntent 兜底
} else {
  // 新路径：仅依赖 PI Agent emit close_session NDJSON
}
```

**说明**：PR-3 默认不启用自然语言兜底；如 PI Agent 协议不稳定，再 feature flag 启用兜底观察。

### 5.6 测试覆盖（PR-3）

| 测试类型 | 覆盖点 |
|---------|--------|
| 单元测试 | matchesCloseIntent 函数不存在（编译时验证） |
| 单元测试 | parseCloseSessionFromText 函数不存在（编译时验证） |
| 集成测试 | LLM emit close_session → cleanupSessionForClose 正确触发 |
| 集成测试 | cleanupSessionForClose 六步清单不变 |
| 集成测试 | close_session 仅走 NDJSON 路径（handlePiEvent case 'close_session'） |
| 回归测试 | matchesCloseIntent 调用次数 = 0 |
| 回归测试 | parseCloseSessionFromText 调用次数 = 0 |

### 5.7 回滚方案（PR-3）

修改 settings.json → `larkBot.useNaturalLanguageClose: true` → 临时恢复本地正则兜底（如果匹配逻辑仍在代码中保留为可选）。

## 6. PR-4 详细设计：任务日志接入

### 6.1 目标

业务私聊开始时累积 task_journal buffer，业务执行中由 `larkbot_record_change` 累积 ChangeEntry；提交时由 `larkbot_commit_changes` 转换 LogEntry 返回给 LLM，会话关闭由 `larkbot_close_business_session` 触发（cleanupSessionForClose 六步 + ended 广播）。

### 6.2 删除项

无（缺失路径补齐）。

### 6.3 保留项

| 类别 | 具体项 |
|------|-------|
| 审计日志 | `shared/logger.ts emitTaskJournal`（审计日志 /tmp/lark-bot-tasks.jsonl） |
| 已实现 schema | `agent-src/scripts/op-log-schema.ts` LogEntry / ChangeEntry / generateLog / formatCommitMessage / parseLogFromMessage |
| 已实现注册表 | `agent-src/scripts/op-log-schema.ts` OPERATOR_REGISTRY |
| 已实现校验 | `agent-src/scripts/validate-op-log.ts`（ops CI 校验脚本） |

### 6.4 新增项

| 类别 | 具体项 |
|------|-------|
| Module-level 状态 | `taskJournals Map<chatId, TaskJournal>`（per-chat 累积） |
| registerTool | `larkbot_record_change` |
| registerTool | `larkbot_commit_changes` |
| registerTool | `larkbot_close_business_session` |
| registerTool | `larkbot_query_journal`（调试用） |
| 转换函数 | `taskJournalToLogEntry`（`larkbot_commit_changes` 内部调用） |

### 6.5 registerTool 契约（PR-4 任务日志）

```typescript
// larkbot_record_change
{
  name: "larkbot_record_change",
  label: "记录业务变更",
  description: "把字段级变更累积到当前 chat 的 task_journal buffer。LLM 在每次业务操作后调用。",
  parameters: Type.Object({
    field: Type.String({ description: "JSONPath-like 字段路径，如 'teams[0].bossHP'" }),
    from: Type.Optional(Type.Unknown({ description: "操作前值（undefined 表示新增）" })),
    to: Type.Optional(Type.Unknown({ description: "操作后值（undefined 表示删除）" })),
  }),
  execute: async ({ field, from, to }, ctx) => {
    // 校验当前 session 已鉴权（kind=p2p-business）
    // 校验当前 session 有 task_journal buffer
    // 追加 ChangeEntry 到 buffer.changes
    // 返回 {ok: true, journalSize: buffer.changes.length}
  },
}

// larkbot_commit_changes
// 注：PR 提交（git commit / push / gh pr create / gh pr merge）由 content-pr skill 完成，
// 不在本 registerTool 职责范围内。本工具只负责"buffer → LogEntry 转换 + 返回 commitMessage"，
// 实际 git 操作由 LLM 拿到 commitMessage 后调用 content-pr skill 完成。
{
  name: "larkbot_commit_changes",
  label: "提交业务变更（生成 commit message）",
  description: "把 task_journal buffer 转换为 LogEntry，生成 commit message 返回给 LLM。LLM 拿到后必须调用 content-pr skill 完成 git 操作（commit / push / PR / merge）。提交成功后 buffer 清空，下一次 commit 重新累积。",
  parameters: Type.Object({
    shortDesc: Type.String({ description: "commit message 第一行简短描述", maxLength: 100 }),
  }),
  execute: async ({ shortDesc }, ctx) => {
    // 1. 校验 task_journal buffer 存在
    // 2. 校验 buffer.changes 非空（fail-closed）
    // 3. 校验 buffer.operator 在 OPERATOR_REGISTRY
    // 4. 转换 buffer → LogEntry（generateLog）
    // 5. 调用 formatCommitMessage(shortDesc, log) 生成 commitMessage
    // 6. 清空 buffer.changes（保留 operator / groupId / matchedBroadcastMessageId 等会话元数据）
    // 7. audit journal 写一条 {state: 'awaiting_review', shortDesc, changesCount}
    // 8. 返回 {logEntry, commitMessage, journalReset: true}
    //    LLM 必须用 commitMessage 调 content-pr skill 提交 PR
    //    若 content-pr skill 失败，LLM 须告知用户；本次 commit 的 LogEntry 已在 audit journal
  },
}

// larkbot_close_business_session
// 注：与会话关闭耦合的事件清理（cleanupSessionForClose 六步 + ended 广播）。
// 不提交 PR（PR 提交由 content-pr skill 独立完成）。
// 不强制 changes 非空（关闭会话与提交 PR 是两个事件，业务会话可"无变更关闭"）。
{
  name: "larkbot_close_business_session",
  label: "关闭业务私聊会话",
  description: "关闭当前业务私聊会话（kind=p2p-business → null），触发 ended 广播，清理 session 与 journal buffer。不提交 PR；如需提交 PR 必须先调用 larkbot_commit_changes。",
  parameters: Type.Object({}),
  execute: async (_params, ctx) => {
    // 1. 校验 session 已鉴权（kind=p2p-business）
    // 2. cleanupSessionForClose 六步清理：
    //    - sessions.delete(chatId)
    //    - sessions.get(chatId).proc?.kill()（no-op，PR-1 后无 proc）
    //    - 清空 activeTask / waitingTasks / pendingResultFetch
    //    - emitTaskJournal({state: 'terminated', reason})
    //    - releaseAuthorizedSlot
    //    - 表情切换 + 飞书回复（已无 activeTask，仅 ended 广播）
    // 3. 触发 broadcast(ended)（replyToMessageId = matched.message_id）
    // 4. 删除 task_journal buffer（无论是否已提交，本次会话的 LogEntry 保留在 audit journal）
    // 5. 返回 {status: 'closed', broadcastMessageId}
  },
}

// larkbot_query_journal（调试用）
{
  name: "larkbot_query_journal",
  label: "查询当前 task_journal",
  description: "查询当前 chat 的 task_journal buffer 状态。调试用，不参与业务流程。",
  parameters: Type.Object({}),
  execute: async (_params, ctx) => {
    // 返回 {journaledAt, changes, subject, entity} 或 {empty: true}
  },
}
```

### 6.6 buffer 初始化时机

```
鉴权 matched 时（PR-2 完成后）：
  → 调用 larkbot_resolve_operator(openId) 获取 user_id
  → 校验 isOperatorAllowed(user_id) 为 true（fail-closed）
  → 创建 TaskJournal：
      {
        operator: user_id,
        operatorName: registry[user_id].name,
        sessionStartedAt: new Date().toISOString(),
        groupId, groupName, matchedBroadcastMessageId,
        subject: null,
        entity: null,
        changes: [],
        promptId: <当前消息 promptId>,
      }
  → 存入 taskJournals.set(chatId, journal)
```

### 6.7 LLM 业务流（PR-4 后，按用户场景拆分）

业务私聊生命周期与 PR 提交是**两个紧密关联但独立**的事件。LLM 根据用户输入决定调用哪些 registerTool：

#### 场景 A：提交 PR（不关闭会话）

```
1. LLM 决定"用户想提交当前业务变更"
2. LLM 调 larkbot_commit_changes({shortDesc})
3. lark-bot 校验 buffer.changes 非空 + operator 在注册表
4. lark-bot 生成 commitMessage + 清空 buffer.changes
5. lark-bot 返回 {logEntry, commitMessage, journalReset: true}
6. LLM 拿到 commitMessage，调 content-pr skill 完成：
   - git checkout -b content/<操作>-<目标>
   - git commit -m commitMessage
   - git push
   - gh pr create --base main
   - 等待用户回复"合并"
   - gh pr merge --squash --delete-branch
7. 会话保持 kind=p2p-business；后续业务变更继续累积到 buffer
```

#### 场景 B：结束任务（不提交 PR）

```
1. LLM 决定"用户想结束当前会话"
2. LLM 调 larkbot_close_business_session
3. lark-bot 走 cleanupSessionForClose 六步 + 结束广播
4. lark-bot 删除 task_journal buffer（未提交的 changes 丢失，audit journal 写 terminated）
5. lark-bot 返回 {status: 'closed', broadcastMessageId}
6. LLM 调 feishu_send_reply 回复用户"任务已结束"
```

#### 场景 C：提交并结束（连续调用）

```
1. LLM 决定"用户想提交 PR 后结束会话"
2. LLM 先调 larkbot_commit_changes（场景 A 步骤 2-5）
3. LLM 调 content-pr skill 完成 git 操作
4. LLM 再调 larkbot_close_business_session（场景 B 步骤 2-5）
```

#### 场景 D：无变更提交

```
1. LLM 决定"用户想提交 PR"
2. LLM 调 larkbot_commit_changes
3. lark-bot 校验 buffer.changes 为空 → 拒绝，返回 {error: 'changes 空，无法提交'}
4. LLM 向用户回复"本次会话无业务变更，无需提交 PR"
5. LLM 可继续业务操作或调 larkbot_close_business_session 结束会话
```

#### 关键约束

- `larkbot_commit_changes` 与 `larkbot_close_business_session` **不联动**——LLM 决策何时调用
- 实际 git 操作（commit / push / gh pr create / merge）由 content-pr skill 完成（不是 lark-bot 职责）
- 一次业务私聊会话**支持多次 PR 提交**——每次 `larkbot_commit_changes` 后 buffer.changes 清空，下次累积重新开始
- 业务私聊会话关闭时未提交的 changes **丢失**（记 audit journal terminated），不影响已提交的 LogEntry（已在 git history）

### 6.8 双写策略

`task_journal` 与 `audit journal` 是两个不同对象：

| 对象 | 用途 | 持久化 |
|------|------|--------|
| task_journal buffer | 业务私聊会话内的累积（per-chat_id，内存） | module-level Map<chatId, TaskJournal> |
| TaskJournalEntry / audit journal | 会话状态跃迁审计（开发排障） | /tmp/lark-bot-tasks.jsonl |
| LogEntry / commit message | 业务留痕（嵌入 commit message） | git history（永久） |

lark-bot 负责的双写时机：

```
larkbot_commit_changes 时：
  1. buffer → LogEntry 转换
  2. emitTaskJournal 写 audit journal 一条：
     {state: 'awaiting_review', shortDesc, changesCount}
  3. LogEntry + commitMessage 返回 LLM
  4. LLM 调 content-pr skill 提交 commit message

larkbot_close_business_session 时：
  1. cleanupSessionForClose 六步
  2. emitTaskJournal 写 audit journal 一条：
     {state: 'terminated', reason}
  3. 删除 buffer
  4. 触发 ended 广播
```

不属于 lark-bot 范畴：

- PR 合入 / 拒绝后 audit journal 更新——content-pr skill / ops CI 职责
- commit message 嵌入 git——content-pr skill 职责
- gh pr view / merge / 合并循环——content-pr skill 职责

### 6.9 测试覆盖（PR-4）

| 测试类型 | 覆盖点 |
|---------|--------|
| 单元测试 | `taskJournalToLogEntry` 转换正确性 |
| 单元测试 | `larkbot_commit_changes` 拒绝 changes 空 |
| 单元测试 | buffer 启动时 operator 校验失败立即清理 |
| 单元测试 | `larkbot_record_change` 字段路径非法处理 |
| 集成测试 | `larkbot_commit_changes` → audit journal 双写 |
| 集成测试 | `larkbot_commit_changes` → LLM 拿到 commitMessage → content-pr skill 提交成功 |
| 集成测试 | business 超时 / 强制关闭 → buffer 丢弃（不转换 LogEntry） |
| 集成测试 | OPERATOR_REGISTRY 校验失败回滚 |

### 6.10 回滚方案（PR-4）

PR-4 是缺失路径补齐，无"旧路径"可回滚。如有问题需修复 bug 或 feature flag 关闭（如 `larkBot.enableTaskJournal: false` 或 `larkBot.commitOnClose: false`）。

## 7. 跨 PR 兼容性策略

### 7.1 向后兼容窗口

每 PR 合并后保留 1 周观察期：

- 监控 registerTool 调用次数、错误率、延迟
- 监控 lark-bot 进程崩溃次数（应为 0）
- 监控业务私聊完成率

### 7.2 feature flag 总表

| feature flag | PR | 默认值 | 说明 |
|--------------|-----|--------|------|
| `larkBot.useExtensionMode` | PR-1 | false | 是否启用 extension 化 registerTool 集合（**spawn per-chat PI Agent 进程始终保留**） |
| `larkBot.useAgentMatcher` | PR-2 | true | 是否依赖 LLM 决策（vs substringMatch） |
| `larkBot.useNaturalLanguageClose` | PR-3 | false | 是否启用自然语言兜底（vs 仅 NDJSON） |
| `larkBot.enableTaskJournal` | PR-4 | true | 是否启用 task_journal buffer（缺失路径补齐） |
| `larkBot.commitOnClose` | PR-4 | false | 关闭会话时是否自动调 `larkbot_commit_changes`（默认 false = 强制 LLM 手动决策） |

### 7.3 settings.json 迁移

新增 settings.json 示例：

```json
{
  "larkBot": {
    "useExtensionMode": true,
    "useAgentMatcher": true,
    "useNaturalLanguageClose": false,
    "enableTaskJournal": true
  }
}
```

向后兼容：缺失字段时使用默认值。

## 8. 回滚方案汇总

| PR | feature flag | 回滚步骤 | 回滚时间 |
|----|--------------|---------|---------|
| PR-1 | `larkBot.useExtensionMode` | settings.json → false → 重启 | < 5 分钟 |
| PR-2 | `larkBot.useAgentMatcher` | settings.json → false → 重启 | < 5 分钟 |
| PR-3 | `larkBot.useNaturalLanguageClose` | settings.json → true → 重启 | < 5 分钟 |
| PR-4 | `larkBot.enableTaskJournal` / `larkBot.commitOnClose` | settings.json → false → 重启 | < 5 分钟 |

**回滚成本**：每 PR 独立可回滚，最大回滚粒度 = 单 PR。

## 9. 测试覆盖要求汇总

### 9.1 每 PR 必测项

| 维度 | 要求 |
|------|------|
| 单元测试覆盖率 | registerTool execute 路径覆盖率 ≥ 80% |
| 集成测试 | 端到端业务流：飞书消息 → LLM 决策 → registerTool 调用 → 飞书回复 |
| 回归测试 | 删除项调用次数 = 0（substringMatch / matchesCloseIntent / parseCloseSessionFromText） |
| 性能测试 | registerTool 调用延迟 < 500ms（不含 lark-cli spawn） |
| 并发测试 | 多 session 并发 registerTool 调用无状态冲突 |

### 9.2 测试基础设施

- vitest 现有 195 测试 + 重构期间新增测试必须全过（issue #168 验收标准）
- typecheck 干净
- lark-cli spawn 仍需 mock（PR-1 保留）

## 10. 风险与缓解（继承 N3 §7 + 新增）

| 风险 | 来源 | 缓解 |
|------|------|------|
| PI Agent session 生命周期 | N3 §7.1 | pi.on('session_shutdown') 清理 module-level 状态 |
| registerTool 并发安全 | N3 §7.2 | per-chat_id lock（Promise 链式 serialize） |
| 飞书 WS → registerTool 桥接 | N3 §7.3 | module-level 事件队列 + larkbot_fetch_pending_events |
| LLM 调用成本 | N3 §7.4 | registerTool description 精炼 |
| OPERATOR_REGISTRY 注入 | N3 §7.5 | MVP 阶段 2 项，不需注入；按需 registerTool 查询 |
| ctx.ui 不支持飞书 | N3 §7.6 | 不使用 ctx.ui |
| 测试基础设施 | N3 §7.7 | registerTool 纯函数化便于单测 |
| **新增：跨 PR 合并冲突** | PR-2/3/4 并行 | 建议串行 PR-1 → PR-2 → PR-3 → PR-4 |
| **新增：feature flag 累积** | 每 PR 一个 flag | 5 个 flag 是 MVP 上限；后续需整合为统一开关 |
| **新增：PI Agent 协议不稳定** | PR-3 删除兜底依赖 NDJSON 稳定 | feature flag 临时启用 matchesCloseIntent 兜底 |
| **新增：OPERATOR_REGISTRY 解析失败** | PR-4 buffer 启动时 fail-closed | 鉴权回滚 + ERROR 提示 |

## 11. 不应预设的项

- registerTool execute 内部实现的并发控制方式（per-chat lock vs 全局 lock）
- module-level 状态的持久化策略（lark-bot 重启后是否保留 sessions Map）
- registerTool 执行超时上限（建议 5s/30s 两档，待 PR-1 decide）
- registerTool 失败重试策略（是否由 LLM 决策 vs lark-bot 自动重试）
- PI Agent 协议升级时间表（不可控）
- ctx.ui 是否使用（决定不使用）

## 12. 与 issue #168 其他节点的关系

| 节点 | 关系 |
|------|------|
| N1 业务流图 | 本节点 §3-§6 的 PR-1 ~ PR-4 是 N1 §3 sequenceDiagram 中各步骤的落地路径 |
| N2 PI Agent 契约盘点 | 本节点 §3.7 飞书 WS 桥接方案 + §4.5 registerTool 契约吸收 N2 §9 协议扩展点 |
| N3 spawn vs extension | 本节点 §3 PR-1 + §3.5 extension 骨架 + §3.6 registerTool 契约是 N3 §5 映射的工程化落地 |
| N5 任务日志 schema | 本节点 §6 PR-4 + §6.5 registerTool 契约是 N5 §2 TaskJournal + §4 转换规则的落地 |
| N6 第一阶段汇总 | 本节点是 N6 的组成部分之一 |

## 13. 引用

- `docs/lark-bot-business-flow.md`（N1）— 业务流图
- `docs/lark-bot-pi-agent-contract.md`（N2）— PI Agent 契约盘点与不稳定点清单
- `docs/lark-bot-extension-migration-analysis.md`（N3）— spawn vs extension 对比
- `docs/lark-bot-task-journal-schema.md`（N5）— 任务日志对象 schema
- `agent-src/.pi/extensions/lark-bot/index.ts` — 现有 PI Agent extension 入口
- `agent-src/.pi/scripts/lark-bot/main.ts` — lark-bot 主进程装配点
- `agent-src/.pi/scripts/lark-bot/process.ts` — 进程级防护（PR-1 删除）
- `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` — PI Agent 子进程管理（PR-1 大幅缩减）
- `agent-src/.pi/scripts/lark-bot/interactive/task-state-machine.ts` — 任务状态机（PR-3 简化）
- `agent-src/.pi/scripts/lark-bot/ingress.ts` — 飞书事件入口
- `agent-src/.pi/scripts/lark-bot/business/auth.ts` — 鉴权判定（PR-2 删除 substringMatch）
- `agent-src/.pi/scripts/lark-bot/business/broadcast.ts` — 工作留痕广播
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 适配
- `agent-src/.pi/scripts/lark-bot/identity-resolver.ts` — open_id → user_id（PR-2 激活）
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书协议 I/O
- `agent-src/.pi/scripts/lark-bot/shared/types.ts` — 类型定义
- `agent-src/.pi/scripts/lark-bot/shared/logger.ts` — 日志门面
- `agent-src/.pi/scripts/lark-bot/config.ts` — 配置常量（PR-1 大幅缩减）
- `agent-src/scripts/op-log-schema.ts` — OPERATOR_LOG 模块
- `agent-src/scripts/validate-op-log.ts` — ops CI 校验脚本
- `.pi/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — ExtensionAPI / ToolDefinition / ExtensionContext 完整定义
