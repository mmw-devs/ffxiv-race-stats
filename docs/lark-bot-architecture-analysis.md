# lark-bot 架构分析（issue #168 第一阶段汇总）

> issue #168 第一阶段交付物：PI Agent + lark-bot 整体业务逻辑分析与架构重构方案。
> 范围：第一阶段所有产出物（N1 ~ N5）的收口与 issue 验收标准对账。
> 不在范围：第二阶段重构实现、PI Agent 上游修复、飞书 OpenAPI 升级。

## 0. 阅读对象与范围

- 阅读对象：issue #168 reviewer、lark-bot 维护者、PI Agent 协议设计者、ops 仓库维护者。
- 范围：业务逻辑分析 + 架构对比结论 + 渐进迁移路线图。
- 不在范围：新功能开发、PI Agent 上游行为修复、飞书 OpenAPI 升级适配（issue #168 明确）。

## 1. 文档目的与定位

本文档是 issue #168 第一阶段的**验收交付物**，对应 issue 验收标准首项：

> 第一阶段产出架构分析文档，包含现有 spawn 模式 vs 标准 extension 模式的对比结论

它把分散在 N1 ~ N5 五个文档中的分析结论**收敛为可评审的整体方案**，并对照 issue 验收标准逐条勾选。

## 2. 核心结论（Key Findings）

### 2.1 业务本质

lark-bot 是**飞书私聊 ↔ PI Agent**的双向转发器：

```
[飞书私聊消息] ←→ [lark-bot] ←→ [PI Agent]
                          ↓
                       [飞书群组]
                       （鉴权数据源 + 工作留痕目标）
```

PI Agent 是**飞书消息路由的业务总线**：所有业务语义判断（鉴权匹配 / 关闭意图 / 业务执行 / 字段变更）由 PI Agent 用 LLM 决策，lark-bot 仅承担飞书协议 I/O 与资源状态管理。

### 2.2 架构根问题

lark-bot 现有实现是**三层架构**（issue #168 描述为"双重"，实测修正）：

```
PI Agent (extension host)
  └─ spawn 1: lark-bot 主进程 (tsx .pi/scripts/lark-bot/main.ts)
                ├─ spawn 2: PI Agent 子进程 (pi --mode rpc ...)
                └─ spawn 3: lark-cli event consume / im / contact / chats
```

**根问题**：lark-bot 与 PI Agent 子进程之间是 stdin/stdout NDJSON 私有协议——PI Agent 看不到协议，lark-bot 持有大量业务语义判断（substringMatch / matchesCloseIntent / task-state-machine）作为兜底。这导致：

- 三处散落的关闭意图检测（NDJSON / 文本兜底 / 自然语言正则）
- SKILL.md 全文 inline 作为 PI Agent 不自动加载 skill 的兜底
- protocol 不稳定时本地兜底累积

### 2.3 PI Agent 上游契约

5 个现有事件 + 2 个提议：

| 现有 | 提议 |
|------|------|
| response（get_state / prompt / get_last_assistant_text） | task_change |
| agent_end | auth_decision |
| agent_settled | |
| task_log | |
| close_session | |

### 2.4 不稳定点（10 项，分级）

| 级别 | 数量 | 主要项 |
|------|------|--------|
| 高 | 3 | close_session 三处散落 / PI Agent stdout NDJSON 不稳定 / SKILL.md 不自动加载 |
| 中 | 5 | prompt 拒绝重试掩盖上游不稳定 / restart storm 双层 / stdout JSON 解析失败静默吞掉 / SKILL.md 全文 inline 是 prompt 污染 / AgentMatcher 钩子未注入 |
| 低 | 2 | spawn cwd（已修复）/ activeTask 状态机违反强制清空 |

### 2.5 架构对比结论

**路 C（渐进迁移）推荐**：PR-1 extension 化 → PR-2 鉴权 LLM → PR-3 关闭意图 → PR-4 任务日志。

**关键约束**：

- 飞书 WS 事件接收无法消除 spawn（PI Agent 无飞书通道 API，lark-cli 子进程必须保留）
- PI Agent 子进程层可消除（与 extension host 合一）
- 每个 PR 保留 feature flag，< 5 分钟可回滚

