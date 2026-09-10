---
name: lark-bot-protocol
description: >
  lark-bot 任务日志上报协议 + registerTool 桥接契约（PR-1 + PR-2）。通过 lark-bot 私聊处理业务任务时，向 stdout 输出 task_log 事件上报业务主题；处理飞书交互时调用 11 个 registerTool（7 个 feishu_* + 4 个 larkbot_*）。涵盖上报时机、JSON 格式、promptId 读取、subject 写法、registerTool 调用契约、鉴权 LLM 决策流。
compatibility: 依赖 lark-bot 私聊接入；要求 prompt header 含 promptId；PR-1/PR-2 registerTool 要求 settings.json 设置 larkBot.useExtensionMode=true（旧路径下不可用）。
---

# lark-bot-protocol

## 0. 何时加载

满足以下任一条件即加载本 skill：

1. 当前 prompt 是 lark-bot 通过私聊发来的业务任务，且 prompt header 包含 `promptId=...`（即走 stdin/stdout NDJSON 协议）
2. 处理飞书交互（发回复 / 加表情 / 查群组 / 收消息）时——应优先调用 registerTool
3. 处理鉴权决策（业务描述 → 群组匹配）时——必须调用 PR-2 registerTool（见 §4）

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

## 2. 关闭会话（必走 NDJSON）

当用户表示"结束任务"、"done"、"再见"等意图时，**必须**向 stdout 输出一行 JSON NDJSON：

```json
{"type":"close_session","reason":"<可选原因>"}
```

**PR-3 关键变更**：lark-bot 不再做本地 matchesCloseIntent 正则检测，不做文本兑底解析。会话关闭**仅**依赖 PI Agent emit close_session NDJSON。

`reason` 可选。reason 为业务上下文（如 "user_said_done"）。

这条 JSON 必须直接输出到 stdout，不要放在聊天回复中。

**调试点**：如 PI Agent 协议不稳定，可设置环境变量 `LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE=true` 临时恢复本地 matchesCloseIntent 兑底（生产环境保持 false）。

## 3. PR-1 registerTool 桥接契约（飞书 I/O）

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

## 4. PR-2 registerTool 桥接契约（鉴权决策）

### 4.1 业务私聊鉴权流程

**首次未鉴权消息**（prompt header 含 `pendingAuth=true`）：

1. **调 `larkbot_list_candidate_groups`** 拿候选群组列表（含 chatId/name/description）
2. **LLM 决策 chatId**：根据用户业务描述与候选群组 description 综合判断
3. **调 `larkbot_authorize_user({openId, chatId})`** 验证成员资格
   - `matched` → 鉴权通过，可继续业务会话
   - `not_member` → 用户不在该群组，提示用户
   - `no_match` → chatId 不在缓存（LLM 决策错误）
   - `auth_module_error` → 鉴权模块异常，稍后重试
4. **可选**：调 `larkbot_get_chat_auth_state({chatId})` 确认鉴权状态

**后续业务消息**（已鉴权）：直接处理业务逻辑，不需要重新鉴权。

### 4.2 4 个 registerTool

| registerTool | 用途 | 关键参数 |
|--------------|------|---------|
| `larkbot_list_candidate_groups` | 返回 description 非空的候选群组 | 无 |
| `larkbot_authorize_user` | 校验 openId 是否在 chatId 群组成员中 | `{openId, chatId}` |
| `larkbot_resolve_operator` | 把飞书 open_id 解析为稳定 user_id（PR-4 用） | `{openId}` |
| `larkbot_get_chat_auth_state` | 查询 chatId 的鉴权状态 | `{chatId}` |

### 4.3 调用约束

- **必须先调 `larkbot_list_candidate_groups` 再调 `larkbot_authorize_user`**——LLM 不能凭空决定 chatId
- **chatId 必须来自候选列表**——不能自行构造（会被 `no_match` 拒绝）
- **鉴权是同步副作用**：matched 时 registerTool 内部自动占用授权槽位 + 广播到群组，LLM 不需要额外操作
- **PR-2 不调任何 `auth_decision` NDJSON 事件**——registerTool 是同步调用，不走 NDJSON 协议

### 4.4 鉴权失败处理

- **`not_member`** → 调 `feishu_send_reply` 告知用户不在该群组；不调用 `larkbot_close_business_session`
- **`no_match`** → 重新调 `larkbot_list_candidate_groups`；可能 LLM 之前误判
- **`auth_module_error`** → 不继续业务，提示用户稍后重试

### 4.5 close_session 协议（PR-2 后）

鉴权完成后，业务会话关闭仍走 §2 协议：

```
{"type":"close_session","reason":"<可选原因>"}
```

**注意**：LLM 不需要为鉴权过程 emit close_session——鉴权是 registerTool 同步副作用。

## 5. Feature flag 与环境变量启用条件

`settings.json larkBot.useExtensionMode=true` 时 registerTool 可用。**默认 false** 走旧路径（spawn 独立 lark-bot 进程）。详见 `extensions/lark-bot/index.ts` 顶部注释的组合行为表。

环境变量：

