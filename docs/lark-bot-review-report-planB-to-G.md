# lark-bot 文档方案 B → 方案 G 迁移验证报告（第 10 轮）

## 审查元信息

- 审查轮次：第 10 轮（验证方案 B → 方案 G 修订完整性）
- 修复 commit：e234a21（N4 §3.7）+ 14d5ef3（N6 §2.7 + §3 + §4 + §11）+ 5541a88（N6 §11 SSOT 复审描述补充）
- 审查分支：feature/issue-168-arch-analysis-v3（基于 main + cherry-pick，4 commit）
- 审查时间：2026-09-09
- 审查范围：6 个分析文档（N1 ~ N6）+ 9 份审查报告（第 1 ~ 9 轮 + 第 5 轮会话复审）
- 总体结论：**minor**——6 项显式验证清单全部通过；存在 12 处"次级"内容滞后（PR-1 目标表述保留"消除 PI Agent 子进程层"措辞，与方案 G"保留 spawn"冲突；显式修订位置之外）。

---

## 方案 B 残留扫描

| grep 命中 | 位置 | 是否需要清理 |
|---------|------|------------|
| `假设 ctx.forkOrCreate({ sessionDir })` | `docs/lark-bot-architecture-analysis.md:118`（§2.7 "原方案 B（PR-170）设计错误" 段） | ❌ 否（非残留，是"方案 B 错误说明"上下文） |
| `方案 B（per-chat PI Agent sub-session）的 ctx.forkOrCreate` | `docs/lark-bot-architecture-analysis.md:165`（§3 决策 6 依据列） | ❌ 否（解释为何方案 B 不可落地，正确表述） |
| `原计划使用 ctx.forkOrCreate({ sessionDir })` | `docs/lark-bot-migration-roadmap.md:217`（§3.7 "原方案 B（PR-170）的错误" 段） | ❌ 否（同上） |
| `per-chat PI Agent sub-session` / `subSessions Map` / `ensureSubSession` / `subSessionId` | `docs/lark-bot-review-report-ssot.md`（15+ 处，第 8 轮 SSOT 复审报告） | ❌ 否（历史审计产物，正确描述方案 B 作为参考） |
| 同上 | `docs/lark-bot-review-report-migration.md`（10+ 处，第 9 轮迁移检查报告） | ❌ 否（同上） |

**结论**：6 个分析文档中"方案 B"残留仅出现在 3 处"原方案 B 错误"说明段，均为方案 G 落地的必要上下文，无内容滞后。审查报告中的方案 B 引用是历史审计产物，符合预期。

---

## 方案 G 落地验证表

