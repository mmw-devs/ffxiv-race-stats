# spawn 模式 vs 标准 extension 模式对比（issue #168 第一阶段 N3）

> lark-bot 现有"双重架构"与 PI Agent 标准 extension 模式的差异对比与迁移路径评估。
> 范围：issue #168 第一阶段第 5 项明确要求的产出物。
> 不在范围：渐进迁移的 PR 拆分细节（见 N4）、PI Agent 上游契约盘点（见 N2）。

## 0. 阅读对象与范围

- 阅读对象：lark-bot 维护者、PI Agent 协议设计者、issue #168 重构方案设计者。
- 范围：lark-bot 的进程拓扑、通信协议、状态管理、工具注册面差异。
- 不在范围：业务语义判断的差异（鉴权匹配 / 关闭意图）已在 N2 列出不稳定点；registerTool 契约设计见 N4。

## 1. PI Agent 标准 extension 模式（API 实测）

来自 `.pi/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`：

```typescript
export interface ExtensionAPI {
  // 事件订阅（生命周期）
  on(event: "session_start" | "session_shutdown" | "tool_call" |
     "project_trust" | "session_compact" | "resources_discover" | ...,
     handler: ExtensionHandler<E>): void;

  // 工具注册（供 LLM 调用）
  registerTool<TParams, TDetails, TState>(
    tool: ToolDefinition<TParams, TDetails, TState>
  ): void;

  // 命令注册 / 快捷键 / provider / formatter / accessor
  registerCommand(name, options): void;
  registerShortcut(keyId, options): void;
  registerProvider(...): void;
}

interface ToolDefinition<TParams, TDetails, TState> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;  // TypeBox schema
  execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext)
    : Promise<AgentToolResult<TDetails>>;
  renderCall? / renderResult? / promptSnippet? / promptGuidelines?;
}

interface ExtensionContext {
  ui: ExtensionUIContext;   // terminal UI（select / confirm / input / notify / setStatus）
  mode: ExtensionMode;       // "tui" | "rpc" | "json" | "print"
  cwd: string;
  // ...session 上下文
}

interface ExtensionUIContext {
  select(title, options): Promise<string | undefined>;
  confirm(title, message): Promise<boolean>;
  input(title, placeholder?): Promise<string | undefined>;
  notify(message, type?): void;
  setStatus(key, text): void;
  // ...仅 terminal UI 方法
}
```

**关键约束**：

| 能力 | PI Agent 提供 | lark-bot 需求 |
|------|-------------|--------------|
| 工具供 LLM 调用 | `registerTool` | 是（核心） |
| 生命周期钩子 | `pi.on('session_start' / 'session_shutdown')` | 是 |
| 用户交互 | `ExtensionUIContext`（仅 terminal） | **否**（飞书私聊是外部通道） |
| 飞书 WS 事件接收 | **否**（无 API） | 是（必须保留 lark-cli 子进程） |
| 跨 extension 通信 | `Symbol.for()` 服务访问器 | 可选 |
| 进程级防护 | 无 | 改由 systemd / pm2 兜底 |

**关键发现**：

- 飞书 WS 事件接收**必须**通过 spawn lark-cli 子进程（PI Agent 无飞书通道 API）
- 飞书消息 → lark-bot 的事件流仍保留 stdin/stdout NDJSON（lark-cli event consume）
- **lark-cli 子进程层无法消除**；**PI Agent 子进程层可消除**（与 extension host 合一）

## 2. lark-bot 现有"双重架构"

### 2.1 进程拓扑（实际是三层）

```
PI Agent (extension host)
  └─ spawn 1: tsx .pi/scripts/lark-bot/main.ts  ← lark-bot 主进程
                ├─ spawn 2a-N: lark-cli event consume <EventKey>  ← 飞书 WS 事件
                ├─ spawn 3: PI Agent (pi --mode rpc --session-dir ...)  ← PI Agent 子进程
                ├─ spawn 4: lark-cli im reactions / messages / chats  ← 飞书 API
                └─ spawn 5: lark-cli contact +get-user  ← identity-resolver
```

### 2.2 stdin/stdout NDJSON 协议（私有）

| 通道 | 方向 | 内容 |
|------|------|------|
| lark-bot stdin | lark-bot → lark-bot（自身） | shutdown IPC |
| lark-bot → PI Agent 子进程 stdin | 喂 prompt | `{type:'prompt' / 'get_state' / 'get_last_assistant_text'}` |
| PI Agent 子进程 stdout → lark-bot | NDJSON 事件 | `{type:'response' / 'agent_settled' / 'task_log' / 'close_session'}` |
| lark-cli WS stdout | NDJSON 飞书事件 | `{type:'im.message.receive_v1' / 'im.chat.member.*' / ...}` |

