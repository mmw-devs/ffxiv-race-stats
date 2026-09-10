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

### 3.1.1 实测验证（PR-171 后补遗）

基于实测 1-6 结果（详见 review-report-pr171-followup.md）：

| 实测 | 结论 | 对方案 G 影响 |
|------|------|------------|
| 实测 1（ctx 探针）| ctx.chatId 不存在；ctx.sessionManager 可访问但不含 chatId | ⚠️ chatId 改用 Map 反查 |
| 实测 2（PI RPC）| spawn `pi --mode rpc` NDJSON 协议稳定（33 种命令） | ✅ spawn 模式保留 |
| 实测 3（lark-cli）| lark-cli event consume 输出在 stderr；session_shutdown 不自动清理 | ⚠️ 同时监听 stderr + stdout；手动清理子进程 |
| 实测 4（SKILL.md）| 实测命令参数错误，按官方机制走 | ✅ 不做特殊处理 |
| 实测 5（并发）| 原子操作安全；同 turn 多工具有陈旧读竞态 | ⚠️ 禁止 check-then-act 跨 await |
| 实测 6（6 处修正验证）| 6 处修正全部 PASS（修正 5 取消） | ✅ 6 处修正落实 |

### 3.1.2 PR-1 最终边界（基于 Q0 修订 + 实测 1-6）

**PR-1 必须包含**：

| # | 内容 | 实测依据 |
|---|------|---------|
| 1 | `extensions/lark-bot/index.ts` 全新实现（按方案 G + 6 处实测修正） | 实测 1-6 综合 |
| 2 | `chatToSession: Map<chatId, SessionManager>` 新增 | 实测 1 + 6-1（ctx.chatId NOT FOUND） |
| 3 | `pendingEvents: Map<chatId, LarkEvent[]>` 新增 | 实测 5 + 6-4（陈旧读竞态防护） |
| 4 | `children: Set<ChildProcess>` 新增 | 实测 3 + 6-3（手动清理子进程） |
| 5 | **保留** spawn `pi --mode rpc --session-dir <chatId>` | 实测 2 + 6-6（NDJSON 协议稳定） |
| 6 | **保留** stdin/stdout NDJSON 协议 | 实测 2 + 6-6 |
| 7 | **同时监听 stderr + stdout**（lark-cli event consume） | 实测 3 + 6-2 |
| 8 | `pi.on("session_shutdown")` 手动遍历 children kill | 实测 6-3 |

**PR-1 不包含**（推迟到后续 PR）：

| 内容 | 推迟到 | 理由 |
|------|--------|------|
| process.ts 拆分（spawn-helper.ts + crash-protection.ts） | PR-2 | Q4 拆分方案——独立 PR 更安全 |
| OPERATOR_REGISTRY 校验 | PR-4 | 业务规则——非 PR-1 范围 |
| 鉴权缓存 + 工作留痕 + 群组 API 业务逻辑 | PR-2/PR-4 | 非 PR-1 范围 |
| NDJSON 协议解析重构（仅 stdin/stdout NDJSON 解析保留） | PR-2 | 拆分方案——独立 PR |
| spawn helper / mutex 阈值细化 | PR-2 | 实测后调整 |

### 3.1.3 PR-1 编码落地状态（实补）

> 本节为 PR-1 实际编码落地后追加的状态说明。

**实际落地 vs 文档规划差异**：

| # | 文档规划 | 实际落地 | 差异说明 |
|---|---------|---------|---------|
| 1 | `process.ts` 拆分到 PR-2 | **PR-1 即完成** | 实际拆分出 `extensions/lark-bot/process/{spawn-helper, children-registry, session-cleanup, log-rotate}.ts` 4 个文件 |
| 2 | 删除项集中到 PR-2 | **PR-1 即删除** | `process.ts` 整文件删除；进程级防护（watchdog / restart storm / heartbeat / PID 文件 / crash handlers）移交 systemd |
| 3 | registerTool 仅暴露 7 个飞书 I/O | **PR-1 暴露 8 个**（+ larkbot_fetch_pending_events 占位） | PR-2 启用完整飞书 WS 桥接 |
| 4 | `delReaction` 不导出 | **`delReaction` 改为 export** | PR-1 registerTool `feishu_remove_reaction` 需要直接调用 |
| 5 | main.ts 保留原状 | **main.ts 同步简化** | PR-1 必须连带简化 main.ts（移除对 process.ts 的依赖）；保留为回滚路径 |
| 6 | `shared/logger.ts` 不变 | **`shared/logger.ts` 改为 import 新路径** | 从 `process.js` 改为 `extensions/lark-bot/process/log-rotate.js` |