| # | 验证项 | 状态 | 验证说明 |
|---|--------|------|---------|---|
| 1 | N4 §3.7 飞书 WS 桥接 | ✅ 通过 | `docs/lark-bot-migration-roadmap.md` L209-308（§3.7 全文重写为方案 G）：① L213-218 "原方案 B（PR-170）的错误" 说明块，标注 `ctx.forkOrCreate` API 不存在；② L223-242 方案 G 描述 + MVP 当前实现保留（`spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir])`）；③ L244-260 PR-1 修订路径"不消除 spawn，改为优化 spawn 基础设施"；④ L262-270 module-level 状态（pendingEvents / sessions / taskJournals）；⑤ L272-283 `larkbot_fetch_pending_events` 不接受 chatId 参数、不返回 subSessionId；⑥ L285-293 4 层隔离表（进程 / PI Agent session / 业务状态 / 任务日志，非 5 层）；⑦ L299-308 "为何方案 G 是当前最优解"替代方案表 + "4 项强化措施"风险表 |
| 2 | N6 §2.7 PR-1 后私聊会话隔离层级 | ✅ 通过 | `docs/lark-bot-architecture-analysis.md` L114-156（§2.7 全文重写为方案 G）：① L114 段标题"### 2.7 PR-1 后私聊会话隔离层级（方案 G）"；② L116-122 "原方案 B（PR-170）设计错误" 说明（4 行 blockquote）；③ L124-126 "方案 G（当前采用）"描述保留 MVP 现状；④ L128-133 4 层隔离表（移除原 5 层中的"LLM 上下文隔离"层——已被进程隔离天然实现）；⑤ L135-143 "为何方案 G 是当前最优解"3 行替代方案表 + "方案 G 与 doubao 建议 + PI Agent 官方哲学"一句；⑥ L145-152 4 项强化措施风险表（LLM 错传 chatId / registerTool execute 越界 / OPERATOR_REGISTRY 校验 / 进程级故障） |
| 3 | N6 §3 决策 6 描述 | ✅ 通过 | `docs/lark-bot-architecture-analysis.md` L165 决策 6 行："**方案 G：保留 MVP spawn per-chat PI Agent 进程 + 强化应用层隔离（不消除 spawn）**"；依据列说明"方案 B（per-chat PI Agent sub-session）的 `ctx.forkOrCreate` API 不存在" |
| 4 | N6 §4 PR-1 行修订 | ✅ 通过 | `docs/lark-bot-architecture-analysis.md` L171 PR-1 行："内容" 列 → "**优化 spawn 基础设施**（不消除 spawn）+ extension 化 registerTool"；"关键删除" 列保留 `process.ts` / `handlePiEvent` NDJSON；"关键新增" 列改为 "7 个 `feishu_*` registerTool + 飞书 WS 桥接 + 强化应用层隔离（prompt header / execute 校验）"；"决策" 列改为 "决策 1"（删除原"决策 1 + 决策 6"组合） |
| 5 | N6 §11 行数标注 | ✅ 通过 | `wc -l docs/lark-bot-*.md` 实测：N1=291 / N2=450 / N3=383 / N4=895 / N5=427 / N6=460，合计 2906 行——与 N6 §11 表内标注及"合计：2906"完全一致（实测命令见"审查证据清单"） |
| 6 | N6 §11 SSOT 复审描述 | ✅ 通过 | `docs/lark-bot-architecture-analysis.md` L335 SSOT 复审行描述由 "（minor）" 修订为 "（minor；方案 B 随后被验证为 API 不可落地）" |
| 7 | N1/N2/N3/N5 方案 B 残留 | ✅ 通过 | `grep -rnE "sub-session\|subSessionId\|ensureSubSession\|forkOrCreate"` 在 N1/N2/N3/N5 上返回 0 行；N3 仅 L207/L268/L275 含旧 PR-1 目标表述（见下方"内容滞后清单"） |
| 8 | 审查报告方案 B 描述 | ✅ 通过 | 第 8/9 轮审查报告（`docs/lark-bot-review-report-ssot.md` + `docs/lark-bot-review-report-migration.md`）作为历史审计产物完整保留方案 B 描述，符合"方案 B 是历史正确选择但随后被 API 验证否定"的演进叙事 |

---

## N4 / N6 关键修订验证

### N4 §3.7（e234a21）

- **位置**：`docs/lark-bot-migration-roadmap.md` L209-308
- **关键修改**：
  - L213-218 删除"方案：lark-bot extension 在 session_start 启动...sub-session 句柄..."段，新增"原方案 B（PR-170）的错误" blockquote（5 行）
  - L223-242 新增"方案 G（当前采用）" + MVP 当前实现代码示例（10 行代码块）
  - L244-260 删除原 `ensureSubSession` 函数定义 + `subSessions Map` 缓存代码，新增 PR-1 修订代码段（注释"不消除 spawn，改为优化 spawn 基础设施"）
  - L262-270 module-level 状态从 4 个 Map（pendingEvents / subSessions / sessions / taskJournals）简化为 3 个 Map（pendingEvents / sessions / taskJournals）
  - L272-283 `larkbot_fetch_pending_events` parameters 从 `Type.Object({ chatId })` 改为 `Type.Object({})`，execute 从"返回 `{events, subSessionId: sub.id}`"改为"返回 `{events}`"，增加 `const chatId = ctx.chatId;` 注释
  - L285-293 5 层隔离表改为 4 层（移除"LLM 上下文隔离"行，因"进程隔离"天然实现 LLM 上下文隔离）
  - L295-308 新增"为何方案 G 是当前最优解"3 行替代方案表 + "约束"段（移除原"所有后续 prompt 转发都走 sub.prompt"表述）+ "风险与缓解（4 项强化措施）"表