### 2.3 历史选择

`extensions/lark-bot/index.ts` 顶部注释：

```typescript
/**
 * lark-bot extension — 按需启停 lark-bot
 * 默认不自动启动。需在 settings.json 中设置 larkBot.autoStart = true ...
 */
```

extension 本体只做"何时启停 lark-bot 进程"，**不做任何业务逻辑**——业务逻辑全部在 `tsx .pi/scripts/lark-bot/main.ts` 独立进程中。

### 2.4 双重架构的代价

| 代价 | 来源 |
|------|------|
| 进程隔离复杂度 | PID 文件 / 双层看门狗 / 双层 restart storm / 5s 重试 |
| 私有协议维护 | lark-bot 与 PI Agent 子进程的 NDJSON 协议是 lark-bot 私有约定 |
| 上下文丢失 | spawn 子进程的 PI Agent 与 extension host 进程环境隔离（cwd / env） |
| 协议不稳定 | close_session 三处散落、stdout NDJSON 不稳定（详见 N2 §7） |
| 本地兜底累积 | matchesCloseIntent / parseCloseSessionFromText（补偿 PI Agent 看不到协议） |
| 测试复杂 | spawn 子进程在测试沙箱下不可靠，必须 mock + spy + 直接调入口函数 |

## 3. 架构差异对比表

| 维度 | 现有双重架构 | 标准 extension 模式 | 收益 / 代价 |
|------|------------|------------------|-----------|
| 进程数 | 1 lark-bot + N PI Agent + N lark-cli | 0 lark-bot + 0 PI Agent 子进程 + N lark-cli | 减少 N 个 PI Agent 子进程 |
| 通信协议 | stdin/stdout NDJSON（私有） | 函数调用（execute 异步） | 消除私有协议维护 |
| 状态管理 | 全局 Map + 文件 | ExtensionContext + module-level state | 上下文隔离更清晰 |
| 重启管理 | 双层 restart storm + PID 看门狗 | PI Agent session 生命周期托管 | 消除 L5 进程级防护 |
| 上下文注入 | prompt header + SKILL.md inline | registerTool 返回值 + promptSnippet/promptGuidelines | PI Agent 真正"看到"协议 |
| 业务语义 | lark-bot 本地（substringMatch / matchesCloseIntent） | PI Agent LLM 决策（registerTool 调用） | SSOT 业务总线 |
| 飞书 WS 接收 | lark-cli spawn 子进程 | **同左**（PI Agent 无飞书通道 API） | 必须保留 |
| 飞书 API 调用 | lark-cli spawn | registerTool 内部仍调 lark-cli（协议层） | 必须保留 |
| 进程防护 | process.ts PID / 看门狗 / 双层 restart storm | 由 PI Agent session 生命周期托管 | 消除 L5（systemd 兜底） |
| 测试性 | 子进程 spawn mock 复杂 | ExtensionContext 注入 + 纯函数 registerTool | 测试简化 |
| ctx.ui 用户交互 | 无（飞书通道独立） | ExtensionUIContext（仅 terminal） | **不适用**（飞书是外部通道） |

## 4. 标准 extension 模式的关键约束

### 4.1 协议契约约束

- registerTool 必须有 TypeBox `parameters` schema
- execute 函数签名固定：`execute(toolCallId, params, signal, onUpdate, ctx)`
- 必须处理 AbortSignal（用户取消 / 超时）
- 返回 `AgentToolResult<TDetails>` 结构

### 4.2 上下文注入约束

- 不再"prompt 全文 inline SKILL.md"——可通过 `promptSnippet` / `promptGuidelines` 注入工具说明
- LLM 看到的是工具描述（description / promptSnippet），不是 SKILL.md 全文
- 需要重新设计 SKILL.md 内容：**只描述协议不变量**，不重复协议事件 schema

### 4.3 状态管理约束

- ExtensionContext 是 per-session 的，不能跨 session 共享
- module-level 状态（lark-bot 启动期初始化的群组缓存）OK
- per-session 状态（PiSession / task_journal）必须放 module-level Map<chat_id, ...>
- 不持有全局可变状态的反模式在 README §2 已声明

### 4.4 并发约束

- PI Agent 支持多 session 并发（每个 PI Agent session 独立 ExtensionContext）
- registerTool execute 是 Promise，可被 LLM 并发调用
- 必须保证 registerTool 内对 module-level 状态的访问是并发安全的

