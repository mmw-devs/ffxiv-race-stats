# lark-bot 文档一致性审查报告

## 审查元信息

- 审查范围：feature/issue-168-arch-analysis 分支 11 个 commit（bb50c1f → 22b75bb）
- 审查文档：N1 ~ N6 共 6 个
  - N1: `docs/lark-bot-business-flow.md`（实际 291 行 / N6 标注 226 行）
  - N2: `docs/lark-bot-pi-agent-contract.md`（实际 450 行 / N6 标注 450 行 ✓）
  - N3: `docs/lark-bot-extension-migration-analysis.md`（实际 383 行 / N6 标注 383 行 ✓）
  - N4: `docs/lark-bot-migration-roadmap.md`（实际 828 行 / N6 标注 736 行）
  - N5: `docs/lark-bot-task-journal-schema.md`（实际 397 行 / N6 标注 342 行）
  - N6: `docs/lark-bot-architecture-analysis.md`（实际 402 行 / N6 未标注）
- 修订重点（最近 4 个 commit）：
  - 919c0d3：拆分 `larkbot_commit_changes` 与 `larkbot_close_business_session`（buffer → LogEntry 转换职责迁移）
  - 3945881：TaskJournal 生命周期阶段标记
  - f12fe55：业务流图拆分提交 PR / 结束任务两个分支
  - 22b75bb：第一阶段汇总补充任务日志对象边界 + Skill 修订清单
- 审查时间：2026-09-08
- 审查维度：10 个（仅表述一致性，不审查内容正确性）
- 总体结论：**major** — 多处高优先级不一致，主要由 919c0d3 拆分后未全局同步导致

---

## 不一致清单

### 高优先级（必须修复）

#### H1. `registerTool` 转换时机在 N5 内部自相矛盾，且与 N4 不一致
- **位置**：
  - N4 `docs/lark-bot-migration-roadmap.md` §6.5 lines 525–535（`larkbot_commit_changes` execute 步骤）
  - N4 §6.8 lines 668–680（双写策略）
  - N5 `docs/lark-bot-task-journal-schema.md` §4 lines 124–150（"转换发生在 `close_business_session` registerTool 调用时"）
  - N5 §8 lines 262–272（"close_business_session 触发时：1. task_journal → LogEntry 转换 … audit journal 写一条 {state:'awaiting_review', …}"）
  - N5 §10 lines 322–328（"业务会话中 LLM 调 `larkbot_commit_changes({shortDesc})` → buffer → LogEntry 转换 …"）
  - N5 §5 stateDiagram line 178（"累积中 → 已提交: commit_changes … buffer → LogEntry → commitMessage 返回 …"）
- **类型**：内容位置冲突（同一文档内部 + 跨文档）
- **当前描述**：
  - N4 主张：`buffer → LogEntry` 转换在 `larkbot_commit_changes` 调用时发生；`close_business_session` 仅 cleanup + ended 广播
  - N5 §4 / §8 主张：转换在 `close_business_session` 调用时发生（§4 原文："转换发生在 `close_business_session` registerTool 调用时"；§8 步骤 1）
  - N5 §5 / §10 主张：转换在 `commit_changes` 时发生（§5 状态图、§10 集成路径）
- **应统一为**：以 N4 §6.5 + 919c0d3 拆分意图为准——转换发生在 `larkbot_commit_changes`；`close_business_session` 不做 LogEntry 转换，仅 cleanup + ended 广播。修订 N5 §4 描述 + §8 步骤 1 + §8 步骤 2 写入时机。

#### H2. audit journal `awaiting_review` 写入时机在 N4 vs N5 矛盾
- **位置**：
  - N4 §6.5 line 533（`larkbot_commit_changes` 步骤 7）：`emitTaskJournal({state: 'awaiting_review', shortDesc, changesCount})`
  - N4 §6.8 lines 668–680（双写策略）：`larkbot_commit_changes` 时写 awaiting_review；`close_business_session` 时写 terminated
  - N5 §8 line 267（双写策略）：`close_business_session 触发时：… audit journal 写一条 {state:'awaiting_review', subject, changes.length}`
- **类型**：跨文档行为冲突
- **当前描述**：
  - N4 主张：awaiting_review 在 commit_changes 写入
  - N5 主张：awaiting_review 在 close_business_session 写入