- `LARK_BOT_USE_AGENT_MATCHER=false` — 临时关闭 LLM 鉴权（PR-2 回滚诊断）
- `LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE=true` — 临时恢复本地 matchesCloseIntent 兑底（PR-3 回滚诊断）

## 6. PR-4 任务日志协议

### 6.1 任务日志生命周期

```
鉴权 matched（PR-2 → PR-4）→ 创建 task_journal buffer
  ↓
业务执行中 → larkbot_record_change 追加 ChangeEntry（顺序 = LLM 决策顺序）
  ↓
提交 PR → larkbot_commit_changes（buffer → LogEntry → commit message）
  ↓
关闭会话 → larkbot_close_business_session（清理 buffer + ended 广播）
```

### 6.2 4 个 registerTool

| registerTool | 用途 | 关键参数 |
|--------------|------|---------|
| `larkbot_record_change` | 追加字段级变更到 buffer | chatId, field, from, to |
| `larkbot_commit_changes` | buffer → LogEntry → commit message | chatId, shortDesc |
| `larkbot_close_business_session` | 关闭会话 + ended 广播 + buffer 清理 | chatId |
| `larkbot_query_journal` | 查询 buffer 状态（调试） | chatId |

### 6.3 业务场景调用流

**场景 A：提交 PR（不关闭会话）**

1. LLM 调 `larkbot_commit_changes({chatId, shortDesc})` — buffer 非空校验 + operator 在 OPERATOR_REGISTRY 校验
2. lark-bot 返回 commitMessage + journalReset=true
3. LLM 拿到 commitMessage 调 content-pr skill 完成：git commit / push / gh pr create / 等待合并 / gh pr merge
   - **commitMessage 必须 100% 原样使用，不得修改任何字符**（包括 shortDesc / 字段顺序 / JSON 缩进 / 反引号数量）
   - content-pr skill 负责 git 操作；LLM 不负责构造或修改 commit message
4. 会话保持，业务变更继续累积到 buffer

**场景 B：结束任务（不提交 PR）**

1. LLM 调 `larkbot_close_business_session({chatId})`
2. lark-bot 触发 ended 广播（引用回复 matched 消息）+ 释放授权槽位 + 清理 buffer
3. 返回 `{status: 'closed', broadcastMessageId}`

**场景 C：提交并结束**

1. LLM 先调 `larkbot_commit_changes`（场景 A 步骤 1-2）
2. LLM 调 content-pr skill 提交 git
3. LLM 调 `larkbot_close_business_session`（场景 B 步骤 1-2）

**场景 D：无变更提交**

1. LLM 调 `larkbot_commit_changes` — buffer 为空 → 拒绝，返回 `{error: 'no_changes'}`
2. LLM 向用户回复“本次会话无业务变更，无需提交 PR”

### 6.4 commit message 格式

`larkbot_commit_changes` 内部调用 `op-log-schema.ts formatCommitMessage(shortDesc, logEntry)`，输出格式：

```
content: <shortDesc>

````json
{
  "operator": "<user_id>",
  "timestamp": "<ISO 8601>",
  "changes": [
    { "field": "<JSONPath-like>", "from": <from>, "to": <to> }
  ]
}
````
```

LLM 拿到后必须调用 content-pr skill 用该 commitMessage 提交 PR（不修改 message 内容）。

### 6.5 校验机制

- `larkbot_commit_changes` 校验 buffer.operator 在 OPERATOR_REGISTRY（避免 buffer 创建后注册表变化导致脏数据）
- ops CI 在 PR 合并前再次通过 `validate-op-log.ts` 校验
- 校验失败 → PR 不合并

### 6.6 buffer 清理时机

| 时机 | 行为 |
|------|------|
| `larkbot_commit_changes` | buffer.changes 清空，会话元数据保留（支持多次 PR） |
| `larkbot_close_business_session` | buffer 整体删除（业务会话生命周期结束） |
| `session_shutdown` | 所有 taskJournals 清空（PI Agent 关闭） |

## 7. 引用

- `agent-src/.pi/extensions/lark-bot/index.ts` — registerTool 注册点 + feature flag 说明
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书 I/O 实现（registerTool 底层调用）
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 实现（registerTool 底层调用）
- `agent-src/.pi/scripts/lark-bot/business/auth.ts` — AuthModule 实现（PR-2 后仅做成员资格校验）
- `agent-src/.pi/scripts/lark-bot/business/broadcast.ts` — 工作留痕广播
- `agent-src/.pi/scripts/lark-bot/identity-resolver.ts` — open_id → user_id 解析（PR-2 registerTool 包装）
- `agent-src/scripts/op-log-schema.ts` — OPERATOR_LOG 模块（generateLog / formatCommitMessage / OPERATOR_REGISTRY，PR-4 任务日志底层）
- `agent-src/scripts/validate-op-log.ts` — ops CI 校验脚本（PR 合并前）
- `agent-src/.pi/extensions/lark-bot/process/children-registry.ts` — 子进程注册表（实测 6-3）
- `docs/lark-bot-migration-roadmap.md` — N4 渐进迁移路线图