### 2.6 任务日志对象

走 `agent-src/scripts/op-log-schema.ts` 已有的 `OPERATOR_LOG` 基础设施：

- 终态对象：`LogEntry`（3 字段：operator / timestamp / changes）
- 累积缓冲：`TaskJournal`（per-chat_id module-level Map，新增设计）
- 嵌入方式：`formatCommitMessage(shortDesc, log)` → commit message 4 反引号 JSON 块
- 校验脚本：`validate-op-log.ts`（ops CI 在 PR 合并前校验）

**任务日志对象跨越两个事件边界**（与业务生命周期紧密关联）：

| 边界 | 事件 | 触发 registerTool |
|------|------|-----------------|
| 会话生命周期 | 创建 | 鉴权成功时初始化 buffer |
| 会话生命周期 | 累积 | `larkbot_record_change` |
| 会话生命周期 | 销毁 | `larkbot_close_business_session` |
| PR 生命周期 | 提交 | `larkbot_commit_changes` + content-pr skill |

**职责划分**：

- lark-bot 负责 buffer 累积 + LogEntry 转换 + commitMessage 生成
- content-pr skill 负责 git commit / push / gh pr create / merge
- ops CI（validate-op-log.ts）负责 PR 合并前的 LogEntry 校验

**关键发现**：

- 当前 MVP 缺失**业务私聊 → PR 提交**的完整路径
- task_journal buffer → LogEntry 转换逻辑需新增（PR-4）
- content-pr skill 已实现完整的 PR 提交流程，不需修改
- content-pr skill 需要补充说明：如何从 lark-bot 拿 LogEntry（PR-4 修订）

## 3. 五个综合决策

| # | 决策点 | 选择 | 依据 |
|---|--------|------|------|
| 1 | 迁移路径 | 渐进迁移（PR-1~PR-4，每 PR 解决一个问题） | MVP 演进节奏（PR#159/#161/#163） + 一次性重写风险高 |
| 2 | 替换边界 | 保留 L0/L1/L4a/L4b/L5 分层骨架；替换各层业务语义判断 | MVP 文档硬约束分层；问题在层内位置错 |
| 3 | 任务日志嵌入 | 走 OPERATOR_LOG 已有基础设施（LogEntry + commit message JSON 块） | `op-log-schema.ts` 已完整实现且 PR#85 已验证 |
| 4 | 鉴权数据源 | 群组缓存 + 成员资格校验保留 lark-bot；语义匹配迁 Agent | MVP "业务层不调协议层"约束 + registerTool 注入 |
| 5 | 会话边界 | MVP 七阶段生命周期 + 补齐"会话 → PR"连接 | MVP 设计意图 + OPERATOR_LOG 设计对齐 |

## 4. PR 拆分总览

| PR | 内容 | 关键删除 | 关键新增 | 决策 |
|----|------|---------|---------|------|
| **PR-1** | extension 化（消除 PI Agent 子进程层） | `process.ts` / `spawnPiProcess` / `handlePiEvent` NDJSON | 7 个 `feishu_*` registerTool + 飞书 WS 桥接 | 决策 1 |
| **PR-2** | 鉴权判定迁 PI Agent LLM | `substringMatch` / `agentMatcher` 钩子 | `larkbot_list_candidate_groups` / `larkbot_authorize_user` / `larkbot_resolve_operator` | 决策 4 |
| **PR-3** | 关闭意图删除本地正则 | `matchesCloseIntent` / `parseCloseSessionFromText` | （依赖 PI Agent emit close_session 稳定） | 决策 5 |
| **PR-4** | 任务日志对象接入 OPERATOR_LOG | 无（缺失路径补齐） | `larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_query_journal` | 决策 3 + 决策 5 |

**推荐顺序**：PR-1 → PR-2 → PR-3 → PR-4（PR-2/3/4 必须串行在 PR-1 之后）。

## 5. registerTool 清单（15 个）

### 5.1 飞书 I/O（PR-1，7 个）