- **应统一为**：以 N4 为准——awaiting_review 在 `larkbot_commit_changes` 成功时写入；`close_business_session` 仅写 terminated。修订 N5 §8 双写策略块。

#### H3. registerTool 总数与"修订后 = 14"目标不符（N6 §5 自相矛盾）
- **位置**：
  - N6 `docs/lark-bot-architecture-analysis.md` §5 line 134 标题：`registerTool 清单（13 个）`
  - N6 §5.1 line 136（"飞书 I/O（PR-1，7 个）"）实际列 7 个
  - N6 §5.2 line 142（"业务（PR-2 + PR-4，6 个）"）实际列 6 个（含 `larkbot_commit_changes`）
  - N6 §5.3 line 166 标题：`桥接与调试（1 个）`——但表内实际列 2 个（`larkbot_fetch_pending_events` / `larkbot_query_journal`）
- **类型**：标题与表格内部 + 修订目标值不符
- **当前描述**：
  - 标题合计 "13 个"，但 7 + 6 + 1（调试） = 14，7 + 6 + 2（含桥接）= 15，标题数值与表格不符
  - 修订后目标（任务描述明确）：14 = 7 飞书 I/O + 6 业务 + 1 调试；`larkbot_fetch_pending_events` 不计入总数
  - N6 §5.3 标题"1 个"与表中 2 个不一致
- **应统一为**：
  - §5 标题 → `registerTool 清单（14 个）`
  - §5.3 标题 → `调试（1 个）`（移除桥接工具，单独 §5.4 描述 `larkbot_fetch_pending_events`），或将桥接作为附注
  - 或将 `larkbot_fetch_pending_events` 归入 §5.1 飞书 I/O（8 个），业务 6 个，调试 1 个，标题 15 个；选择哪种取决于该工具的归属分类（需人工裁决）

#### H4. N4 registerTool 总数表与 §6.5 契约不自洽
- **位置**：
  - N4 §2.3 lines 79–81（PR-4 registerTool 清单）：列 3 个（`larkbot_record_change` / `larkbot_close_business_session` / `larkbot_query_journal`）
  - N4 §2.4 line 89（PR-4 合计行）：`0 | 2 | 1`（业务 2 + 调试 1）
  - N4 §2.4 line 90（合计行）：`7 | 5 | 1` → 13
  - N4 §6.4 line 489–492（PR-4 新增项）：列 3 个 registerTool（`larkbot_record_change` / `larkbot_close_business_session` / `larkbot_query_journal`）+ 转换函数 `closeBusinessSession`
  - N4 §6.5 lines 515–562（PR-4 registerTool 契约）：实际描述 4 个契约（`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_query_journal`）
- **类型**：同文档章节不自洽
- **当前描述**：§2.3 / §2.4 / §6.4 漏列 `larkbot_commit_changes`，§6.5 包含 `larkbot_commit_changes`；§2.4 合计数 13 与 §6.5 实际数 14（含 `larkbot_commit_changes`）不符
- **应统一为**：
  - §2.3 PR-4 表增列 `larkbot_commit_changes`（业务）
  - §2.4 PR-4 行改为 `0 | 3 | 1`，合计改为 `7 | 6 | 1` = 14
  - §6.4 新增项增列 `larkbot_commit_changes`；转换函数注释需注明归属 `larkbot_commit_changes` 内部（不是 `closeBusinessSession`）

#### H5. N1 registerTool 名称多处缺 `larkbot_` 前缀（与 N4/N5/N6 不一致）
- **位置**：
  - N1 §3 line 71：`LB->>A: authorize_user 决策<br/>(registerTool，PR-2 落地)`
  - N1 §3 line 79：`A->>LB: registerTool('record_change', {field, from, to})`
  - N1 §3 line 85：`A->>LB: commit_changes({shortDesc})`
  - N1 §3 line 92：`A->>LB: close_business_session`
  - N1 §6.1 line 162：`S5[record_change<br/>append ChangeEntry]`
  - N1 §6.1 line 166：`Done --> Commit{commit_changes?}`
  - N1 §6.1 line 176：`Done --> Close{close_business_session?}`
  - N5 §6.3 line 229：`N4 registerTool \`authorize_user\``（缺前缀）
  - N5 §6.3 line 231：`决策后调 \`authorize_user({openId, chatId})\``（缺前缀）
  - N5 §6.3 line 232：`lark-bot 在 authorize_user 内部调用`（缺前缀）
  - N5 §12 line 383：`\`authorize_user\` registerTool 是 PR-2 范围`（缺前缀）
  - N1 §6.2 line 190：`larkbot_record_change`（带前缀，与同一文档 §3 / §6.1 不一致）