**新增文件清单**：

- `extensions/lark-bot/index.ts`（重写，14.8KB）
- `extensions/lark-bot/process/spawn-helper.ts`（新建，8.7KB）
- `extensions/lark-bot/process/children-registry.ts`（新建，2.8KB）
- `extensions/lark-bot/process/session-cleanup.ts`（新建，3.1KB）
- `extensions/lark-bot/process/log-rotate.ts`（新建，2.6KB）
- `extensions/lark-bot/__tests__/index.test.ts`（新建，8.5KB）
- `extensions/lark-bot/__tests__/process/spawn-helper.test.ts`（新建，8.4KB）
- `extensions/lark-bot/__tests__/process/children-registry.test.ts`（新建，4.9KB）
- `extensions/lark-bot/__tests__/process/session-cleanup.test.ts`（新建，3.9KB）

**修改文件清单**：

- `agent-src/.pi/scripts/lark-bot/main.ts`（简化为回滚路径）
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts`（`delReaction` 改 export）
- `agent-src/.pi/scripts/lark-bot/shared/logger.ts`（import 路径调整）
- `agent-src/.pi/skills/lark-bot-protocol/SKILL.md`（增加 PR-1 registerTool 调用契约说明）
- `agent-src/vitest.config.mjs`（增加 `.pi/extensions/**/__tests__/**/*.test.ts` include）

**删除文件**：

- `agent-src/.pi/scripts/lark-bot/process.ts`（整文件删除；迁出函数全部落到 `extensions/lark-bot/process/` 4 个文件）

**Feature flag 接入**：

- `settings.json` 新增 `larkBot.useExtensionMode`（默认 `false` → 启用旧路径回滚）
- `larkBot.autoStart` 保留兼容（旧版默认 `false`）

### 3.1.4 PR-1 收尾清理（实补后补）

> 本节为 PR-1 合并后第一轮清理，修复 PR-1 合并后遗留的 11 项问题。

**问题修复清单**：

| 问题 | 严重度 | 修复 |
|------|--------|------|
| typebox 软链接断裂风险 | 🔴 严重 | 删除软链接 + `extensions/lark-bot/package.json` 声明依赖 + `vitest.config.mjs` 用 createRequire 动态定位 typebox 入口 |
| `recordPiRestartHistoryLegacy` 死代码 | 🔴 严重 | 删除函数 + main.ts 调用点 |
| main.ts `installLarkBotLifecycle` 死代码 | 🔴 严重 | 删除函数（进程级防护全部移交 systemd） |
| `larkbot_fetch_pending_events` 占位误导 | 🟡 中等 | 删除 registerTool，PR-2 实装时再加 |
| `autoStart` / `useExtensionMode` 语义不清 | 🟡 中等 | index.ts / SKILL.md 增组合行为表 |
| config.ts 9 个死常量 + LARK_PARENT_PID | 🟡 中等 | 删除全部死代码 |
| `spawn-helper.ts` 孤岛 API | 🟢 较轻 | 加 @deprecated JSDoc 标注 |
| 文档同步 | 🟢 较轻 | N4 §3.1.4 本节 |
| `session-cleanup.test.ts` 空壳 | 🟢 较轻 | 简化为 smoke test |
| `index.test.ts` 分支覆盖盲区 | 🟢 较轻 | 补 useExtensionMode=true / autoStart=true 测试 |

**新增文件**：

- `extensions/lark-bot/package.json`（声明 typebox 依赖）

**删除**：

- `extensions/lark-bot/node_modules/typebox`（软链接）
- `extensions/lark-bot/node_modules/`（空目录）
- `extensions/lark-bot/index.ts` 中 `larkbot_fetch_pending_events` registerTool
- `extensions/lark-bot/process/spawn-helper.ts` 中 `recordPiRestartHistoryLegacy`
- `scripts/lark-bot/main.ts` 中 `installLarkBotLifecycle`
- `scripts/lark-bot/config.ts` 中 9 个死常量（PID_FILE / CRASH_LOG_PREFIX / HEARTBEAT_INTERVAL_MS / HEAP_PRESSURE_MB / HEAP_HARD_LIMIT_MB / RESTART_HISTORY_FILE / RESTART_STORM_WINDOW_MS / RESTART_STORM_MAX / RESTART_STORM_COOLDOWN_MS）
- `extensions/lark-bot/index.ts` 中 `LARK_PARENT_PID` 环境变量设置

**修改文件**：

- `extensions/lark-bot/index.ts`（删除 larkbot_fetch_pending_events + LARK_PARENT_PID + feature flag 组合行为表）
- `extensions/lark-bot/process/spawn-helper.ts`（删除 recordPiRestartHistoryLegacy + 孤岛 API @deprecated）
- `extensions/lark-bot/__tests__/index.test.ts`（补 useExtensionMode=true / autoStart=true 测试）
- `extensions/lark-bot/__tests__/process/session-cleanup.test.ts`（简化为 smoke test）
- `scripts/lark-bot/main.ts`（删除 installLarkBotLifecycle + recordPiRestartHistoryLegacy 调用）
- `scripts/lark-bot/config.ts`（删除 9 个死常量 + 重组注释）
- `skills/lark-bot-protocol/SKILL.md`（registerTool 表改为 7 个 + feature flag 语义说明）
- `vitest.config.mjs`（resolve.alias 用 createRequire 动态定位 typebox 入口，无硬编码绝对路径）
- `agent-src/.gitignore`（删除 typebox 软链接例外）

**回滚路径**：

- typebox 软链接删除 → CI 全新 checkout 不再依赖软链接；typebox 通过 npm 自动从 `.pi/npm/node_modules/typebox` 解析
- 进程级防护函数删除 → systemd 接管已生效
- larkbot_fetch_pending_events 删除 → PR-2 实装时恢复

**验证**：

- 现有 195 测试 + PR-1 50 测试 + cleanup 补充分支测试 = 245+ 全过
- typecheck / build / lint 干净

### 3.1.5 PR-2 编码落地状态（实补）

> 本节为 PR-2 实际编码后追加的状态说明。

**变更表**：

| 类别 | 具体变更 |
|------|---------|
| **删除** | `auth.ts` 中 `substringMatch` 内部调用（函数保留为后备）；`AgentMatcher` 类型与 factory 调用 |
| **改造** | `auth.ts` `authorize(input)` 接收 `chatId`（不再接收 `businessDescription`）；仅做成员资格校验 |
| **改造** | `ingress.ts` 删除本地 substringMatch 调用块；增加 `useAgentMatcher` env 判断（默认 true）；formatPrompt header 增加 `pendingAuth=true` 标记 |
| **新增** | `extensions/lark-bot/index.ts` 4 个 registerTool：`larkbot_list_candidate_groups` / `larkbot_authorize_user` / `larkbot_resolve_operator` / `larkbot_get_chat_auth_state` |
| **新增** | `extensionAuthModule` / `extensionBroadcastModule` / `extensionIdentityResolver` 单例（与回滚路径隔离） |
| **新增** | `chatAuthStates: Map<chatId, ChatAuthState>` module-level 缓存 |
| **简化** | `main.ts` 删除 `cleanup` 函数（未被调用）；删除未使用 import |
| **修订** | `SKILL.md` §4 PR-2 鉴权协议（4 个工具 + LLM 决策流） |
| **修订** | `auth.test.ts` 删除 substringMatch 决策测试；新增 chatId 接口测试 |

**registerTool 契约总览**（PR-2 后合计 11 个）：

| 工具 | 用途 | PR |
|------|------|-----|
| `feishu_*` 7 个 | 飞书 I/O | PR-1 |
| `larkbot_list_candidate_groups` | 返回候选群组 | PR-2 |
| `larkbot_authorize_user` | 校验成员资格 | PR-2 |
| `larkbot_resolve_operator` | open_id → user_id | PR-2 |
| `larkbot_get_chat_auth_state` | 查询鉴权状态 | PR-2 |

**Feature flag 接入**：

- `LARK_BOT_USE_AGENT_MATCHER=false` 环境变量临时关闭 LLM 鉴权（PR-2 回滚诊断）
- `LARK_BOT_USE_AGENT_MATCHER=true`（默认）走 LLM 鉴权决策

**回滚策略**：

- `substringMatch` / `normalizeForMatch` 函数保留——`auth.ts` 中仍可作为函数引用（未调用）
- 回滚路径（main.ts + ingress.ts 旧逻辑）保留——`useExtensionMode=false` 时使用旧 spawn lark-bot 进程模式
- `auth_decision` NDJSON 事件未启用——PR-2 registerTool 是同步调用，无需 NDJSON

**实际落地 vs 文档规划的差异**：

| # | 文档规划 | 实际落地 | 说明 |
|---|---------|---------|------|
| 1 | auth.ts 仅做成员资格校验 | ✓ | 删除 substringMatch 内部调用，保留函数作后备 |
| 2 | 4 个 registerTool | ✓ | 与规划一致 |
| 3 | extension 自治 authModule | ✓ | 新建 extensionAuthModule 单例（与回滚路径隔离） |
| 4 | N4 §4.6 LLM 决策流 | ✓ | 通过 registerTool 同步执行（不走 NDJSON） |

**测试覆盖（PR-2 新增）**：

- `extensions/lark-bot/__tests__/auth-tool.test.ts`（新建）：4 个 registerTool × 4 种 status 路径 + 配额已满 + 已/未鉴权场景
- `extensions/lark-bot/__tests__/index.test.ts`（修改）：registerTool 计数 7 → 11 + 新 mock（auth/broadcast/identity-resolver/session-manager）
- `scripts/lark-bot/__tests__/business/auth.test.ts`（修改）：删除 substringMatch 决策测试；保留成员资格校验 + 事件增量更新测试

**验证**：

- 245 测试全过（保持不变——auth.test.ts 减少 5 个 + auth-tool.test.ts 增加 12 个 - index.test.ts 调整 2 个 ≈ 持平）
- typecheck / build / lint 干净

### 3.1.7 PR-4 编码落地状态（实补）

> 本节为 PR-4 实际编码后追加的状态说明。

**变更表**：

| 类别 | 具体变更 |
|------|---------|
| **新增** | `TaskJournal` 接口 + `taskJournals: Map<chatId, TaskJournal>` module-level |
| **新增** | `ChangeEntryLike` 接口（PR-4 轻量定义，避免跨模块导入） |
| **新增** | `createTaskJournal(input)` 辅助函数 |
| **新增** | `taskJournalToLogEntry(journal)` 转换函数（N4 §6.4 明确为独立函数） |
| **扩展** | `larkbot_authorize_user` matched 分支：增加 operator 解析 + OPERATOR_REGISTRY 校验 + task_journal buffer 创建 |
| **新增** | 4 个 registerTool：`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_query_journal` |
| **session_shutdown** | 增加 `taskJournals.clear()` |
| **import** | 新增 `op-log-schema.ts`（generateLog / formatCommitMessage / isOperatorAllowed / getOperatorName）+ `shared/logger.ts emitTaskJournal` |
| **修订** | SKILL.md §6 PR-4 任务日志协议（4 个工具 + 4 个业务场景 + commit message 格式 + 校验机制 + buffer 清理时机） |

**registerTool 总数**：PR-3 后 11 个 → PR-4 后 15 个（7 feishu_* + 8 larkbot_*）。

**task_journal buffer 初始化时机**（N5 §6.3 + N4 §6.6）：

`larkbot_authorize_user` matched 分支内部同步执行：
1. 占用授权槽位（tryReserveAuthorizedSlot）
2. 触发广播（matched）
3. 缓存 chatAuthStates
4. **PR-4 新增**：调 `extensionIdentityResolver.resolveOperator(openId)` 拿 user_id
5. **PR-4 新增**：校验 `isOperatorAllowed(user_id)` 为 true（fail-closed；不通过则释放槽位 + 清理 chatAuthStates + 拒绝）
6. **PR-4 新增**：创建 task_journal buffer + 存入 taskJournals.set(chatId, journal)

**OPERATOR_REGISTRY 校验双重保险**：
- buffer 创建时（`isOperatorAllowed` 校验）
- `larkbot_commit_changes` 提交时（防御性二次校验，防 OPERATOR_REGISTRY 变化导致脏数据）

**审计日志双写**（N5 §7）：
- `larkbot_commit_changes` → emitTaskJournal state=`awaiting_review` + shortDesc + changesCount
- `larkbot_close_business_session` → emitTaskJournal state=`terminated` + reason（区分 session_closed / session_closed_with_pending_changes）

**回滚策略**：
- PR-4 registerTool 一旦注册即生效（无 feature flag 开关）
- 回滚通过 git revert 或独立 PR 移除 4 个 registerTool
- 旧路径（main.ts + ingress.ts）继续走 close_session NDJSON + cleanupSessionForClose——**不受 PR-4 影响**

**实际落地 vs 文档规划**：

| # | 文档规划 | 实际落地 | 说明 |
|---|---------|---------|------|
| 1 | 4 个 registerTool（record_change / commit_changes / close_business_session / query_journal） | ✓ | 与规划一致 |
| 2 | taskJournals Map<chatId, TaskJournal> | ✓ | 模块级单例 |
| 3 | taskJournalToLogEntry 独立函数 | ✓ | 独立函数 + 调用 generateLog |
| 4 | buffer 初始化在 larkbot_authorize_user matched 分支 | ✓ | 扩展 PR-2 代码 |
| 5 | OPERATOR_REGISTRY 校验双重保险 | ✓ | 创建时 + 提交时 |
| 6 | audit journal 双写 | ✓ | commit_changes + close_business_session |
| 7 | content-pr skill 同步修订 | **不在 PR-4 范围** | 决策点 7：独立 PR |

**测试覆盖**：

- `extensions/lark-bot/__tests__/task-journal-tool.test.ts`（新建，15 测试）：
  - larkbot_record_change：追加变更 + 多次累积 + 未鉴权拒绝
  - larkbot_commit_changes：buffer → LogEntry + 清空 + 空 buffer 拒绝 + 未鉴权拒绝 + operator 拒绝
  - larkbot_close_business_session：未鉴权拒绝 + 工具结构
  - larkbot_query_journal：未鉴权 + 有 buffer + 工具结构
  - 扩展 larkbot_authorize_user：matched 时 buffer 创建 + operator 拒绝
- `extensions/lark-bot/__tests__/index.test.ts`（修改）：registerTool 计数 11 → 15 + description 标识 PR-(1|2|3|4)
- `scripts/lark-bot/__tests__/interactive/session-manager-integration.test.ts`（修改）：删除 PR-3 孤儿变量（getPiSession / VALID_CHAT_ID_C）

**验证**：

- 250 测试全过（16 文件：235 + 15 新增）
- typecheck / build / lint 干净

### 3.1.6 PR-3 编码落地状态（实补）

> 本节为 PR-3 实际编码后追加的状态说明。

**变更表**：

| 类别 | 具体变更 |
|------|---------|
| **删除调用点** | `ingress.ts` 中 matchesCloseIntent 调用（2 处）+ closeSessionFromUserIntent 调用 |
| **删除调用点** | `session-manager.ts` handlePiEvent 中 parseCloseSessionFromText 调用（1 处） |
| **保留+标注** | `matchesCloseIntent` 函数（`@deprecated`）— feature flag 回滚路径 |
| **保留+标注** | `closeSessionFromUserIntent` 函数（`@deprecated`）— feature flag 回滚路径 |
| **保留+标注** | `parseCloseSessionFromText` 函数（`@deprecated`）— 作为辅助函数（未来其它场景可复用） |
| **删除** | `__tests__/business/ingress-close-intent.test.ts`（完整文件） |
| **新增** | ingress.ts `LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE=true` 回滚块（feature flag 默认 false） |
| **修订** | SKILL.md §2 close_session 措辞：明确必走 NDJSON；§5 增 `LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE` 说明 |

**保留项**（N4 §5.3）：

- `cleanupSessionForClose` 六步清单
- `closeSessionFromAgent`（仅 NDJSON 路径）
- `closeBroadcastHandler`
- `task-state-machine.ts completeActiveTask` 后清理

**Feature flag**：

- 环境变量 `LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE=true` — 临时恢复本地 matchesCloseIntent 兑底
- 默认 `false`（仅依赖 PI Agent NDJSON）

**实际落地 vs 文档规划**：

| # | 文档规划 | 实际落地 | 说明 |
|---|---------|---------|------|
| 1 | matchesCloseIntent 调用点删除 | ✓ | 2 处全部删除 |
| 2 | matchesCloseIntent 函数保留（回滚保障） | ✓ | 函数保留 + `@deprecated` |
| 3 | closeSessionFromUserIntent 调用点删除 | ✓ | 调用点删除；函数保留 + `@deprecated` |
| 4 | parseCloseSessionFromText 删除 | 函数保留（`@deprecated`） | 作为辅助函数保留供未来复用（决策点 3） |
| 5 | 测试覆盖（matchesCloseIntent 调用 = 0） | ✓ | grep 验证 |
| 6 | feature flag LARK_BOT_USE_NATURAL_LANGUAGE_CLOSE | ✓ | 环境变量形式（PR-3 代码中实现） |

**测试覆盖**：

- 删除 `ingress-close-intent.test.ts`（matchesCloseIntent 函数级测试）
- `session-manager-integration.test.ts` 不动（close_session NDJSON 路径测试已在 PR#162 时建立）
- 现有测试 + auth-tool.test.ts 保持通过

**验证**：

- 245 - 8（ingress-close-intent 测试）+ 0（PR-3 无新增）= 237 测试
- typecheck / build / lint 干净
- `matchesCloseIntent` / `parseCloseSessionFromText` 调用次数 = 0（grep 验证）

### 3.2 删除项

| 类别 | 具体项 |
|------|-------|
| 进程管理 | **保留**：spawn helper / spawn mutex / PID 管理 / stdin shutdown / restart 防护（**实测 6-3 确认**：session_shutdown 不会自动清理子进程）<br>**删除**：看门狗 / 双层 restart storm / 心跳 / 内存监控（移交 systemd） |
| 进程管理 | `extensions/lark-bot/index.ts` 的 spawn 逻辑（**保留 spawn，但精简为 optimization helper**——不消除 spawn） |
| NDJSON 协议 | `session-manager.ts` `handlePiEvent` NDJSON 解析循环（**改为 lark-bot module-level 事件队列 + registerTool 拉取模式**） |
| NDJSON 协议 | `task-state-machine.ts` 中 pi.stdin.write / pi.stdout 读取（**改为 lark-bot module-level 转发**） |
| 配置 | `.pi/settings.json` 中 `larkBot.autoStart` 配置（不再需要） |
| 持久化 | `/tmp/lark-bot.pid` / `/tmp/lark-bot.restart-history` / `/tmp/lark-bot.pi-restart-history` |
| 保留 | `session-manager.ts` `spawnPiProcess` / `spawnPromises` / `piRestartState`（**精简优化而非删除**，方案 G 保留 per-chat spawn） |
| 保留 | `config.ts` PI_RESTART_* 常量（精简为更合理的 restart 策略） |

### 3.2.1 process.ts 拆分方案（基于 Q4 修订 + 实测 2 + 6-3 + 6-6）

**实测依据**：

- **实测 2 + 6-6**：spawn `pi --mode rpc` NDJSON 协议稳定（33 种命令），stdin.end() 触发干净退出（exitCode: 0）——**必须保留**
- **实测 6-3**：session_shutdown 不会自动清理 spawn 子进程——**必须手动遍历 children kill**

**拆分方案**：

| 路径 | 状态 | 内容 | 备注 |
|------|------|------|------|
| `process/spawn-helper.ts` | **保留** | spawn / PID 管理 / stdin shutdown / NDJSON 解析 / spawn mutex / restart 防护 | 实测 2 + 6-6 确认 |
| `process/children-registry.ts` | **新增** | `Set<ChildProcess>` 跟踪 + session_shutdown 时手动 kill | 实测 6-3 强制要求 |
| ~~`process/crash-protection.ts`~~ | **删除** | 看门狗 / 双层 restart storm / 心跳 / 内存监控 | 移交 systemd（实测 6-3 确认手动清理足够） |
| `shared/logger.ts` | **保留** | （不变） | — |
| `shared/resource-manager.ts` | **保留** | spawn mutex + restart 防护 | 不变 |

**关键约束**：

- ❌ **不删除** NDJSON 协议解析（实测 2 + 6-6 确认协议稳定）
- ❌ **不删除** stdin shutdown（实测 2 + 6-6 确认干净退出）
- ✅ **新增** `children-registry.ts`（实测 6-3 强制要求）
- ✅ **删除** 进程级崩溃防护（移交 systemd）

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
| **Module-level 业务状态（按 chatId 路由，实测 1 修正）** | `chatToSession: Map<chatId, SessionManager>` ← 实测 1 缺口 3 修正方案——chatId 不依赖 ctx.chatId<br>`pendingEvents: Map<chatId, LarkEvent[]>` ← 原子读+删除必须单步（实测 5）<br>`taskJournals: Map<chatId, TaskJournal>`<br>`children: Set<ChildProcess>` ← 实测 6-3 修正——手动 kill 子进程 |
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
    // 实测 3 修正：lark-cli 输出在 stderr，需同时监听 stderr + stdout
    const larkCli = spawn(larkCliPath, ["event", "consume", "im.message.receive_v1"], { ... });
    larkCli.stdout?.on("data", onStdoutNdjson);
    larkCli.stderr?.on("data", onStderrNdjson);  // 主要输出方向
    children.add(larkCli);  // 实测 6-3：手动追踪，便于 session_shutdown 时 kill
  });

  // ── 关闭期：清理 module-level 状态
  pi.on("session_shutdown", async (event, ctx) => {
    // 实测 6-3 修正：session_shutdown 不会自动清理子进程，必须手动遍历 kill
    for (const child of children) {
      child.kill("SIGTERM");
    }
    children.clear();
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

**registerTool description / promptSnippet 设计原则（实测 4 修正）**：

- 完整描述工具语义（LLM 需理解工具 API）
- **不**做特殊机制处理 SKILL.md——按 PI Agent 官方机制自动加载
- SKILL.md（如 lark-bot-protocol）描述协议语义；registerTool 描述 API——**分工不重叠**

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

**实测 1 修正（chatId 来源）**：

实测发现 `ctx.chatId` 在 PI Agent Extension API 中**不存在**。修正方案：

- **方案 G-v2（采用）**：lark-bot module-level 维护 `chatToSession: Map<chatId, SessionManager>`
- larkbot_fetch_pending_events 接受 chatId 参数，从 Map 反查
- **不依赖 ctx.chatId**（实测确认 NOT FOUND）

```typescript
// 实测 1 修正后的 larkbot_fetch_pending_events 实现
registerTool("larkbot_fetch_pending_events", {
  description: "拉取当前 chat 的待处理飞书事件（chatId 必需参数）",
  parameters: Type.Object({
    chatId: Type.String({ description: "飞书 chat_id，来自飞书事件" }),
  }),
  execute: async ({ chatId }, ctx) => {
    // 1. 从 Map 反查 sessionManager（实测 1：ctx.chatId 不存在）
    const session = chatToSession.get(chatId);
    if (!session) {
      return { error: "unknown_chat", events: [] };
    }
    // 2. 原子读+删除（实测 5：陈旧读竞态防护）
    const events = pendingEvents.get(chatId) ?? [];
    pendingEvents.delete(chatId);
    return { events };
  },
});