## 5. lark-bot 现有能力 → registerTool 映射

### 5.1 飞书协议 I/O（保留为 registerTool）

| 现有实现 | 新 registerTool | 持久层 |
|---------|----------------|--------|
| `protocol/feishu.ts addReaction / delReaction` | `feishu_add_reaction(msgId, emoji)` / `feishu_remove_reaction(msgId, reactionId)` | lark-cli `im reactions` |
| `protocol/feishu.ts sendReply / sendReplyGetId` | `feishu_send_reply(msgId, text)` | lark-cli `im +messages-reply` |
| `protocol/feishu.ts startLarkEvents` | **保留 spawn**（PI Agent 无飞书 WS API） | lark-cli `event consume` |
| `protocol/feishu.ts circuitBreaker` | module-level state | 无 lark-cli 调用 |
| `broadcast/group-tool.ts getGroupInfo` | `feishu_get_group_info(chatId)` | lark-cli `im chats get` |
| `broadcast/group-tool.ts listGroupMembers` | `feishu_list_group_members(chatId)` | lark-cli `im +chat-members-list` |
| `broadcast/group-tool.ts sendGroupMessage` | `feishu_send_group_message(chatId, text, mention, replyTo)` | lark-cli `im +messages-send` / `+messages-reply` |
| `broadcast/group-tool.ts listAllBotGroups` | `feishu_list_bot_groups()` | lark-cli `im +chat-list` |

### 5.2 业务语义（迁 PI Agent LLM 决策）

| 现有实现 | 新机制 | 备注 |
|---------|--------|------|
| `business/auth.ts authorize / substringMatch` | **删除**（由 LLM 决策） | 决策 4：PI Agent 拿到 candidates 后决策 |
| `business/auth.ts 成员资格校验` | `larkbot_authorize_user({openId, chatId})` | 保留为协议层（lark-cli 调） |
| `business/auth.ts agentMatcher 钩子` | **删除**（由 LLM 决策） | 不再需要 |
| `business/broadcast.ts announce` | **保留为 internal helper**（`larkbot_broadcast_to_group`） | 模板渲染 + 飞书消息发送；触发场景为 `larkbot_authorize_user` 鉴权结果的 matched/not_member 公告与 `larkbot_close_business_session` 的 ended 广播。不作为独立 registerTool 暴露给 LLM，仅作为 registerTool 内部副作用调用。 |
| `ingress.ts matchesCloseIntent` | **删除**（依赖 PI Agent emit close_session） | 决策 5 |
| `session-manager.ts parseCloseSessionFromText` | **删除**（NDJSON 协议稳定后不需要） | 决策 5 |
| `task-state-machine.ts promoteNext / handleTaskLog` | **删除**（由 LLM 决策） | 决策 5 |
| `identity-resolver.ts resolveOperator` | `larkbot_resolve_operator(openId)` | 协议层（lark-cli 调）+ OPERATOR_REGISTRY 校验 |

### 5.3 进程管理（迁移后大幅缩减）

| 现有实现 | 新机制 | 备注 |
|---------|--------|------|
| `process.ts checkRestartStorm` | **删除**（PI Agent 自身管理） | system 仍可由 systemd 监督 |
| `process.ts startWatchdog` | **删除** | |
| `process.ts PID 文件` | **删除** | |
| `process.ts 信号处理` | 简化（lark-bot extension 自身处理） | |
| `process.ts installStdinShutdown` | **删除** | |
| `process.ts startHeartbeat` | **删除** | 由 PI Agent 日志托管 |
| `session-manager.ts spawnPiProcess` | **精简优化**（每 chat spawn 基础设施精简） | 方案 G 保留 per-chat spawn |
| `session-manager.ts piRestartState` | **精简优化**（精简为合理的 restart 防护） | 方案 G 保留 |
| `config.ts restart history 文件` | **删除** | |
| `config.ts HEAP_PRESSURE_MB / HEAP_HARD_LIMIT_MB` | **删除** | |

### 5.4 状态保留

| 现有实现 | 新机制 | 备注 |
|---------|--------|------|
| `auth.ts groups / members Map` | module-level Map<chatId, GroupInfo> / Map<chatId, Set<openId>> | 启动期冷启动 + EventKey 增量更新 |
| `session-manager.ts sessions Map` | module-level Map<chatId, PiSession> | per-chat_id 业务状态 |
| `task_journal buffer` (N5) | module-level Map<chatId, TaskJournal> | per-chat_id 业务状态 |
| `protocol/feishu.ts circuitBreaker` | module-level state | |
| `identity-resolver.ts cache` | module-level state | 成功 TTL 1h / 失败 TTL 30s |