| registerTool | 替换实现 |
|--------------|---------|
| `feishu_add_reaction` | `protocol/feishu.ts addReaction` |
| `feishu_remove_reaction` | `protocol/feishu.ts delReaction` |
| `feishu_send_reply` | `protocol/feishu.ts sendReply` |
| `feishu_get_group_info` | `broadcast/group-tool.ts getGroupInfo` |
| `feishu_list_group_members` | `broadcast/group-tool.ts listGroupMembers` |
| `feishu_send_group_message` | `broadcast/group-tool.ts sendGroupMessage` |
| `feishu_list_bot_groups` | `broadcast/group-tool.ts listAllBotGroups` |

### 5.2 业务（PR-2 + PR-4，6 个）

| registerTool | 替换实现 | PR |
|--------------|---------|-----|
| `larkbot_list_candidate_groups` | `auth.ts candidates 过滤` | PR-2 |
| `larkbot_authorize_user` | `auth.ts authorize / substringMatch` | PR-2 |
| `larkbot_resolve_operator` | `identity-resolver.ts resolveOperator` | PR-2 |
| `larkbot_record_change` | 无（缺失路径补齐） | PR-4 |
| `larkbot_commit_changes` | 无（buffer → LogEntry 转换 + commitMessage 返回） | PR-4 |
| `larkbot_close_business_session` | 无 | PR-4 |

**关键设计**：

- `larkbot_commit_changes` 与 `larkbot_close_business_session` **不联动**——LLM 决策何时调用
- `larkbot_commit_changes` 不持有 git 权限——实际 git 操作由 content-pr skill 完成
- `larkbot_commit_changes` 后 buffer.changes 清空——支持一次会话多次 PR
- `larkbot_close_business_session` 不强制 changes 非空——会话关闭与提交 PR 是两个事件

### 5.3 桥接与调试（2 个）

| registerTool | 用途 | PR |
|--------------|------|-----|
| `larkbot_fetch_pending_events` | 飞书 WS 事件 → LLM 上下文桥接 | PR-1 |
| `larkbot_query_journal` | 查询 task_journal buffer 状态（调试用） | PR-4 |

## 6. feature flag 总表

每个 PR 一个 feature flag，向后兼容窗口 1 周观察期。

| feature flag | PR | 默认值 | 说明 |
|--------------|-----|--------|------|
| `larkBot.useExtensionMode` | PR-1 | false | 是否启用 extension 模式（vs spawn 模式） |
| `larkBot.useAgentMatcher` | PR-2 | true | 是否依赖 LLM 决策（vs substringMatch） |
| `larkBot.useNaturalLanguageClose` | PR-3 | false | 是否启用自然语言兜底（vs 仅 NDJSON） |
| `larkBot.enableTaskJournal` | PR-4 | true | 是否启用 task_journal buffer |
| `larkBot.commitOnClose` | PR-4 | false | 会话关闭时是否自动 `larkbot_commit_changes` |

settings.json 示例：

```json
{
  "larkBot": {
    "useExtensionMode": true,
    "useAgentMatcher": true,
    "useNaturalLanguageClose": false,
    "enableTaskJournal": true,
    "commitOnClose": false
  }
}
```

## 7. 不稳定点与兜底策略汇总

来源：N2 §7 + §8。

| 不稳定点 | 当前兜底 | 集中化建议 | 落地 PR |
|---------|---------|-----------|--------|
| close_session 三处 | NDJSON + 文本正则 + 自然语言正则 | closeIntentRouter 单一入口 | PR-3 删除本地兜底 |
| SKILL.md 不自动加载 | prompt 全文 inline | PI Agent 协议升级 + registerTool 返回值注入 | PR-1 |
| PI Agent stdout NDJSON 不稳定 | 解析失败静默吞掉 | 显式告警 + 计数 | PR-1 |
| prompt 拒绝重试 | attemptCount 重试 | 保留（已稳定） | — |
| pi exit | restart storm + 5s 重试 | PI Agent session 生命周期托管 | PR-1 |
| restart storm 双层 | process.ts + session-manager.ts | 统一抽象为 restartGuard | PR-1 |
| AgentMatcher 未注入 | substringMatch 兜底 | LLM 决策（PR-2 激活） | PR-2 |
| activeTask 状态机违反 | 强制 ERROR 旧 task | 保留（已稳定） | — |
| spawn cwd | process.cwd() + sanity check | 保留（已稳定） | — |
| agent_settled 不 emit | TASK_MAX_AGE_MS=30min 兜底 | 缩短到 5min | PR-3 |