- **类型**：命名风格不一致
- **当前描述**：N1 §3 / §6.1 与 N5 §6.3 / §12 在 registerTool 引用时部分省略 `larkbot_` 前缀，与 N4 §6.5 / N6 §5.2 等使用全名的位置不一致
- **应统一为**：所有 registerTool 引用统一加 `larkbot_` 前缀（即 `larkbot_authorize_user` / `larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session`）

#### H6. feature flag 列表在 N4 vs N6 不一致（`commitOnClose` 是否纳入）
- **位置**：
  - N4 §7.2 lines 720–723（feature flag 总表）：列 4 个（`useExtensionMode` / `useAgentMatcher` / `useNaturalLanguageClose` / `enableTaskJournal`）
  - N4 §8 line 749（回滚方案汇总）：PR-4 仅列 `enableTaskJournal`
  - N6 §6 lines 178–183（feature flag 总表）：列 5 个（多 `commitOnClose`）
  - N6 §6 lines 188–195（settings.json 示例）：仅含 4 个（无 `commitOnClose`）
  - N4 §10 line 783（新增风险）："`4 个 flag 是 MVP 上限`"
- **类型**：跨文档枚举不一致
- **当前描述**：
  - N4 与 N6 总表数量不同（4 vs 5）
  - N6 标题/总表与示例块不一致（5 vs 4）
  - N4 §10 "MVP 上限 = 4" 已不再成立（若 commitOnClose 入表）
- **应统一为**：选定一组（4 或 5），同步：
  - N4 §7.2、N4 §8、N4 §10
  - N6 §6 标题与示例块
  - 若选 5：N6 §6 标题改为 `feature flag 总表（5 个）`，示例补 `commitOnClose: false`；N4 §10 "MVP 上限" 改为 5
  - 若选 4：删除 N6 §6 表中 `commitOnClose` 行（N6 是 22b75bb 新增行，需评估是否回退）
  - **建议人工裁决**：5 flag 方案与任务描述一致（task 明确说"5 个 feature flag"），应取 5

---

### 中优先级（建议修复）

#### M1. N5 生命周期阶段命名与其他文档不一致
- **位置**：
  - N1 §6.1 lines 152–186：`创建阶段` / `累积阶段` / `提交阶段` / `销毁阶段`
  - N1 §6.2 lines 187–192（表格）：`创建` / `累积` / `提交` / `销毁`
  - N5 §2 JSDoc lines 35–38：`创建` / `累积` / `提交` / `销毁`
  - N5 §5 文字 lines 159–160：`四个生命周期阶段：创建 / 累积 / 提交 / 销毁`
  - N5 §5 stateDiagram lines 174–186：使用 `初始化` / `累积中` / `已提交` / `已关闭` / `已清理` / `立即清理`（命名完全不同的第二套）
  - N6 §2.6 lines 95–99：表格 `创建` / `销毁` / `提交`（无累积）
- **类型**：术语命名不一致
- **当前描述**：N5 文字与表格使用"创建/累积/提交/销毁"四阶段；N5 §5 stateDiagram 使用"初始化/累积中/已提交/已关闭"另一套命名；N6 §2.6 表格遗漏"累积"
- **应统一为**：
  - 选定 1 套主术语，建议保留"创建 / 累积 / 提交 / 销毁"（文字、表格、JSDoc 已在用）
  - N5 §5 stateDiagram 节点名同步为 `创建` / `累积` / `提交` / `销毁`（保留 `已清理` 与 `立即清理` 作为 销毁 的子状态）
  - N6 §2.6 表格补充 `累积` 行

#### M2. N4 §2.3 中 `larkbot_close_business_session` 描述与 919c0d3 拆分后职责不符
- **位置**：N4 §2.3 line 80
- **类型**：描述内容过期（拆分后未同步）
- **当前描述**：`larkbot_close_business_session | 无 | buffer → LogEntry 转换 + 触发 ended 广播`
- **应统一为**：`larkbot_close_business_session | 无 | cleanupSessionForClose 六步 + ended 广播（buffer 删除）；LogEntry 转换由 larkbot_commit_changes 负责`