## 6. 迁移路径评估

### 6.1 路 A：完全迁移（一次性重写）

**收益**：
- 一次到位，无中间态
- 文档与代码同步

**风险**：
- 风险集中在一两个 PR
- 现有私聊业务中断（鉴权 / 工作留痕 / 表情协议）
- registerTool API 实际行为与 issue #168 描述可能不符（已实测修正）
- LLM 调用 registerTool 的延迟 / 成本未实测

**评估**：不推荐。

### 6.2 路 B：保留双重架构（仅优化内部协议）

**收益**：
- 风险最小（不破坏现有稳定运行）
- 内部 NDJSON 协议可优化

**风险**：
- 治标不治本（issue #168 第一阶段已判定）
- 三处散落兜底、SKILL.md 全文 inline 等根问题无法解决
- 双层 restart storm 等运维复杂度无法消除

**评估**：不推荐（issue #168 第一阶段已否定）。

### 6.3 路 C：渐进迁移（PR-1 切换 + 逐步替换）

**收益**：
- 每 PR 解决一个问题，回滚粒度细
- 与 MVP 演进节奏一致（PR #159 / #161 / #163 都是渐进）
- 关键决策可在 PR review 中调整

**风险**：
- 中间态：新旧路径并存期间代码复杂度上升
- PR 间需保持向后兼容

**评估**：**推荐**（决策 1 已选定）。

### 6.4 路 C 详细拆分

| PR | 内容 | 删除 | 保留 |
|----|------|------|------|
| PR-1 | **优化 spawn 基础设施**（**不消除 spawn**）+ extension 化 registerTool | spawn NDJSON / process.ts 重启风暴 / spawnPromises / 配置相关常量 | 飞书 lark-cli spawn 子进程 / per-chat spawn `pi --session-dir <chatId>` / module-level 状态 / registerTool 飞书 I/O / auth.ts / business/broadcast.ts / ingress.ts 入口 |
| PR-2 | 鉴权判定迁 LLM | auth.ts substringMatch / agentMatcher 钩子 | larkbot_list_candidate_groups + larkbot_authorize_user（成员资格校验） |
| PR-3 | 关闭意图删除本地正则 | matchesCloseIntent / parseCloseSessionFromText | 依赖 PI Agent emit close_session NDJSON |
| PR-4 | 任务日志对象接入 OPERATOR_LOG | 无（缺失路径补齐） | larkbot_record_change + larkbot_commit_changes + larkbot_close_business_session + larkbot_query_journal + task_journal buffer + LogEntry 转换 |

**每 PR 的可观察性**：

- PR-1：进程数 N+2 → N+2（**不变**，方案 G 保留 per-chat spawn）；spawn `pi --mode rpc` 调用次数 = N（每 chat 一次）；spawnNDJSON 通信去除（改为 module-level 事件队列 + registerTool 拉取）
- PR-2：substringMatch 调用次数 = 0；agentMatcher 钩子类型声明删除
- PR-3：matchesCloseIntent 调用次数 = 0；parseCloseSessionFromText 调用次数 = 0；close_session 路径数 = 1（仅 NDJSON）
- PR-4：task_journal buffer 命中次数；LogEntry 嵌入 commit message 次数

## 7. 迁移风险与缓解

### 7.1 PI Agent session 生命周期

**风险**：PI Agent 何时销毁 session？session 销毁时 PiSession 状态如何清理？

**缓解**：
- `pi.on('session_shutdown', handler)` 钩子清理 module-level 状态
- module-level Map<chatId, PiSession> 在 session_shutdown 时遍历清理
- task_journal buffer 同步清理（不转换 LogEntry = 丢弃）

### 7.2 registerTool 并发安全

**风险**：LLM 并发调用 registerTool 时，多个 prompt 同时改 task_journal buffer 会冲突。

**缓解**：
- per-chat_id lock（Promise 链式 serialize）
- LLM 调用 registerTool 本质是顺序的（同一 chat_id 的 LLM 调用是同一 session）
- module-level Map 原子性靠 V8 单线程保证

### 7.3 飞书 WS 事件 → registerTool 调用的桥接

**风险**：registerTool 是 LLM 触发的，飞书 WS 事件是被动接收的，两者如何桥接？