## 8. 验收标准对账（issue #168）

| 验收项 | 状态 | 落地文档 / PR |
|-------|------|--------------|
| 第一阶段产出架构分析文档，包含现有 spawn 模式 vs 标准 extension 模式的对比结论 | ✅ 已完成 | 本文档 + N3 |
| 第二阶段重构基于第一阶段产出，每步 PR 可独立 review / 合入 | ⏳ 待第二阶段 | N4 已给出 PR-1~PR-4 拆分 |
| PI Agent 不可靠点有清晰兜底策略（无论是集中还是分散） | ✅ 已完成 | N2 §8 + 本文档 §7 |
| SKILL.md 注入问题得到解决，PI Agent 真正看到协议 | ⏳ 待 PR-1 | N4 §3 + N3 §1 |
| PR#163 中发现的边界 bug 都有针对性回归测试 | ⏳ 待 PR 落地 | N4 §9 测试覆盖要求 |
| 现有 195 测试 + 重构期间新增测试全过 | ⏳ 待 PR 落地 | N4 §9 + 各 PR 单测 |
| typecheck 干净 | ⏳ 待 PR 落地 | 各 PR CI 检查 |

## 9. 范围与限制

### 9.1 不在范围（issue #168 明确）

- **新功能开发**：重构完成后再讨论方向
- **PI Agent 上游行为修复**：属于 `@earendil-works/pi-coding-agent` 项目，不在 dev/ops 仓库控制
- **飞书 OpenAPI 升级适配**：lark-cli 升级不在本仓库控制

### 9.2 文档未涵盖项（issue #168 第一阶段明确）

| 项 | 状态 | 说明 |
|----|------|------|
| 模块名 / 文件路径 / API 签名 | 未预设 | 待 PR 落地时 design doc 决定 |
| 行数限制 / 函数长度限制 | 未预设 | 不设 |
| 是否引入新设计模式（facade / adapter / middleware） | 未预设 | 待 PR-1 decide |
| ctx.ui 是否使用 | 决定不使用 | 飞书通道独立 |

### 9.3 依赖项

| 依赖 | 状态 | 风险 |
|------|------|------|
| PI Agent `close_session` NDJSON 稳定 | 不稳定（N2 §7.1） | PR-3 删除本地兜底后风险高，feature flag 临时启用 |
| PI Agent `registerTool` API 行为 | 实测已确认（types.d.ts） | 低 |
| `OPERATOR_LOG` 模块稳定 | 稳定（PR#85 已验证） | 低 |
| 飞书 EventKey 订阅 8 路 | 稳定 | 低 |
| lark-cli 可用 | 稳定 | 低 |

## 10. 风险与缓解

| 风险 | 等级 | 来源 | 缓解 |
|------|------|------|------|
| PI Agent session 生命周期不熟 | 高 | N3 §7.1 | `pi.on('session_shutdown')` 清理 module-level 状态 |
| registerTool 并发安全 | 高 | N3 §7.2 | per-chat_id lock（Promise 链式 serialize） |
| 飞书 WS 桥接 | 中 | N3 §7.3 | `larkbot_fetch_pending_events` module-level 队列 |
| LLM 调用成本 | 中 | N3 §7.4 | registerTool description 精炼 |
| OPERATOR_REGISTRY 注入 | 低 | N3 §7.5 | MVP 阶段 2 项，按需 registerTool 查询 |
| 跨 PR 合并冲突 | 中 | N4 §10 | 建议串行 PR-1 → PR-2 → PR-3 → PR-4 |
| feature flag 累积 | 低 | N4 §10 | 5 个是 MVP 上限；后续需整合 |
| PI Agent 协议不稳定 | 高 | N2 §7.1 / N4 §10 | feature flag 临时启用 matchesCloseIntent 兜底 |

## 11. 文档清单（第一阶段 6 个产出物）