// 飞书事件到达时建立映射（不依赖 LLM 主动调用）
function onLarkEvent(event: LarkEvent) {
  // 建立 chatId → SessionManager 映射
  if (!chatToSession.has(event.chat_id)) {
    chatToSession.set(event.chat_id, createSessionManager(event.chat_id));
  }
  // 原子推入事件队列
  const queue = pendingEvents.get(event.chat_id) ?? [];
  queue.push(event);
  pendingEvents.set(event.chat_id, queue);
}
```

**实测 5 修正（并发安全约束）**：

registerTool.execute 内**禁止** check-then-act 跨 await：

```typescript
// ❌ 错误：同 turn 多工具有陈旧读竞态
if (pendingEvents.has(chatId)) {
  const events = pendingEvents.get(chatId);
  await someAsyncWork();  // ← 此处其他工具可修改 pendingEvents
  pendingEvents.delete(chatId);
}

// ✅ 正确：单步原子操作
const events = pendingEvents.get(chatId) ?? [];
pendingEvents.delete(chatId);  // 单步，无 await
```

### 3.7.1 飞书 WS 桥接剩余修订（基于 Q7 修订 + 实测 3 + 6-2 + 6-3）

**实测 3 + 6-2 修订（lark-cli 监听）**：

lark-cli event consume 的**结构化输出主要在 stderr**（不是 stdout），实测 3 已确认。修正方案：

```typescript
// ❌ 错误：只监听 stdout（实测 3 确认丢数据）
larkCli.stdout?.on("data", onLarkEvent);