#### M3. N4 §6.4 转换函数命名与拆分后职责不符
- **位置**：N4 §6.4 line 492
- **类型**：函数命名过期
- **当前描述**：`转换函数 | taskJournalToLogEntry 与 closeBusinessSession`
- **应统一为**：`转换函数 | taskJournalToLogEntry（larkbot_commit_changes 内部）`；删除 `closeBusinessSession` 引用或注明已被拆分（保留函数名待 PR-4 决定）

#### M4. N5 §4 代码示例与拆分后 registerTool 设计不符
- **位置**：N5 §4 lines 124–150
- **类型**：代码示例过期（仍是拆分前的旧契约）
- **当前描述**：
  - §4 文字："转换发生在 `close_business_session` registerTool 调用时"
  - §4 代码：`function closeBusinessSession(journal, shortDesc) { return {logEntry, commitMessage} }`
- **应统一为**：
  - §4 文字改为："转换发生在 `larkbot_commit_changes` registerTool 调用时"
  - §4 代码改为：`function commitChanges(journal, shortDesc) { ... }`，与 N4 §6.5 契约一致
  - §4 失败处理注释改为："lark-bot 拒绝 commit_changes + 提示用户"

#### M5. N5 §7 失败模式"changes 为空不允许关闭"与拆分后契约冲突
- **位置**：N5 §7 line 242
- **类型**：行为约束过期
- **当前描述**：
  - N5 §7：`task_journal.changes 为空 | close_business_session 调用时 | 不允许关闭（validateLogStructure 校验 changes 非空）`
  - N4 §6.5 line 543（注释）：`不强制 changes 非空（关闭会话与提交 PR 是两个事件）`
  - N6 §5.2 line 164：`larkbot_close_business_session 不强制 changes 非空`
- **应统一为**：以 N4 §6.5 + N6 §5.2 为准——`larkbot_close_business_session` 不校验 changes 非空（"无变更关闭"是合法场景）。修订 N5 §7 该行。

#### M6. audit journal state 字段命名/计数命名不统一
- **位置**：
  - N4 §6.5 line 533：`{state: 'awaiting_review', shortDesc, changesCount}`
  - N4 §6.8 line 671：`{state: 'awaiting_review', shortDesc, changesCount}`
  - N5 §8 line 267：`{state:'awaiting_review', subject, changes.length}`
  - N5 §7 lines 244–245：`pr_submit_failed` / `operator_resolution_failed`（作为 reason 标记，但格式与 state 字段混淆）
  - N5 §8 line 272：`{state:'terminated', reason:'pr_rejected', pr_url}`
- **类型**：字段命名 + state 取值约定混乱
- **当前描述**：
  - 同一字段在不同文档叫 `changesCount`（N4）与 `changes.length`（N5）
  - `pr_submit_failed` / `operator_resolution_failed` 既可能是 reason 也可能被误读为 state 取值
  - `terminated` 在 N4 §6.8 用于 close_business_session，在 N5 §8 又用于 PR rejected
- **应统一为**：
  - 选定一个字段名（建议 `changesCount` 沿用 N4 命名），统一所有文档
  - 明确约定：state 取值仅来自限定集合（建议：`in_progress` / `awaiting_review` / `post_review` / `terminated`），其他状态通过 `reason` 字段表达
  - `terminated` 不同时用于"会话关闭"和"PR 拒绝"——区分 reason（`'session_closed'` vs `'pr_rejected'`）

#### M7. 任务要求审计 state 字段 `pre_business` / `in_progress` 未在任何文档出现
- **位置**：任务描述维度 9 列出 5 个 state：`pre_business / in_progress / awaiting_review / post_review / terminated`
- **类型**：state 字段不完整
- **当前描述**：
  - `awaiting_review`：N4 §6.5 / §6.8、N5 §8 有
  - `post_review`：仅 N5 §8 有
  - `terminated`：N4 §6.8、N5 §7 / §8 有
  - `pre_business` / `in_progress`：**未在任何 N1~N6 文档出现**
- **应统一为**：要么补齐 `pre_business`（buffer 启动时）/ `in_progress`（累积阶段）的 emit 时机定义，要么在审查报告中标注"需要人工裁决——任务描述列出的 5 state 是否全部需要落地"。建议至少在 §5 / §6 状态图上明确这两个 state 的写入时机。