- **验证结论**：完整重写为方案 G，无残留方案 B 代码示例

### N6 §2.7（14d5ef3）

- **位置**：`docs/lark-bot-architecture-analysis.md` L114-156
- **关键修改**：
  - L114 段标题加上"（方案 G）"
  - L116-122 新增"原方案 B（PR-170）设计错误" blockquote（5 行），引用 `extensions.md` L1074 与 issue #168 comment 5592358044
  - L124-126 新增"方案 G（当前采用）"段（保留 MVP 现状）
  - L128-133 5 层隔离表 → 4 层（移除"PI Agent session 隔离"行作为单独项，因已并入"进程隔离"）
  - L135-143 新增"为何方案 G 是当前最优解"3 行替代方案表
  - L145-152 新增"4 项强化措施（应对 chatId 错传风险）"4 行风险表
- **验证结论**：完整重写为方案 G；4 层隔离机制与 N4 §3.7 字段级一致

### N6 §3 决策 6（14d5ef3）

- **位置**：`docs/lark-bot-architecture-analysis.md` L165
- **关键修改**：
  - 选择列：从 "应用层隔离（module-level Map）+ per-chat PI Agent sub-session" 改为 "**方案 G：保留 MVP spawn per-chat PI Agent 进程 + 强化应用层隔离（不消除 spawn）**"
  - 依据列：从 "避免 LLM 跨 chat 上下文污染（鉴权失效 / 业务错乱 / PR 错误）" 改为 "方案 B（per-chat PI Agent sub-session）的 `ctx.forkOrCreate` API 不存在；PI Agent 推荐 spawn pi instances（README 官方哲学）；与 doubao 建议一致"
- **验证结论**：决策 6 完整迁移至方案 G 描述

### N6 §4 PR 拆分总览（14d5ef3）

- **位置**：`docs/lark-bot-architecture-analysis.md` L171-178
- **关键修改**：
  - L171 PR-1 行"内容" 列：从 "extension 化（消除 PI Agent 子进程层）" 改为 "**优化 spawn 基础设施**（不消除 spawn）+ extension 化 registerTool"
  - L171 PR-1 行"关键删除" 列：保留 `process.ts` / `handlePiEvent` NDJSON
  - L171 PR-1 行"关键新增" 列：从 "7 个 `feishu_*` registerTool + 飞书 WS 桥接 + per-chat sub-session 管理" 改为 "7 个 `feishu_*` registerTool + 飞书 WS 桥接 + 强化应用层隔离（prompt header / execute 校验）"
  - L171 PR-1 行"决策" 列：从 "决策 1 + 决策 6" 改为 "决策 1"（删除"决策 6"，因决策 6 已在选择列体现）
  - L176 新增 "**PR-1 目标修订**" 段：明确说明原计划"消除 PI Agent 子进程层"修订为"优化 spawn 基础设施 + 强化应用层隔离"，引用 `types.d.ts` L246-289
- **验证结论**：PR-1 行完整迁移至方案 G；新增"PR-1 目标修订"段明示修订理由

### N6 §11（14d5ef3 + 5541a88）

- **位置**：`docs/lark-bot-architecture-analysis.md` L319-337
- **关键修改**：
  - L323 N4 行数：从 876 修订为 895（实测 N4=895 ✓）
  - L326 N6 行数：从 430 修订为 460（实测 N6=460 ✓）
  - L335 SSOT 复审行：从 "（minor）" 修订为 "（minor；方案 B 随后被验证为 API 不可落地）"
  - L337 合计行：从 "2857" 修订为 "2906"（实测 291+450+383+895+427+460=2906 ✓）
- **验证结论**：行数标注 100% 与 `wc -l` 实测一致；SSOT 复审描述补充完整

---