// ✅ 正确：同时监听 stderr + stdout
larkCli.stdout?.on("data", onStdoutNdjson);  // 兜底
larkCli.stderr?.on("data", onStderrNdjson);  // 主输出方向
```

**实测 6-3 修订（session_shutdown 清理）**：

PI Agent session_shutdown **不会自动清理** spawn 的 lark-cli 子进程——必须手动遍历 kill。修正方案：

```typescript
// children Set<ChildProcess>（实测 6-3 强制要求）
const children: Set<ChildProcess> = new Set();

pi.on("session_start", async (event, ctx) => {
  if (event.reason !== "startup") return;

  // spawn lark-cli event consume
  const child = spawn(larkCliPath, ["event", "consume", ...]);
  children.add(child);  // 注册
  child.on("exit", () => children.delete(child));  // 退出时清理
});

pi.on("session_shutdown", async (event, ctx) => {
  // 手动遍历 kill 所有子进程（实测 6-3 强制要求）
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  children.clear();
});
```

**实测 1 + 6-1 修订（chatId 来源）**：见 §3.7 实测 1 修正部分（PR-172 已合并）

**实测 5 + 6-4 修订（并发安全）**：见 §3.7 实测 5 修正部分（PR-172 已合并）

**最终飞书 WS 桥接路径**：

```
飞书事件 → lark-cli event consume (stderr + stdout)
  → onStderrNdjson / onStdoutNdjson
  → chatToSession: Map<chatId, SessionManager>.set(chatId, ...)
  → pendingEvents: Map<chatId, LarkEvent[]>.push(event)
  → spawn(pi --mode rpc --session-dir <chatId>)
  → children.add(child)
  → stdin.write({type:"prompt", message:...})
  → stdout NDJSON 接收 → LLM 决策