| 节点 | 文档 | 行数 | 主题 |
|------|------|------|------|
| 起点 | （commit bb50c1f） | — | 起点 commit 标注 |
| N1 | `docs/lark-bot-business-flow.md` | 291 | 业务流图（MVP 七阶段 + 任务日志对象生命周期） |
| N2 | `docs/lark-bot-pi-agent-contract.md` | 450 | PI Agent 上游契约盘点与不稳定点清单 |
| N3 | `docs/lark-bot-extension-migration-analysis.md` | 383 | spawn 模式 vs 标准 extension 模式对比 |
| N4 | `docs/lark-bot-migration-roadmap.md` | 832 | 渐进迁移路线图 + registerTool 契约设计 |
| N5 | `docs/lark-bot-task-journal-schema.md` | 427 | 任务日志对象 schema（OPERATOR_LOG 对齐版） |
| **N6** | `docs/lark-bot-architecture-analysis.md`（本文档） | 411 | **第一阶段汇总** |
| 审查报告 1 | `docs/lark-bot-review-report.md` | 416 | 第 1 轮 reviewer 一致性审查报告（6 高 / 11 中 / 7 低） |
| 审查报告 2 | `docs/lark-bot-review-report-revised.md` | 254 | 第 2 轮 reviewer 复审报告（9 残留 + 1 计数不一致） |
| 审查报告 3 | `docs/lark-bot-review-report-final.md` | 221 | 第 3 轮 reviewer 最终复审报告（2 边角残留） |
| 审查报告 4 | `docs/lark-bot-review-report-l3.md` | 84 | 第 4 轮 reviewer L3 验证报告（pass） |
| 会话复审 | `docs/lark-bot-session-review.md` | 368 | 第 5 轮 reviewer 内容一致性复审报告（2 实质 + 2 形式残留） |

合计：2794（不含 5 份审查报告）。

**注**：行数随修订变化，以 `wc -l docs/lark-bot-*.md` 为准（上次更新 2026-09-08）。

## 12. 后续工作

### 12.1 第一阶段交付（本 PR 范围）

- 把 `feature/issue-168-arch-analysis` 分支推到 origin
- 创建 PR：`docs: issue #168 PI Agent + lark-bot 架构分析`
- 等待 reviewer review + squash merge

### 12.2 第二阶段切入点（不在本汇总范围）

**建议第二阶段从 PR-1 开始**：

- PR-1 extension 化是其他 PR 的前置依赖
- PR-1 风险最大（消除 spawn PI Agent 子进程），需独立验证
- PR-1 后 PR-2/3/4 互相独立，可按业务优先级选择

### 12.3 估时

待第一阶段 review 后估算（issue #168 明确）。

### 12.4 Skill 修订清单（与 PR-1 / PR-4 配套）

lark-bot 重构涉及两个 skill 修订（同步作为独立 PR 提交）：

#### A. lark-bot-protocol skill 修订（PR-1 + PR-3 落地时）

位置：`agent-src/.pi/skills/lark-bot-protocol/SKILL.md`

| 修订项 | 时机 | 依据 |
|-------|------|------|
| 增加 `task_change` NDJSON 事件说明 | PR-1 | N5 §9.1 提议 |
| 增加 `auth_decision` NDJSON 事件说明 | PR-1 | 决策 4 / N5 §4 |
| 删除 close_session 三处兜底说明 | PR-3 | N4 §5 |
| description 修订：增加 registerTool 调用契约说明 | PR-1 | N3 §5 registerTool 列表 |

#### B. content-pr skill 修订（PR-4 落地时）

位置：`agent-src/.pi/skills/content-pr/SKILL.md`

| 修订项 | 时机 | 依据 |
|-------|------|------|
| 在工作流中说明：从 lark-bot 获取 commitMessage 的 registerTool 调用（`larkbot_commit_changes`） | PR-4 | N4 §6.5 + N5 §6 |
| 明确 LogEntry 转换由 lark-bot 完成，content-pr 只负责 git 操作 | PR-4 | N5 §10 |
| description 修订：增加"接收 lark-bot 提交的 commitMessage" | PR-4 | N5 §6 |

#### C. lark-bot skill（空目录）

位置：`agent-src/.pi/skills/lark-bot/`（当前无 SKILL.md）

状态：未实现。第二阶段启动时确认是否需要新增 skill 作为 lark-bot-extension 的对外文档。