#### M8. N6 §4 PR 拆分表的 PR-4 关键新增漏列 `larkbot_commit_changes`
- **位置**：
  - N6 §4 line 130：`PR-4 关键新增: larkbot_record_change / larkbot_close_business_session / larkbot_query_journal`（3 个）
  - N6 §5.2 line 156：业务工具表列出 6 个（含 `larkbot_commit_changes`）
  - N4 §6.5：4 个 PR-4 registerTool（含 `larkbot_commit_changes`）
  - N3 §6.4 line 271：`larkbot_record_change + larkbot_close_business_session + task_journal buffer + LogEntry 转换`（漏列 `larkbot_commit_changes` 与 `larkbot_query_journal`）
- **类型**：PR-4 关键新增/保留列表不一致
- **当前描述**：
  - N6 §4 PR-4 关键新增漏列 `larkbot_commit_changes`
  - N3 §6.4 PR-4 保留漏列 `larkbot_commit_changes` 与 `larkbot_query_journal`
- **应统一为**：PR-4 关键新增应列 4 个：`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_query_journal`

#### M9. 术语"提交 PR / 提交业务变更 / commit_changes"在不同文档混用
- **位置**：
  - N1 §3 line 84（sequenceDiagram alt 分支）：`else 提交 PR（不关闭会话）`
  - N1 §6.2 line 191（表格）：`提交 | buffer → LogEntry 转换 / 生成 commitMessage`
  - N4 §6.5 line 521（label）：`提交业务变更（生成 commit message）`
  - N4 §6.7 line 600（场景 A）：`场景 A：提交 PR（不关闭会话）`
  - N4 §6.7 line 603（步骤）：`用户想提交当前业务变更`
  - N6 §5.2 line 161：`larkbot_commit_changes 与 larkbot_close_business_session 不联动`
- **类型**：术语风格不一致
- **当前描述**：同一动作有"提交 PR / 提交业务变更 / commit_changes / commit message 生成"等多种表述
- **应统一为**：选定一个主术语（建议 `提交 PR`），其余作为同义引用；registerTool 名称统一加 `larkbot_` 前缀

#### M10. 术语"关闭会话 / 结束任务 / close_business_session / 关闭业务私聊会话"在不同文档混用
- **位置**：
  - N1 §3 line 91：`else 结束任务（不提交 PR）`
  - N1 §3 line 33（stateDiagram）：`业务执行 --> 业务结束: Agent 调 close_business_session 或 /quit / 自然语言"结束"`
  - N1 §3 line 95：`A->>FS: sendReply("任务已结束")`
  - N4 §6.5 line 546（label）：`关闭业务私聊会话`
  - N4 §6.7 line 618（场景 B）：`场景 B：结束任务（不提交 PR）`
  - N4 §6.7 line 626：`任务已结束`
  - N6 §5.2 line 164：`larkbot_close_business_session 不强制 changes 非空——会话关闭与提交 PR 是两个事件`
- **类型**：术语风格不一致
- **当前描述**：同一动作有"关闭会话 / 结束任务 / close_business_session / 关闭业务私聊会话 / 业务结束"等多种表述
- **应统一为**：选定一个主术语（建议 `结束任务` 业务侧、`关闭会话` 实现侧），其余作同义引用；registerTool 名称统一加 `larkbot_` 前缀

#### M11. N6 §11 文档清单行数标注与实际不一致
- **位置**：N6 §11 lines 232–240（"文档清单"表）
- **类型**：文档元信息错误
- **当前描述**：
  - N1：标注 226 行 / 实际 291 行（差 65）
  - N2：标注 450 行 / 实际 450 行 ✓
  - N3：标注 383 行 / 实际 383 行 ✓
  - N4：标注 736 行 / 实际 828 行（差 92）
  - N5：标注 342 行 / 实际 397 行（差 55）
  - 合计：标注 2137 / 实际 2749（差 612）
- **应统一为**：按 `wc -l` 重测后更新；建议改为附录式元数据，避免文档行数与表格数据漂移

---

### 低优先级（可选）

#### L1. N5 §2 JSDoc 注释中"提交"措辞与拆分后不一致
- **位置**：N5 §2 line 37
- **类型**：注释措辞过期
- **当前描述**：`提交：PR 提交时（larkbot_commit_changes → buffer → LogEntry → 返回 commitMessage）`
- **应统一为**：保留（与拆分后职责一致），无修改必要——仅在 §4 / §8 修订后即可消除矛盾

