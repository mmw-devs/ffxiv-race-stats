---
name: lark-bot-protocol
description: >
  lark-bot 任务日志上报协议 + PR-1 registerTool 桥接契约。通过 lark-bot 私聊处理业务任务时，向 stdout 输出 task_log 事件上报业务主题；处理飞书交互时调用 7 个 PR-1 registerTool（feishu_* 全部）。涵盖上报时机、JSON 格式、promptId 读取、subject 写法、registerTool 调用契约。
compatibility: 依赖 lark-bot 私聊接入；要求 prompt header 含 promptId；PR-1 registerTool 要求 settings.json 设置 larkBot.useExtensionMode=true（旧路径下不可用）。
---

# lark-bot-protocol

## 0. 何时加载

满足以下任一条件即加载本 skill：

1. 当前 prompt 是 lark-bot 通过私聊发来的业务任务，且 prompt header 包含 `promptId=...`（即走 stdin/stdout NDJSON 协议）
2. 处理飞书交互（发回复 / 加表情 / 查群组 / 收消息）时——应优先调用 PR-1 暴露的 8 个 registerTool

## 1. 任务日志上报（task_log 协议）

### 1.1 上报时机

- 理解任务主题后 → emit 一次
- 用户修订意图后主题变化 → 再次 emit
- 同一主题不重复 emit

### 1.2 格式

向 stdout 输出（一行 JSON，lark-bot 自动接收）：

```json
{"type":"task_log","promptId":"<promptId>","subject":"<业务主题>"}
```

`promptId` 从 prompt header 读取，格式如 `f-1-a1b2c3d4`。

### 1.3 subject 写法

自由文本，"做什么 + 改什么"，便于 grep 反查：

- ✅ `更新 t1 bossHP 15.0 → 12.5`
- ✅ `添加新队伍 BACKSTAGE`
- ❌ `更新数据`（太抽象）

## 2. 关闭会话

当用户表示"结束任务"、"done"、"再见"等意图时，向 stdout 输出一行 JSON：

{"type":"close_session","reason":"<可选原因>"}

`reason` 可选。reason 为业务上下文（如 "user_said_done"）。

这条 JSON 必须直接输出到 stdout，不要放在聊天回复中。

## 3. PR-1 registerTool 桥接契约（新增）

### 3.1 适用场景

处理飞书交互时**优先调用 registerTool**，不要直接 spawn lark-cli。PR-1 暴露 7 个 registerTool：

| registerTool | 用途 | 替换的 lark-cli 命令 |
|--------------|------|---------------------|
| `feishu_add_reaction` | 添加表情 | `im reactions create` |
| `feishu_remove_reaction` | 删除表情 | `im reactions delete` |
| `feishu_send_reply` | 回复私聊消息 | `im +messages-reply` |
| `feishu_get_group_info` | 查群组信息 | `im chats get` |
| `feishu_list_group_members` | 查群成员 | `im +chat-members-list` |
| `feishu_send_group_message` | 发群组消息 | `im +messages-send` / `+messages-reply` |
| `feishu_list_bot_groups` | 列 Bot 所在群组 | `im +chat-list` |

### 3.2 调用契约

- **必须调用 registerTool**：所有飞书 I/O 操作走 registerTool，不要直接调 lark-cli
- **chatId 来源**：registerTool 接受 chatId 参数（调用方传入）
- **返回结果**：registerTool 返回 `{ ok, ... }`，失败时 `isError: true`
- **超时**：`feishu_send_reply` 内置 18s 超时（实测 6-6 验证）

### 3.3 Feature flag 启用条件

`settings.json larkBot.useExtensionMode=true` 时 registerTool 可用。**默认 false** 走旧路径（spawn 独立 lark-bot 进程）。详见 `extensions/lark-bot/index.ts` 顶部注释的组合行为表。

## 4. 引用

- `agent-src/.pi/extensions/lark-bot/index.ts` — PR-1 registerTool 注册点 + feature flag 说明
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书 I/O 实现（registerTool 底层调用）
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 实现（registerTool 底层调用）
- `agent-src/.pi/extensions/lark-bot/process/children-registry.ts` — 子进程注册表（实测 6-3）
- `docs/lark-bot-migration-roadmap.md` — N4 渐进迁移路线图

## 4. 引用

- `agent-src/.pi/extensions/lark-bot/index.ts` — PR-1 registerTool 注册点
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书 I/O 实现（registerTool 底层调用）
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 实现（registerTool 底层调用）
- `agent-src/.pi/extensions/lark-bot/process/children-registry.ts` — 子进程注册表（实测 6-3）
- `docs/lark-bot-migration-roadmap.md` — N4 渐进迁移路线图