## 命名一致性 / 行数一致性 / 数学验证

### 命名一致性（`larkbot_*` / `feishu_*` 前缀）

| 文档 | 飞书 I/O 7 个 | 业务 6 个 | 调试 / 桥接 2 个 | 100% 一致 |
|------|-------------|---------|----------------|----------|
| N4 §2.1-§2.3 | feishu_add_reaction / feishu_remove_reaction / feishu_send_reply / feishu_get_group_info / feishu_list_group_members / feishu_send_group_message / feishu_list_bot_groups | larkbot_list_candidate_groups / larkbot_authorize_user / larkbot_resolve_operator / larkbot_record_change / larkbot_commit_changes / larkbot_close_business_session | larkbot_fetch_pending_events / larkbot_query_journal | ✅ |
| N6 §5.1-§5.3 | 同上 | 同上 | 同上 | ✅ |

合计 15 个 registerTool，命名 100% 合规（无遗漏 `larkbot_` / `feishu_` 前缀）。

### 行数一致性（`wc -l` 实测）

```
$ wc -l docs/lark-bot-business-flow.md docs/lark-bot-pi-agent-contract.md \
         docs/lark-bot-extension-migration-analysis.md docs/lark-bot-migration-roadmap.md \
         docs/lark-bot-task-journal-schema.md docs/lark-bot-architecture-analysis.md
   291 docs/lark-bot-business-flow.md
   450 docs/lark-bot-pi-agent-contract.md
   383 docs/lark-bot-extension-migration-analysis.md
   895 docs/lark-bot-migration-roadmap.md
   427 docs/lark-bot-task-journal-schema.md
   460 docs/lark-bot-architecture-analysis.md
  2906 total
```

| 节点 | N6 §11 标注 | wc -l 实测 | 一致 |
|------|-----------|----------|------|
| N1 business-flow | 291 | 291 | ✅ |
| N2 pi-agent-contract | 450 | 450 | ✅ |
| N3 extension-migration-analysis | 383 | 383 | ✅ |
| N4 migration-roadmap | 895 | 895 | ✅ |
| N5 task-journal-schema | 427 | 427 | ✅ |
| N6 architecture-analysis | 460 | 460 | ✅ |
| **合计** | **2906** | **2906** | ✅ |

### 数学验证

- 6 个分析文档合计：291 + 450 + 383 + 895 + 427 + 460 = **2906** ✅
- 与 N6 §11 L337 "合计：2906（不含 9 份审查报告）" 完全一致
- registerTool 总数：飞书 I/O 7 + 业务 6 + 桥接与调试 2 = **15** ✅
- N4 §2.4 合计：7 + 6 + 1 + 1 = **15** ✅（按"飞书 I/O / 业务 / 调试 / 桥接"4 列拆分）
- N6 §5 合计：7 + 6 + 2 = **15** ✅（按"飞书 I/O / 业务 / 桥接与调试"3 类拆分）

### MVP 兼容性验证

- MVP 当前实现 `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` L467：
  ```typescript
  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], { ... });
  ```
- sessionDir 命名：`sessionKey` 由 `routing.ts` L25 返回 `p2p:${event.chat_id}` → 经 `replace(/:/g, "-")` → sessionDir = `.pi/sessions/bot-p2p-<chatId>/`
- 方案 G 描述 `docs/lark-bot-migration-roadmap.md` L229-232：
  ```typescript
  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
    // sessionDir = .pi/sessions/bot-p2p-<chatId>/
  });
  ```
- **一致性**：✅ 方案 G 描述与 MVP 当前实现的 spawn 模式 + sessionDir 命名完全一致

---

## 内容滞后清单（如有）