#### L2. N5 §5 流程图与 §5 状态图节点命名差异
- **位置**：N5 §5 lines 163–169（流程图） vs lines 174–186（stateDiagram）
- **类型**：图示内部不一致
- **当前描述**：流程图用 `初始化 → 累积中 → commit_changes → 累积中 → ... → close_business_session → 已清理`；stateDiagram 用 `空 → 初始化 → 累积中 → 已提交 → ... → 已关闭 / 已清理 / 立即清理`
- **应统一为**：两图节点名应保持一致（建议同步到"创建 / 累积 / 提交 / 销毁"主术语），同时 `已清理` 与 `立即清理` 作为 销毁 的子状态保留

#### L3. N5 §6.3 缺少 larkbot_list_candidate_groups 步骤
- **位置**：N5 §6.3 lines 228–234
- **类型**：流程描述不完整
- **当前描述**：仅描述"调 `authorize_user({openId, chatId})`"，未提"先调 `larkbot_list_candidate_groups` 拿 candidates 再决策 chatId"
- **应统一为**：补 N4 §4.6 lines 360–370 的完整决策流

#### L4. N4 §10"新增：feature flag 累积 | 4 个 flag 是 MVP 上限"措辞过时
- **位置**：N4 §10 line 783
- **类型**：风险表数字过期
- **当前描述**：`4 个 flag 是 MVP 上限；后续需整合为统一开关`
- **应统一为**：若 H6 选择 5 flag 方案，改为 `5 个 flag 是 MVP 上限`；或保持 4 并删除 N6 中 `commitOnClose`

#### L5. N4 §6.10 回滚方案说明与 N6 §6 不一致
- **位置**：
  - N4 §6.10 line 704：`PR-4 是缺失路径补齐，无"旧路径"可回滚。如有问题需修复 bug 或 feature flag 关闭（如 larkBot.enableTaskJournal: false）`
  - N6 §6 line 183：`commitOnClose` 也是 PR-4 的 feature flag
- **类型**：回滚说明不完整
- **当前描述**：N4 §6.10 仅举 `enableTaskJournal` 一个 flag，未提 `commitOnClose`
- **应统一为**：若 N6 §6 保留 `commitOnClose`，N4 §6.10 增列该 flag 作为可关闭项

#### L6. N5 §8 持久化字段对比表与双写策略自相矛盾
- **位置**：
  - N5 §8 table line 258：`生命周期 | task 状态跃迁即写 | close_business_session 转换`（暗示 task_journal 转换在 close 时）
  - N5 §8 双写策略 lines 264–272：`close_business_session 触发时：1. task_journal → LogEntry 转换 …`
- **类型**：表内自相矛盾（与 M4 / H1 同根）
- **应统一为**：修订 §8 双写策略块即可解决（H1 已涵盖）

#### L7. N1 §3 提交 PR 步骤缺少 `larkbot_commit_changes` 返回值说明的"changes 清空"提示
- **位置**：N1 §3 line 87：`LB-->>A: {logEntry, commitMessage, journalReset: true}`
- **类型**：与 N4 / N6 一致（✓ 通过）
- **结论**：本条已通过，无需修复

---

## 修复建议汇总

按优先级排序：

### 高优先级（建议在一个 PR 中全部修复）

建议独立 PR：**`docs(lark-bot): 同步 919c0d3 拆分后的描述一致性`**

| # | 修复项 | 涉及文档 | 章节 |
|---|--------|---------|------|
| 1 | H1：转换时机统一为 commit_changes | N5 | §4 + §8 |
| 2 | H2：awaiting_review 写入时机统一为 commit_changes | N5 | §8 |
| 3 | H3：标题 13→14，§5.3 标题修正 | N6 | §5 |
| 4 | H4：N4 §2.3 / §2.4 / §6.4 增列 `larkbot_commit_changes`，合计 13→14 | N4 | §2.3 / §2.4 / §6.4 |
| 5 | H5：补齐 N1 §3 / §6.1、N5 §6.3 / §12 中 `larkbot_` 前缀 | N1 / N5 | N1 §3 + §6.1；N5 §6.3 + §12 |
| 6 | H6：feature flag 列表统一为 5 个（N4 与 N6 同步；N4 §10 "MVP 上限" 同步） | N4 / N6 | N4 §7.2 + §8 + §10；N6 §6 |