## 13. 引用

### 13.1 第一阶段分析文档

- `docs/lark-bot-business-flow.md`（N1）
- `docs/lark-bot-pi-agent-contract.md`（N2）
- `docs/lark-bot-extension-migration-analysis.md`（N3）
- `docs/lark-bot-migration-roadmap.md`（N4）
- `docs/lark-bot-task-journal-schema.md`（N5）

### 13.2 MVP 设计文档

- `docs/lark-bot-p2p-business-design.md` — 私聊侧 MVP（七阶段生命周期）
- `docs/lark-bot-broadcast-business-design.md` — 鉴权 / 广播业务层职责边界
- `docs/lark-bot-broadcast-tooling-design.md` — 群组工具层设计

### 13.3 lark-bot 代码真源

- `agent-src/.pi/extensions/lark-bot/index.ts` — PI Agent extension 入口
- `agent-src/.pi/scripts/lark-bot/main.ts` — 主进程装配点
- `agent-src/.pi/scripts/lark-bot/process.ts` — 进程级防护（PR-1 删除）
- `agent-src/.pi/scripts/lark-bot/protocol/feishu.ts` — 飞书协议 I/O
- `agent-src/.pi/scripts/lark-bot/identity-resolver.ts` — open_id → user_id（PR-2 激活）
- `agent-src/.pi/scripts/lark-bot/ingress.ts` — 飞书事件入口
- `agent-src/.pi/scripts/lark-bot/business/auth.ts` — 鉴权判定（PR-2 删除 substringMatch）
- `agent-src/.pi/scripts/lark-bot/business/broadcast.ts` — 工作留痕广播
- `agent-src/.pi/scripts/lark-bot/broadcast/group-tool.ts` — 群组 API 适配
- `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` — PI Agent 子进程管理（PR-1 大幅缩减）
- `agent-src/.pi/scripts/lark-bot/interactive/task-state-machine.ts` — 任务状态机（PR-3 简化）
- `agent-src/.pi/scripts/lark-bot/shared/types.ts` — 类型定义
- `agent-src/.pi/scripts/lark-bot/shared/logger.ts` — 日志门面
- `agent-src/.pi/scripts/lark-bot/config.ts` — 配置常量（PR-1 大幅缩减）
- `agent-src/.pi/skills/lark-bot-protocol/SKILL.md` — PI Agent → lark-bot NDJSON 协议

### 13.4 OPERATOR_LOG 模块

- `agent-src/scripts/op-log-schema.ts` — LogEntry / ChangeEntry / generateLog / formatCommitMessage / parseLogFromMessage / validateOperatorPermission / validateLogStructure / OPERATOR_REGISTRY
- `agent-src/scripts/types.ts` — ChangeEntry / LogEntry / OperatorRegistry
- `agent-src/scripts/validate-op-log.ts` — ops CI 校验脚本
- `agent-src/scripts/__tests__/op-log-schema.test.ts` — 单元测试

### 13.5 PI Agent 协议

- `.pi/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — ExtensionAPI / ToolDefinition / ExtensionContext / ExtensionUIContext / 事件类型完整定义
- `.pi/npm/node_modules/@earendil-works/pi-coding-agent/README.md` — Extension API 使用示例
- `package/docs/cross-extension-api.md` — 跨 extension 通信

### 13.6 历史 PR

- PR #159：引入 stdout NDJSON close_session
- PR #160：引入 stdin IPC shutdown（已撤回）
- PR #161：撤回 #160，恢复 #159 stdout NDJSON
- PR #162：SKILL.md 全文 inline 兜底
- PR #163：自然语言关闭会话 + 群组工作留痕广播

### 13.7 引用关系图

```
N6 (本文档，第一阶段汇总)
 ├─ N1 业务流图
 │   ├─ N2 PI Agent 契约盘点
 │   ├─ N3 spawn vs extension 对比
 │   ├─ N4 渐进迁移路线图
 │   └─ N5 任务日志 schema
 └─ 全部引用：
     ├─ lark-bot MVP 设计文档
     ├─ lark-bot 代码真源
     ├─ OPERATOR_LOG 模块
     ├─ PI Agent 协议
     └─ 历史 PR
```