| # | 位置 | 滞后描述 | 严重度 |
|---|------|---------|--------|
| L1 | `docs/lark-bot-migration-roadmap.md:19`（§1.1 PR 拆分表） | "PR-1: extension 化（消除 PI Agent 子进程层）"——应改为 "优化 spawn 基础设施 + extension 化" | 中 |
| L2 | `docs/lark-bot-migration-roadmap.md:98`（§3.1 PR-1 目标） | "消除 PI Agent 子进程层（spawn `pi --mode rpc`）；lark-bot 改为 PI Agent 标准 extension"——应改为 "保留 MVP spawn per-chat PI Agent 进程 + 优化基础设施" | 中 |
| L3 | `docs/lark-bot-migration-roadmap.md:106`（§3.2 删除项） | "`session-manager.ts` `spawnPiProcess` / `spawnPromises` / `piRestartState`" 列为删除项——方案 G 保留 session-manager.ts 的 spawn 基础设施（虽大幅缩减），不应完整删除 | 中 |
| L4 | `docs/lark-bot-migration-roadmap.md:116`（§3.3 保留项） | "ingress.ts 飞书事件 → LLM 决策桥接（不再 spawn PI Agent）"——与方案 G"保留 spawn"语义不一致（ingress.ts 确实不直接 spawn PI Agent，但表达易引起歧义） | 低 |
| L5 | `docs/lark-bot-migration-roadmap.md:318`（§3.8 测试覆盖） | "回归测试 | `spawn 'pi --mode rpc'` 调用次数 = 0"——方案 G 保留 spawn 调用，应改为 "调用次数 ≥ 1（per-chat）"或删除 | 中 |
| L6 | `docs/lark-bot-migration-roadmap.md:786`（§7.2 feature flag 表） | "`larkBot.useExtensionMode` | 是否启用 extension 模式（vs spawn 模式）"——方案 G 下 spawn 是新模式，feature flag 表述应改为"是否启用方案 G per-chat spawn 模式（vs 旧 spawn 模式）" | 低 |
| L7 | `docs/lark-bot-extension-migration-analysis.md:207`（§5.3 删除项表） | "`session-manager.ts spawnPiProcess` | **删除**（不 spawn PI Agent）"——方案 G 保留 spawn | 中 |
| L8 | `docs/lark-bot-extension-migration-analysis.md:268`（§6.4 PR 拆分表） | "PR-1 | extension 化（消除 PI Agent 子进程层）"——同 L1 | 中 |
| L9 | `docs/lark-bot-extension-migration-analysis.md:275`（§6.4 可观察性） | "PR-1：进程数从 N+2 减到 N+1（PI Agent 子进程消失）；spawn `pi --mode rpc` 调用次数 = 0"——方案 G 下进程数 N 不变（per-chat subprocess），spawn 调用次数 ≥ 1 | 中 |
| L10 | `docs/lark-bot-extension-migration-analysis.md:304-309`（§7.3 飞书 WS 桥接） | 描述方案 B 风格桥接（"若对应 chat_id 已有 active session → 把事件作为 LLM 上下文注入"）——方案 G 下每个 chat 都有独立 PI Agent subprocess，需要重写为"pendingEvents Map<chatId> 路由 → LLM 拉取时按 chatId 隔离" | 中 |
| L11 | `docs/lark-bot-architecture-analysis.md:79`（§2.5 架构对比结论） | "PI Agent 子进程层可消除（与 extension host 合一）"——方案 G 下 PI Agent 子进程层不可消除，per-chat subprocess 必须保留 | 中 |
| L12 | `docs/lark-bot-architecture-analysis.md:352`（§12.2 第二阶段切入点） | "PR-1 风险最大（消除 spawn PI Agent 子进程），需独立验证"——方案 G 下 PR-1 不消除 spawn，风险描述应改为"PR-1 风险最大（保留 spawn + 强化应用层隔离，需验证 registerTool execute chatId 隔离正确性）" | 中 |

**总计 12 处**内容滞后，均属于"PR-1 目标表述"在显式修订位置（§2.7 / §3 / §4 / §3.7）之外的残留措辞，不影响 §2.7 / §3.7 中方案 G 核心描述的正确性，但会造成文档内部矛盾（例如 N4 §3.1 与 §3.7 自相矛盾）。

---

## 通过项

### 显式验证清单（6 项全部通过）