**方案**：
- 飞书 WS 事件仍走 lark-cli event consume spawn 子进程（保留）
- 事件接收在 module-level 异步队列
- 事件触发时：若对应 chat_id 已有 active session → 把事件作为 LLM 上下文注入；若无 → 触发鉴权流程（registerTool larkbot_authorize_user）
- 注：这不是 registerTool 的标准用法，是 lark-bot extension 特有的"事件 → 业务总线"桥接

### 7.4 LLM 调用 registerTool 的成本

**风险**：每次鉴权 / 业务指令都要 LLM 决策，token 成本和延迟增加。

**缓解**：
- registerTool description 精炼（避免冗余 schema）
- LLM 决策仅在关键决策点（鉴权 / 关闭意图 / 业务指令分发）
- 简单操作（如查群组列表）由 LLM 直接调用 registerTool，不经决策

### 7.5 OPERATOR_REGISTRY 注入到 LLM 上下文

**风险**：OPERATOR_REGISTRY 体积可能膨胀。

**缓解**：
- MVP 阶段注册表仅 2 项（weunimix / 赤墓）
- 未来扩展时改为 registerTool `larkbot_list_operators()` 按需查询

### 7.6 ctx.ui 不支持飞书通道

**风险**：ExtensionUIContext 是 terminal UI，飞书是外部通道。

**缓解**：
- 不使用 ctx.ui（直接用 registerTool 内部 lark-cli 调飞书 API）
- 飞书回复由 registerTool 返回值隐式表达（LLM 决策后调用 feishu_send_reply）

### 7.7 测试基础设施

**风险**：现有测试 mock 子进程 spawn 复杂，新架构下需重写。

**缓解**：
- registerTool 纯函数化便于单测
- ExtensionContext 注入便于集成测试
- lark-cli spawn 仍需 mock（保留测试挑战）

## 8. 不应预设的项

（与 issue #168 §"不应预设"对齐）

- 具体模块名 / 文件路径 / API 签名：待 PR-1 设计
- 行数限制 / 函数长度限制：不设
- 是否引入新设计模式（facade / adapter / middleware）：待 PR-1 decide
- 是否在 PR-1 中一并处理 process.ts 全部删除：可能部分保留作为 systemd 兜底
- ctx.ui 是否使用：决定不使用（飞书通道独立）
- lark-cli spawn 层的封装方式：待 PR-1 设计

## 9. 与 issue #168 其他节点的关系

| 节点 | 关系 |
|------|------|
| N1 业务流图 | 本节点 §3 表格第 3 列的"标准 extension 模式"是 N1 §3 sequenceDiagram 中 PI Agent 节点的目标形态 |
| N2 PI Agent 契约盘点 | 本节点 §4 协议契约约束 + §7.3 飞书 WS 桥接方案是 N2 §9 协议扩展点的输入 |
| N4 渐进迁移路线图 | 本节点 §6.4 PR 拆分是 N4 registerTool 契约设计的入口 |
| N5 任务日志 schema | 本节点 §5.4 task_journal buffer 保留为 module-level state，与 N5 §2 TaskJournal 对齐 |
| N6 第一阶段汇总 | 本节点是 N6 的组成部分之一 |

## 10. 引用

- `.pi/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — ExtensionAPI / ToolDefinition / ExtensionContext / ExtensionUIContext / 事件类型完整定义
- `.pi/npm/node_modules/@earendil-works/pi-coding-agent/README.md` — Extension API 使用示例
- `package/docs/cross-extension-api.md` — 跨 extension 通信（Symbol.for() 服务访问器）
- `agent-src/.pi/extensions/lark-bot/index.ts` — 现有 PI Agent extension 入口（spawn lark-bot 进程）
- `agent-src/.pi/scripts/lark-bot/main.ts` — lark-bot 主进程装配点
- `agent-src/.pi/scripts/lark-bot/process.ts` — 进程级防护（L5 层）
- `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` — PI Agent 子进程管理 + NDJSON 处理
- `agent-src/.pi/scripts/lark-bot/interactive/task-state-machine.ts` — 任务状态机
- `agent-src/.pi/scripts/lark-bot/ingress.ts` — 飞书事件入口
- `agent-src/.pi/scripts/lark-bot/business/auth.ts` — 鉴权判定
- `agent-src/.pi/scripts/lark-bot/business/broadcast.ts` — 工作留痕广播
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 适配
- `agent-src/.pi/scripts/lark-bot/identity-resolver.ts` — open_id → user_id 解析
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书协议 I/O
- `docs/lark-bot-business-flow.md`（N1）
- `docs/lark-bot-pi-agent-contract.md`（N2）
- `docs/lark-bot-task-journal-schema.md`（N5）