### 中优先级（可在同一 PR 或下一个小 PR 中修复）

| # | 修复项 | 涉及文档 |
|---|--------|---------|
| 7 | M1：N5 §5 stateDiagram 节点名同步到"创建/累积/提交/销毁"；N6 §2.6 补"累积" | N5 / N6 |
| 8 | M2：N4 §2.3 `larkbot_close_business_session` 描述改为 cleanup + 广播（删除 LogEntry 转换措辞） | N4 |
| 9 | M3：N4 §6.4 转换函数归属改为 `larkbot_commit_changes` 内部 | N4 |
| 10 | M4：N5 §4 文字 + 代码同步到拆分后契约 | N5 |
| 11 | M5：N5 §7 失败模式删除"close 时校验 changes 非空" | N5 |
| 12 | M6：字段命名统一（changesCount）+ state / reason 约定明确化 | N4 / N5 |
| 13 | M7：补 `pre_business` / `in_progress` 在 §5 / §6 状态图的写入时机（或标注人工裁决） | N5 |
| 14 | M8：N6 §4 PR-4 关键新增增列 `larkbot_commit_changes`；N3 §6.4 同步 | N3 / N6 |
| 15 | M9：术语"提交 PR"统一 | N1 / N4 / N6 |
| 16 | M10：术语"结束任务 / 关闭会话"统一 | N1 / N4 / N6 |
| 17 | M11：N6 §11 文档行数按 `wc -l` 重测更新 | N6 |

### 低优先级

| # | 修复项 | 涉及文档 |
|---|--------|---------|
| 18 | L1–L7：图示节点对齐、回滚方案补 commitOnClose、§6.3 流程补全等 | N4 / N5 |

---

## 通过项

### 维度 1：registerTool 命名一致性（部分通过）
- ✅ N4 / N6 中所有 registerTool 名称完整且统一（`feishu_*` / `larkbot_*`）
- ✅ N1 §6.2 / N4 §6.5 / N6 §5.2 内部一致使用 `larkbot_*` 前缀
- ❌ 见 H5：N1 §3 / §6.1、N5 §6.3 / §12 部分缺前缀

### 维度 2：registerTool 契约一致性（部分通过）
- ✅ `larkbot_commit_changes` 契约在 N4 §6.5 内部一致（8 步骤描述）
- ✅ `larkbot_close_business_session` 契约在 N4 §6.5 与 N6 §5.2 一致（不强制 changes 非空）
- ❌ 见 H1 / H2：转换时机和 awaiting_review 写入时机在 N4 vs N5 矛盾
- ❌ 见 M5：N5 §7 仍有"close 时强制 changes 非空"旧契约

### 维度 3：registerTool 数量一致性（不通过）
- ❌ 见 H3：N6 §5 标题 13 与实际 14~15 不符
- ❌ 见 H4：N4 §2.4 合计 13 与 §6.5 实际 14 不符

### 维度 4：任务日志生命周期阶段一致性（部分通过）
- ✅ N1 §6.1 / §6.2、N5 §2 JSDoc、N6 §2.6 表格使用"创建 / 累积 / 提交 / 销毁"
- ❌ 见 M1：N5 §5 stateDiagram 使用第二套命名（初始化 / 累积中 / 已提交 / 已关闭）

### 维度 5：buffer.changes 清空时机一致性（基本通过）
- ✅ 所有文档一致：`buffer.changes` 在 commit_changes 成功后清空，会话元数据保留
- ✅ N1 §6.1 line 169、N4 §6.5 line 532、N4 §6.7 line 652、N5 §5 line 178、N5 §10 line 326 一致
- ⚠️ 仅 N5 §4 / §8 旧描述有矛盾（见 H1）

### 维度 6：PR 提交职责一致性（通过）
- ✅ 所有文档一致：lark-bot 不持有 git 权限；实际 git 操作由 content-pr skill 完成
- ✅ 证据：
  - N1 §3 line 88：`调用 content-pr skill 完成 git commit / push / gh pr create（不是 lark-bot 职责）`
  - N1 §6.1 line 170：`LLM 调 content-pr skill 完成 git commit / push / gh pr create（不是 lark-bot 职责）`
  - N4 §6.5 line 516：`PR 提交（git commit / push / gh pr create / gh pr merge）由 content-pr skill 完成`
  - N5 §10 line 350：`lark-bot 不持有 git 权限，不调 gh CLI`
  - N6 §5.2 line 162：`larkbot_commit_changes 不持有 git 权限——实际 git 操作由 content-pr skill 完成`