1. ✅ N4 §3.7 飞书 WS 桥接完整重写为方案 G
2. ✅ N6 §2.7 PR-1 后私聊会话隔离层级完整重写为方案 G
3. ✅ N6 §3 决策 6 描述准确（方案 G）
4. ✅ N6 §4 PR-1 行修订准确（"优化 spawn 基础设施" + "强化应用层隔离" + "决策 1"）
5. ✅ N6 §11 行数标注与 `wc -l` 100% 一致（合计 2906）
6. ✅ N6 §11 SSOT 复审描述补充"方案 B 随后被验证为 API 不可落地"

### 内容迁移验证（全部通过）

- ✅ 方案 B 残留扫描：6 个分析文档仅在 3 处"原方案 B 错误"说明段命中，均为方案 G 必要上下文
- ✅ 方案 G 关键词落地：N4 + N6 中"方案 G" / "保留 MVP spawn" / "每 chat 一个 PI Agent 子进程" / "spawn --session-dir" 均到位
- ✅ 命名一致性：15 个 registerTool 100% 合规（`larkbot_*` / `feishu_*` 前缀无遗漏）
- ✅ 数学验证：6 文档合计 2906 与 §11 标注一致
- ✅ MVP 兼容性：方案 G 描述的 spawn 模式与 `session-manager.ts` L467-471 + `routing.ts` L25 一致
- ✅ 审查报告保留：第 8/9 轮报告完整保留方案 B 作为历史审计产物（符合"方案 B 随后被验证为 API 不可落地"的演进叙事）

### registerTool 契约验证

- ✅ 飞书 I/O 7 个（PR-1）：N4 §2.1 L57-65 + §3.6 L172-204 完整契约
- ✅ 业务 6 个（PR-2 + PR-4）：N4 §2.2 L70-73 + §2.3 L78-82 + §4.5 L372-415 + §6.5 L562-645 完整契约
- ✅ 桥接与调试 2 个：N4 §2.1 L66 `larkbot_fetch_pending_events` + §3.7 L272-283 完整契约 + §6.5 L632-643 `larkbot_query_journal` 完整契约
- ✅ 总数 15 = 7 + 6 + 2（N6 §5）/ 7 + 6 + 1 + 1（N4 §2.4）双口径一致

**注**：验证清单假设"`larkbot_fetch_pending_events` 因为方案 G 不再是 registerTool"是错误的——方案 G 下 `larkbot_fetch_pending_events` 仍是 registerTool（仅 parameters 改为 `Type.Object({})`，execute 返回 `{events}` 而非 `{events, subSessionId}`）。实际总数仍为 15。

---

## 总结

### 总体评价

**minor**——3 个修复 commit（e234a21 + 14d5ef3 + 5541a88）完整落地方案 B → 方案 G 修订的核心目标：

- ✅ N4 §3.7 + N6 §2.7 两处核心方案描述完整重写（保留 MVP spawn + 强化应用层隔离）
- ✅ N6 §3 决策 6 + §4 PR-1 行 + §11 行数标注 + §11 SSOT 复审描述全部同步更新
- ✅ 6 文档行数 100% 与 `wc -l` 一致（合计 2906）
- ✅ registerTool 15 个契约完整，命名 100% 合规
- ✅ MVP 兼容性已验证（session-manager.ts L467-471 + routing.ts L25）

### 是否所有文档已完整迁移至方案 G

**部分**：核心位置（§2.7 / §3 / §4 / §11 / §3.7）已完整迁移，但 12 处"次级"位置（§1.1 / §3.1 / §3.2 / §3.3 / §3.8 / §5.3 / §6.4 / §7.3 / §2.5 / §12.2 + feature flag 表）仍残留"消除 PI Agent 子进程层"措辞，与方案 G"保留 spawn"语义不一致。

**建议**：本 PR 合并前修复 12 处内容滞后项；或合并后作为 PR-1 文档清理跟进项另开小 PR 修复（不阻塞主 PR review）。

### 遗留项