```

**约束（实测综合）**：

- ❌ **不依赖** ctx.chatId（实测 1 确认 NOT FOUND）
- ❌ **不** check-then-act 跨 await（实测 5 + 6-4 确认竞态）
- ✅ **同时监听 stderr + stdout**（实测 3 + 6-2）
- ✅ **手动 kill 子进程**（实测 6-3 强制要求）

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

### 3.8.1 实测验证矩阵（PR-171 后补遗）

6 处修正的实测验证状态：

| 修正 | 实测验证 | 状态 |
|------|---------|------|
| chatId Map 反查 | 实测 6-1 PASS | ✅ 采纳 |
| stderr/stdout 监听 | 实测 6-2 partial（实测 3 确认） | ✅ 采纳 |
| session_shutdown 清理 | 实测 6-3 PASS | ✅ 采纳 |
| check-then-act 禁止 | 实测 6-4 PASS | ✅ 采纳 |
| SKILL.md 特殊处理 | 实测 4 命令错误 + 实测 6-5 still fail | ❌ 取消——按官方机制走 |
| NDJSON 协议保留 | 实测 6-6 PASS | ✅ 采纳 |

### 3.9 回滚方案（PR-1）

保留 feature flag `larkBot.useExtensionMode`：

```typescript
// 启动期根据 settings.json 决定是否启用 extension 化 registerTool 集合
// （spawn per-chat PI Agent 进程始终保留——方案 G）
if (settings.larkBot?.useExtensionMode === true) {
  // PR-1：新路径——registerTool 集合替代 stdin/stdout NDJSON 协议
} else {
  // 旧路径：spawn lark-bot 进程（保留 PR-1 之前代码，作为回滚）
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