### 维度 7：feature flag 列表一致性（不通过）
- ❌ 见 H6：N4（4 个）vs N6 表格（5 个）vs N6 示例（4 个）三方不一致

### 维度 8：PR-1~PR-4 描述一致性（部分通过）
- ✅ N4 §1.1 与 N6 §4 表格对 PR-1 / PR-2 / PR-3 描述一致
- ❌ 见 M8：N6 §4 PR-4 关键新增漏列 `larkbot_commit_changes`
- ❌ 见 M8：N3 §6.4 PR-4 保留列漏列 `larkbot_commit_changes` 与 `larkbot_query_journal`
- ❌ N6 §12.4 Skill 修订清单 B（content-pr skill）已列 `larkbot_commit_changes`（✓），但同文档 §4 / §5.2 表头未完全同步

### 维度 9：审计 journal 状态字段一致性（不通过）
- ❌ 见 H2：awaiting_review 写入时机 N4 vs N5 矛盾
- ❌ 见 M6：state 取值混乱（terminated 用于多种语义；pr_submit_failed / operator_resolution_failed 命名混淆）
- ❌ 见 M7：任务要求的 `pre_business` / `in_progress` 未在任何文档出现

### 维度 10：术语一致性（部分通过）
- ❌ 见 M9："提交 PR / 提交业务变更 / commit_changes"混用
- ❌ 见 M10："关闭会话 / 结束任务 / close_business_session / 关闭业务私聊会话"混用
- ✅ N6 §5.2 关键设计段（"不联动 / 不持有 git 权限 / buffer.changes 清空 / 不强制 changes 非空"）内部一致

---

## 需要人工裁决项

| # | 项目 | 选项 |
|---|------|------|
| 1 | `commitOnClose` 是否纳入 feature flag 列表 | A) 5 flag（含 commitOnClose）；B) 4 flag（删除 N6 新增行，回退 22b75bb 部分内容） |
| 2 | `larkbot_fetch_pending_events` 是否计入 registerTool 总数 | A) 计入 飞书 I/O（总数 15）；B) 单列 桥接（总数 14 调试 + 1 桥接 = 15）；C) 不计入 业务总数（总数 14 调试归入 飞书 I/O） |
| 3 | 任务要求的 5 个 audit state（pre_business / in_progress / awaiting_review / post_review / terminated）是否全部需在文档落地 | A) 全部补齐；B) 仅落地已出现 3 个（awaiting_review / post_review / terminated），其他标注"不需要" |
| 4 | N5 §5 stateDiagram 节点命名 | A) 全部统一到"创建 / 累积 / 提交 / 销毁"；B) 保留"初始化 / 累积中 / 已提交 / 已关闭"作为另一套术语 |
| 5 | 转换函数 `closeBusinessSession` 是否在 PR-4 中保留 | A) 拆分后函数改名为 `commitChanges`；B) 保留 `closeBusinessSession` 作为底层函数但不再对应 registerTool |

---

## 总结

- **总体结论**：major（多处高优先级不一致）
- **高优先级问题**：6 项（必须修复）
- **中优先级问题**：11 项（建议修复）
- **低优先级问题**：7 项（可选）
- **通过维度**：3/10 完全通过（维度 5 buffer.changes 清空时机、维度 6 PR 提交职责、维度 10 术语一致性内部段）
- **部分通过维度**：5/10（维度 1 命名、维度 2 契约、维度 4 阶段命名、维度 8 PR 拆分、维度 10 术语一致性跨文档）
- **不通过维度**：2/10（维度 3 总数、维度 7 feature flag、维度 9 audit state 字段）— 实际 3/10 不通过
- **核心修复路径**：919c0d3 拆分 `larkbot_commit_changes` 后，N5 §4 / §8 旧内容未同步、N4 总数表未更新、N1/N5 部分 registerTool 引用缺前缀、N6 新增 commitOnClose 引入 4 vs 5 数量分歧——建议按上述"修复建议汇总"分 2 个 PR 集中修复。