| # | 项 | 优先级 |
|---|-----|--------|
| R1 | 修复 N4 §1.1 / §3.1 / §3.2 / §3.3 / §3.8 / §7.2 共 6 处 PR-1 目标表述 | 中 |
| R2 | 修复 N3 §5.3 / §6.4 / §7.3 共 3 处 spawn 删除/桥接描述 | 中 |
| R3 | 修复 N6 §2.5 / §12.2 共 2 处架构对比结论与第二阶段切入点表述 | 中 |
| R4 | 审查报告（第 8/9 轮）作为历史审计产物保留方案 B 描述，无需修订 | — |

### 是否可推 origin

**条件性可推**：

- **可推（如审查策略允许 minor 级合并）**：6 项显式验证清单全部通过，方案 G 核心描述完整；12 处内容滞后不影响审查者理解方案 G 核心思想（§2.7 + §3.7 是核心权威描述）。
- **建议先修复（如审查策略要求 0 内容滞后）**：12 处"消除 PI Agent 子进程层"措辞会造成文档内部自相矛盾（§3.1 说"消除" + §3.7 说"保留"），审查者可能困惑。建议至少修复 L1 / L2 / L7 / L8 / L11 / L12 共 6 处"目标/结论"层面的措辞，测试/feature flag 层面（L4 / L5 / L6）的修复可后置。

---

## 审查证据清单

### 实际读取的文档（15 个）

1. `docs/lark-bot-business-flow.md`（N1，291 行）
2. `docs/lark-bot-pi-agent-contract.md`（N2，450 行）
3. `docs/lark-bot-extension-migration-analysis.md`（N3，383 行）
4. `docs/lark-bot-migration-roadmap.md`（N4，895 行，重点）
5. `docs/lark-bot-task-journal-schema.md`（N5，427 行）
6. `docs/lark-bot-architecture-analysis.md`（N6，460 行，重点）
7. `docs/lark-bot-review-report.md`（第 1 轮）
8. `docs/lark-bot-review-report-revised.md`（第 2 轮）
9. `docs/lark-bot-review-report-final.md`（第 3 轮）
10. `docs/lark-bot-review-report-l3.md`（第 4 轮）
11. `docs/lark-bot-session-review.md`（第 5 轮会话复审）
12. `docs/lark-bot-review-report-session.md`（第 6 轮）
13. `docs/lark-bot-review-report-linecount.md`（第 7 轮行数专项）
14. `docs/lark-bot-review-report-ssot.md`（第 8 轮 SSOT 复审）
15. `docs/lark-bot-review-report-migration.md`（第 9 轮内容迁移检查）

### git 命令

```bash
$ git log --oneline -10
5541a88 docs(lark-bot): N6 §11 SSOT 复审描述补充'方案 B 随后被验证为 API 不可落地'
14d5ef3 docs(lark-bot): N6 §2.7 + §3 + §4 + §11 方案 B → 方案 G 修订
e234a21 docs(lark-bot): N4 §3.7 方案 B → 方案 G 修订
daf01f3 docs(lark-bot): issue #168 第二阶段修订 - 方案 B 会话隔离 + 第 8/9 轮复审 (#170)
c622e3a docs: issue #168 PI Agent + lark-bot 架构分析 (#169)
...

$ git diff main..feature/issue-168-arch-analysis-v3 --stat
 docs/lark-bot-architecture-analysis.md |  56 ++++++++++++----
 docs/lark-bot-migration-roadmap.md     | 119 +++++++++++++++++++--------------
 2 files changed, 111 insertions(+), 64 deletions(-)

$ git status
On branch feature/issue-168-arch-analysis-v3
nothing to commit, working tree clean
```

### grep 输出（关键命令）

```bash
# 方案 B 残留扫描
$ grep -rnE "ensureSubSession|forkOrCreate|subSessionId|per-chat PI Agent sub-session|per-chat sub-session" docs/
docs/lark-bot-architecture-analysis.md:118:> 假设 `ctx.forkOrCreate({ sessionDir })` 创建 per-chat sub-session，但该 API **不存在**。
docs/lark-bot-architecture-analysis.md:165:| 6 | 私聊会话隔离 | **方案 G：保留 MVP spawn per-chat PI Agent 进程 + 强化应用层隔离（不消除 spawn）** | 方案 B（per-chat PI Agent sub-session）的 `ctx.forkOrCreate` API 不存在...
docs/lark-bot-migration-roadmap.md:217:> 原计划使用 `ctx.forkOrCreate({ sessionDir })` API 创建 per-chat sub-session，但该 API **不存在**。
docs/lark-bot-review-report-migration.md + docs/lark-bot-review-report-ssot.md:
  （15+ 处审查报告历史引用，按预期）

# 方案 G 关键词
$ grep -rnE "方案 G|保留 MVP spawn|每 chat 一个 PI Agent 子进程|spawn.*--session-dir" docs/
docs/lark-bot-architecture-analysis.md:114/124/126/130/135/143/165: 7 处
docs/lark-bot-migration-roadmap.md:223/225/230/277/282/290: 6 处
docs/lark-bot-pi-agent-contract.md:162: 1 处（MVP 当前实现描述，与方案 G 一致）

# N1/N2/N3/N5 方案 B 残留扫描
$ grep -rn "sub-session|subSessionId|ensureSubSession|forkOrCreate" docs/lark-bot-business-flow.md docs/lark-bot-pi-agent-contract.md docs/lark-bot-extension-migration-analysis.md docs/lark-bot-task-journal-schema.md
（仅 N3 §5.3 / §6.4 命中旧 PR-1 目标表述，无方案 B 代码残留）

# registerTool 命名
$ grep -nE "name: \"(feishu_|larkbot_)" docs/lark-bot-migration-roadmap.md
10 处命中（2 个 feishu_ 契约 + 8 个 larkbot_ 契约 = 10 个具名契约；其余 5 个以"// ... 其他 N 个"形式省略）

# 决策 6 描述
$ grep -n "决策 6" docs/lark-bot-architecture-analysis.md
165:| 6 | 私聊会话隔离 | **方案 G：保留 MVP spawn per-chat PI Agent 进程 + 强化应用层隔离（不消除 spawn）** | ...

# PR-1 行修订
$ grep -n "PR-1.*优化\|PR-1.*spawn\|PR-1.*sub-session" docs/lark-bot-architecture-analysis.md
171:| **PR-1** | **优化 spawn 基础设施**（不消除 spawn）+ extension 化 registerTool | ...
176:**PR-1 目标修订**：原计划"消除 PI Agent 子进程层"修订为"优化 spawn 基础设施 + 强化应用层隔离"。
```

### wc -l 实测值

```
$ wc -l docs/lark-bot-{business-flow,pi-agent-contract,extension-migration-analysis,migration-roadmap,task-journal-schema,architecture-analysis}.md
   291 docs/lark-bot-business-flow.md
   450 docs/lark-bot-pi-agent-contract.md
   383 docs/lark-bot-extension-migration-analysis.md
   895 docs/lark-bot-migration-roadmap.md
   427 docs/lark-bot-task-journal-schema.md
   460 docs/lark-bot-architecture-analysis.md
  2906 total
```

数学验证：291 + 450 + 383 + 895 + 427 + 460 = **2906** ✅（与 N6 §11 L337 "合计：2906" 一致）

### MVP 代码引用

- `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` L467：
  ```typescript
  pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], { ... });
  ```
- `agent-src/.pi/scripts/lark-bot/routing.ts` L25：
  ```typescript
  export function sessionKey(event: LarkEvent): string {
    if (event.chat_type === "p2p") return `p2p:${event.chat_id}`;
    ...
  }
  ```

sessionDir 命名链路：`sessionKey = "p2p:<chatId>"` → `replace(/:/g, "-")` → `bot-p2p-<chatId>`，与方案 G 文档描述完全一致。

---

**审查结论**：第 10 轮方案 B → 方案 G 迁移验证，**总体 minor**——6 项显式验证清单全部通过，方案 G 核心描述完整落地；12 处"次级"内容滞后需后续清理。是否可推 origin 视审查策略而定（minor 级可推 / 严格级建议先修）。