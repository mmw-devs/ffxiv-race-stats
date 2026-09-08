# lark-bot 文档一致性复审报告（第 2 轮）

## 审查元信息

- 审查轮次：第 2 轮（复审 996a974 修复完整性）
- 修复 commit：996a974（`docs(lark-bot): 同步 919c0d3 拆分后的一致性描述`）
- 审查时间：2026-09-08
- 总体结论：**minor**（H1–H6 + M1–M11 主体已落地，但 H5 / L6 / L7 仍有未触及的同类残留点；5 项裁决部分落地；存在 1 处新计数不一致）

---

## 修复状态表

### H1–H6 高优先级

| # | 问题 | 状态 | 验证说明 |
|---|------|------|---------|
| H1 | N5 §4 + §8 转换时机仍写 close_business_session | ✅ 主体已修，1 处残留 | N5 §4 (L126) 文字已改为"`larkbot_commit_changes`"；§4 代码 `function commitChanges(...)` 替换 `closeBusinessSession`；§8 双写策略块 (L270–289) 完整改为"larkbot_commit_changes 成功时…larkbot_close_business_session 时…"。但 N5 §8 (L267) 持久化对比表"task_journal business 生命周期"列仍写 `close_business_session 转换`，未同步。N1 §6.1 mermaid 流程图（H1 范围内）已修复。**残留**：N5 §8 L267 表格 1 处。 |
| H2 | audit journal awaiting_review 写入时机 N4 vs N5 矛盾 | ✅ 已修 | N5 §8 双写策略块 (L273–289) 已统一：`larkbot_commit_changes 成功时` 写 `{state:'awaiting_review', shortDesc, changesCount}`；`larkbot_close_business_session 时` 仅写 `{state:'terminated', reason}`。与 N4 §6.5 / §6.8 一致。 |
| H3 | N6 §5 标题 13 与实际 14~15 不符 | ✅ 已修 | N6 §5 标题改为"`registerTool 清单（15 个）`"（L133）；§5.3 标题改为"`桥接与调试（2 个）`"（L168），内含 `larkbot_fetch_pending_events` + `larkbot_query_journal`。合计 7 + 6 + 2 = 15 ✓。 |
| H4 | N4 §2.3 / §2.4 / §6.4 漏列 larkbot_commit_changes | ⚠️ 部分修，新发现 | N4 §2.3 (L79–82) 已增列 `larkbot_commit_changes`；§2.4 合计改为 7+6+1=14；§6.4 (L489–494) 已增列。但 **N4 §2.4 合计仍为 14，N6 §5 合计为 15**——发现新不一致：N4 §2.1 PR-1 registerTool 表 (L56–63) 漏列 `larkbot_fetch_pending_events`（N4 §3.7 描述存在）；§2.4 缺"桥接"列；§3.8 测试描述写"7 个工具"应改为"8 个工具"。裁决 #2（`larkbot_fetch_pending_events` 计入总数）已在 N6 落地但未在 N4 同步。 |
| H5 | N1 / N5 部分 registerTool 缺 larkbot_ 前缀 | ⚠️ 部分修，仍有多处残留 | N1 §3 (L71/79/85/92)、§6.1 (L158/166/176)、N5 §6.3 (L229/231/232)、§12 (L399) 已加前缀。但 **仍有 21+ 处 registerTool 引用缺前缀**：N5 §5 ASCII 图 (L166–168)、§5 mermaid stateDiagram (L176–180)、§6.1 (L192/193/195/205)、§7 失败模式表 (L241/242)、§8 对比表 (L267)、§11 测试覆盖表 (L386–388)、§2 JSDoc (L49)、§6.3 (L91 `authorize_user`)；N1 §8 (L268 `record_change`)；N4 §1.2 (L33)、§6.7 (L654)、§6.9 (L698–700)；N6 §6 (L184)。**残留 21+ 处**。 |
| H6 | feature flag 4 vs 5 不一致 | ⚠️ 部分修 | N4 §7.2 总表 (L720–726) 已补 `commitOnClose`；N4 §6.10 (L706) 已加 `commitOnClose: false`；N4 §10 (L786) 已改"5 个 flag 是 MVP 上限"；N6 §6 表 (L184) 和示例 (L195) 均有 `commitOnClose`。**但 N4 §8 回滚汇总表 (L747–751) 仍只有 4 行，未增列 `commitOnClose`**——属于"汇总表未同步"残留。 |

### M1–M11 中优先级

| # | 问题 | 状态 | 验证说明 |
|---|------|------|---------|
| M1 | N5 §5 stateDiagram 节点名 | ✅ 主体已修，1 处残留 | N5 §5 mermaid stateDiagram (L172–186) 节点名已改为 `创建` / `累积` / `提交` / `销毁`（保留 `已清理` / `立即清理` 作子状态）。N6 §2.6 (L96–99) 已补 `累积` 行。但 **N5 §5 ASCII 流程图 (L165–167)** 仍用旧术语 `初始化 → 累积中 → commit_changes → 累积中 → ... → close_business_session → 已清理`——M1 主体修复未触及此 ASCII 图（L2 残留）。 |
| M2 | N4 §2.3 larkbot_close_business_session 描述过期 | ✅ 已修 | N4 §2.3 (L81) 已改为"`cleanupSessionForClose 六步 + ended 广播（不提交 PR）`"，删除"buffer → LogEntry 转换"。 |
| M3 | N4 §6.4 转换函数归属 | ✅ 已修 | N4 §6.4 (L494) 已改为"`转换函数` | `taskJournalToLogEntry`（`larkbot_commit_changes` 内部调用）`"。N5 §4 (L135) 代码函数名 `closeBusinessSession` 替换为 `commitChanges`。 |
| M4 | N5 §4 文字 + 代码 | ✅ 已修 | N5 §4 (L126) 文字改为"转换发生在 `larkbot_commit_changes` registerTool 调用时"；§4 (L135) 函数名改为 `commitChanges`；§4 (L156) 失败处理改为"lark-bot 拒绝 `larkbot_commit_changes` + 提示用户"。 |
| M5 | N5 §7 失败模式 close 时校验 changes 非空 | ✅ 已修 | N5 §7 失败模式表 (L242) 改为"`task_journal.changes 为空 | commit_changes 调用时 | **不允许提交**（validateLogStructure 校验 changes 非空）；提示 Agent 必须有业务变更`"——不再绑定到 close_business_session。 |
| M6 | 字段命名 + state 取值约定 | ⚠️ 部分修 | 字段命名 `changesCount` 已统一到 N4 §6.5/§6.8、N5 §8 双写策略。state 取值约定段 (N5 §7 L247–254) 新增"4 个合法值 + `pre_business`/`in_progress` 未实现 + terminated 通过 reason 区分"。**但**：约定段把 `in_progress` 同时列为"合法值"与"未在任何 emit 点使用"，内部矛盾——按裁决 #3 应仅落地 3 个（awaiting_review / post_review / terminated）。 |
| M7 | pre_business / in_progress 标注 | ⚠️ 部分修 | N5 §7 末尾约定段 (L247–254) 标注"`pre_business` / `in_progress` 当前未在任何 emit 点使用（待业务扩展时补齐）"。但 **state 取值"合法值"列表仍含 `in_progress`**，与"未实现"标注矛盾（见 M6）。 |
| M8 | N3 §6.4 / N6 §4 PR-4 关键新增漏列 | ✅ 已修 | N6 §4 (L131) 已改为"`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_query_journal`"；N3 §6.4 (L271) 已增列 `larkbot_commit_changes` + `larkbot_query_journal`。 |
| M9 | 术语"提交 PR"统一 | ⚠️ 部分修 | N1 §3 (L84) `else 提交 PR（不关闭会话）`、N4 §6.5 (L523) `label: "提交业务变更（生成 commit message）"`、N4 §6.7 (L602) `场景 A：提交 PR（不关闭会话）`、N6 §5.2 主线条目统一使用"`提交`"或"`提交 PR`"。但 **N4 §6.1 (L470)** 仍写"`业务结束时转换为 LogEntry`"——与 H1 修复矛盾（转换发生在 commit_changes 而非 close）。N5 §10 (L338) `业务会话中 LLM 调 larkbot_commit_changes(...)`、N5 §4 (L126) 修复后术语正确。**残留**：N4 §6.1 L470。 |
| M10 | 术语"结束任务 / 关闭会话"统一 | ⚠️ 部分修 | N1 §3 (L91) `else 结束任务（不提交 PR）` 已与 N4 §6.7 (L620) `场景 B：结束任务（不提交 PR）` 一致。但 **N1 §3 (L33)** 状态图仍用"业务结束"，**N1 §7 (L246)** "业务结束 / 业务超时 / 关闭命令"，**N4 §6.1 (L470)** "业务结束时转换为 LogEntry"，**N5 §7 (L245)** "关闭会话 + 广播 ended"——`业务结束` 与 `结束任务`/`关闭会话`/`业务超时` 仍混用。**残留**：N1 §3 L33 / §7 L246、N4 §6.1 L470。 |
| M11 | N6 §11 行数重测 | ✅ 主体已修 | N6 §11 (L273–282) 已重测：N1=291、N2=450、N3=383、N4=831、N5=413、N6=404、报告=416、合计 2772。注脚说明"行数随修订变化，以 wc -l 为准"。wc -l 实测：N1=291✓、N2=450✓、N3=383✓、N4=831✓、N5=413✓、**N6=407**（表内 404，差 3 行，因新加"审查报告"行 + 注脚 + 合计重算所致——自指漂移）、报告=416✓。M11 主体修复完成，但 N6 自指行数差 3 行。 |

### 5 项裁决落地

| # | 裁决项 | 状态 | 验证说明 |
|---|-------|------|---------|
| 1 | commitOnClose 纳入 feature flag | ✅ 已落地 | N4 §7.2 + §6.10 + §10 + N6 §6（表 + 示例）均含 `commitOnClose`。残留：N4 §8 回滚汇总表 (L747–751) 未列 commitOnClose 回滚条目。 |
| 2 | larkbot_fetch_pending_events 计入总数（15 = 7+6+2） | ⚠️ 部分落地 | N6 §5 (L133) 标题"15 个"、§5.3 列 `larkbot_fetch_pending_events` + `larkbot_query_journal` (2 个)。但 **N4 §2.4 合计 14**：§2.1 PR-1 registerTool 表 (L56–63) 漏列 `larkbot_fetch_pending_events`；§2.4 缺"桥接"列；§3.8 (L251) 测试描述"7 个工具"应改为 8。N4 与 N6 计数不一致（14 vs 15）。 |
| 3 | 5 个 audit state 仅落地 3 个（awaiting_review / post_review / terminated），pre_business / in_progress 标注未实现 | ⚠️ 主体已落，内部矛盾 | N5 §7 末尾 state 取值约定段 (L247–254) 已标注。但约定段同时把 `in_progress` 列为"合法值"又标"未在任何 emit 点使用"——内部矛盾。裁决 #3 明确"仅落地 3 个"，合法值列表应只含 awaiting_review / post_review / terminated。 |
| 4 | N5 §5 stateDiagram 节点名统一到 创建/累积/提交/销毁 | ✅ 已落地（mermaid），L2 残留 | N5 §5 mermaid stateDiagram (L172–186) 节点名已统一；N6 §2.6 (L96–99) 已补 `累积`。残留：N5 §5 ASCII 流程图 (L165–167) 用旧术语"初始化/累积中"。 |
| 5 | closeBusinessSession 保留为底层函数（commit_changes 内部调用） | ⚠️ 部分落地 | N5 §4 (L135) 代码用 `commitChanges` + `taskJournalToLogEntry`，未在 §4 文字说明 `closeBusinessSession` 保留为底层函数；N4 §6.4 (L494) 注明 `taskJournalToLogEntry（larkbot_commit_changes 内部调用）` 但未提 `closeBusinessSession`。测试覆盖表（N5 §11 L384、N4 §6.9 L696）仍引用 `closeBusinessSession`，暗示其为底层函数，但 §4 文字与测试引用未互链——裁决 #5 文档化不完整。 |

---

## 回归检测（修改引入的新问题）

### 新发现 1：registerTool 总数 N4 vs N6 不一致（14 vs 15）

- **位置**：N4 §2.4 (L88–92) vs N6 §5 (L133, L135, L168)
- **现象**：N4 §2.4 合计 7+6+1=14；N6 §5 合计 7+6+2=15。差 1 是 `larkbot_fetch_pending_events`（N4 §2.1 PR-1 registerTool 表漏列；§2.4 缺"桥接"列；§3.7 是 PR-1 registerTool；§3.8 L251 写"7 个工具"应为 8 个）。
- **引入时机**：裁决 #2 选择 C（在 N6 计入但不计入业务总数），H4 修复 §2.4 时未同步"桥接"分类，导致 N4 与 N6 计数不一致。
- **建议**：N4 §2.1 增列 `larkbot_fetch_pending_events`；§2.4 表头加"桥接"列（PR-1 行 7 飞书 + 1 桥接 = 8）；§3.8 L251 改"7 个工具"为"8 个工具"；§2.4 合计改为 7+6+1+1=15。

### 新发现 2：N5 §5 mermaid stateDiagram 与 ASCII 流程图术语不一致

- **位置**：N5 §5 mermaid stateDiagram (L172–186) vs §5 ASCII 流程图 (L165–167)
- **现象**：mermaid 节点为 `创建/累积/提交/销毁`；ASCII 流程图仍用 `初始化 → 累积中 → commit_changes → 累积中 → ... → close_business_session → 已清理`。M1 修复触及 mermaid 但未触及 ASCII。
- **引入时机**：M1 修复时仅替换了 mermaid 块，ASCII 图保留旧文本。
- **建议**：ASCII 图同步到"创建 → 累积 → 提交 → 累积 → ... → 销毁 → 已清理"。

### 新发现 3：N5 §8 持久化对比表未同步 H1 修复

- **位置**：N5 §8 (L267)
- **现象**：表格"task_journal business 生命周期"列仍写 `close_business_session 转换`。该列含义应是"LogEntry 转换时机"，按 H1 修复应为 `larkbot_commit_changes 转换`。
- **引入时机**：996a974 修复了 §8 双写策略块 (L270–289)，但未触及 §8 上方的对比表 (L262–268)。
- **建议**：L267 改为 `larkbot_commit_changes 转换`。

### 新发现 4：H5 修复未触及多处 registerTool 引用（21+ 处）

- **位置**：
  - N5 §2 JSDoc L49 (`commit_changes`)
  - N5 §5 ASCII 图 L166–168 (`commit_changes` / `close_business_session` / `record_change`)
  - N5 §5 mermaid stateDiagram L176/177/178/180 (`record_change` / `commit_changes` / `close_business_session`)
  - N5 §6.1 L192/193/195/205 (`commit_changes` / `close_business_session`)
  - N5 §6.3 L91 (`authorize_user`)、L241 (`record_change`)、L242 (`commit_changes`)
  - N5 §8 L267 (`close_business_session`)
  - N5 §11 L386–388 (`record_change` / `close_business_session`)
  - N1 §8 L268 (`record_change`)
  - N4 §1.2 L33 (`close_business_session`)、§6.7 L654 (`commit_changes`)、§6.9 L698–700 (`record_change` / `close_business_session`)
  - N6 §6 L184 (`commit_changes`)
- **现象**：996a974 修复仅触及原 H5 列出的 10 处（N1 §3 lines 71/79/85/92；§6.1 lines 162/166/176；N5 §6.3 lines 229/231/232；§12 line 383），但 N1 / N4 / N5 / N6 文档内仍有大量 registerTool 引用缺 `larkbot_` 前缀。
- **引入时机**：H5 修复仅按原 report 列出位置定位，未做全文档 grep。
- **建议**：对 N1/N4/N5/N6 做全文档 grep，统一加 `larkbot_` 前缀（`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session` / `larkbot_authorize_user`）。

### 新发现 5：N5 §7 state 取值约定内部矛盾

- **位置**：N5 §7 末尾 state 取值约定段 (L247–254)
- **现象**：
  - L249 列"合法值"含 `in_progress` / `awaiting_review` / `post_review` / `terminated`（4 个）
  - L250 标"`pre_business` / `in_progress` 当前未在任何 emit 点使用"
  - 两者内部矛盾：`in_progress` 既是合法值又未实现
  - 裁决 #3 明确"5 个 audit state 仅落地 3 个（awaiting_review / post_review / terminated）"
- **引入时机**：M7 修复时把"合法值"定义为 4 个（含 `in_progress`），但裁决 #3 是"仅落地 3 个"。应区分"合法值集合（4 个）"与"当前已落地值（3 个）"，或明确把 `in_progress` 从合法值列表移除。
- **建议**：L249 改为"合法值：`awaiting_review` / `post_review` / `terminated`"（仅已落地 3 个）；`in_progress` / `pre_business` 列入"规划值，待业务扩展时补齐"。

### 新发现 6：N4 §8 回滚汇总表未列 commitOnClose

- **位置**：N4 §8 (L747–751)
- **现象**：回滚汇总表仅列 4 个 PR-4 行（PR-1~PR-4），PR-4 行仅提 `enableTaskJournal`，未提 `commitOnClose`。N4 §7.2 表含 5 个 flag，§8 应同步。
- **引入时机**：H6 修复触及 §7.2 + §6.10 + §10 + N6 §6，但未触及 §8 回滚汇总表。
- **建议**：§8 表头增加 commitOnClose 列；或 PR-4 行加"或 `larkBot.commitOnClose: false`"。

### 新发现 7：N4 §6.1 描述与 H1 修复矛盾

- **位置**：N4 §6.1 (L470)
- **现象**：N4 §6.1 (L470) 写"业务私聊开始时累积 task_journal buffer，**业务结束时转换为 LogEntry** 返回给 LLM"。按 H1 修复，转换应发生在 `larkbot_commit_changes` 而非会话关闭。
- **引入时机**：H1 修复触及 N5 §4 + §8，未触及 N4 §6.1。
- **建议**：L470 改为"业务私聊开始时累积 task_journal buffer，业务执行中由 `larkbot_record_change` 累积；提交时由 `larkbot_commit_changes` 转换 LogEntry 返回给 LLM，会话关闭由 `larkbot_close_business_session` 触发"。

### 新发现 8：N4 §3.8 测试描述与实际 registerTool 数量不一致

- **位置**：N4 §3.8 (L251)
- **现象**：N4 §3.8 测试覆盖表写"`registerTool TypeBox schema 验证（7 个工具）`"。按裁决 #2，PR-1 registerTool 应为 8 个（7 飞书 I/O + 1 桥接 `larkbot_fetch_pending_events`）。
- **引入时机**：§3.8 与 §2.4 计数同源（H4 修复未触及 §3.8）。
- **建议**：L251 改为"8 个工具"。

### 新发现 9：N6 §6 描述列缺前缀

- **位置**：N6 §6 (L184)
- **现象**：`larkBot.commitOnClose` 说明列写"`会话关闭时是否自动 commit_changes`"，缺 `larkbot_` 前缀（H5 同根残留）。
- **引入时机**：H5 修复按原 report 行号定位，未包含 N6 §6 L184。
- **建议**：改为"`会话关闭时是否自动 larkbot_commit_changes`"。

---

## 未修复项（需人工裁决或后续 PR）

按优先级：

1. **H5 残留（21+ 处 registerTool 缺前缀）**——建议独立清理 PR（全文档 grep 统一加 `larkbot_` 前缀），影响 N1 / N4 / N5 / N6 共 4 个文档。
2. **新发现 1（N4 vs N6 registerTool 总数 14 vs 15）**——新增不一致，来源裁决 #2 落地不完整；建议合并 H5 清理 PR 修复。
3. **新发现 5（N5 §7 state 合法值 vs 未实现矛盾）**——内部矛盾，文档可读性问题，建议合并 H5 清理 PR。
4. **新发现 6（N4 §8 回滚汇总表漏 commitOnClose）**——汇总表同步遗漏，建议合并 H5 清理 PR。
5. **新发现 7（N4 §6.1 描述与 H1 矛盾）**——H1 修复未触及 N4 §6.1，建议合并 H5 清理 PR。
6. **新发现 2（N5 §5 ASCII 流程图术语未统一）**——M1 修复 + L2 残留，建议合并 H5 清理 PR。
7. **新发现 3（N5 §8 对比表未同步）**——H1 修复未触及此表，建议合并 H5 清理 PR。
8. **新发现 8（N4 §3.8 测试计数 7 vs 8）**——与新发现 1 同源。
9. **新发现 9（N6 §6 commitOnClose 描述列缺前缀）**——H5 残留。
10. **M9 残留（N4 §6.1 L470）**——与新发现 7 重复。
11. **M10 残留（N1 §3 L33 / §7 L246、N4 §6.1 L470、N5 §7 L245）**——术语"业务结束"未完全替换为"结束任务/销毁"，与新发现 7 部分重叠。
12. **M11 N6 自指行数差 3 行（404 → 407）**——结构性自指问题，无法在文档内完全消除，建议保留"以 wc -l 为准"注脚。
13. **裁决 #5 文档化不完整（N5 §4 未说明 closeBusinessSession 保留为底层函数）**——建议在 N5 §4 增加 1 句注释说明 `closeBusinessSession` 函数已重命名为 `commitChanges`、原语义由 `commitChanges` + `taskJournalToLogEntry` 承接；或在 §4 文字注明"`closeBusinessSession` 命名已废弃，由 `commitChanges` 替代"。
14. **L1–L7（原始 review report 标注的 7 项低优先级问题）**——原 996a974 commit message 已声明"L1-L7 留待下个清理 PR"。

---

## 通过项

### 维度 1：registerTool 命名一致性（主体通过，21+ 处残留）

- ✅ N4 / N6 §5.2 / §5.3 / §6.4 / §6.5 等主表 / 主契约全部使用 `larkbot_*` 前缀
- ✅ N1 §3 / §6.1 / §6.2 主图与主表使用 `larkbot_*` 前缀（mermaid）
- ✅ N5 §4 §6.3 §10 §12 主契约 / 主表使用 `larkbot_*` 前缀
- ❌ 见回归检测新发现 4：N1 §8、N4 §1.2 / §3.7 / §6.1 / §6.7 / §6.9、N5 §2 / §5 / §6.1 / §7 / §11、N6 §6 仍有 21+ 处 registerTool 引用缺前缀

### 维度 2：registerTool 契约一致性（通过）

- ✅ `larkbot_commit_changes` 转换时机在 N4/N5/N6 统一为 commit_changes
- ✅ `larkbot_close_business_session` 不强制 changes 非空（N4 §6.5 + N6 §5.2 + N5 §7 已统一）
- ✅ awaiting_review 写入时机统一为 commit_changes（N4 §6.5/§6.8 + N5 §8 双写策略块）
- ⚠️ N5 §8 L267 持久化对比表残留 `close_business_session 转换`（见新发现 3）

### 维度 3：registerTool 数量一致性（不通过）

- ⚠️ N6 §5 合计 15（N4 §2.4 仅算 14，差 1 `larkbot_fetch_pending_events`）—— 见新发现 1

### 维度 4：任务日志生命周期阶段一致性（主体通过，L2 残留）

- ✅ N1 §6.1 / §6.2、N5 §2 JSDoc、N5 §5 mermaid、N6 §2.6 表格全部使用 `创建/累积/提交/销毁`
- ❌ N5 §5 ASCII 流程图仍用旧术语 `初始化/累积中`（见新发现 2）

### 维度 5：buffer.changes 清空时机一致性（通过）

- ✅ N1 §6.1、N4 §6.5、N5 §4 / §5 mermaid / §10 一致：`commit_changes` 后 changes 清空，会话元数据保留

### 维度 6：PR 提交职责一致性（通过）

- ✅ 所有文档一致：lark-bot 不持有 git 权限；实际 git 操作由 content-pr skill 完成

### 维度 7：feature flag 列表一致性（主体通过，1 处残留）

- ✅ N4 §7.2 + N6 §6 表 + 示例均 5 个 flag
- ⚠️ N4 §8 回滚汇总表仍 4 行，未列 commitOnClose（见新发现 6）

### 维度 8：PR-1~PR-4 描述一致性（通过）

- ✅ N3 §6.4 + N6 §4 PR-4 关键新增 4 个 registerTool 全部列出
- ✅ N4 §6.4 + N4 §6.5 内部一致
- ⚠️ N4 §6.1 L470 描述与 H1 矛盾（见新发现 7）

### 维度 9：审计 journal 状态字段一致性（主体通过，2 处矛盾）

- ✅ state 字段命名 `changesCount` 已统一
- ✅ N5 §8 双写策略块使用 `{state:'awaiting_review', shortDesc, changesCount}` 与 N4 一致
- ✅ `terminated` 通过 reason 区分（`session_closed` / `pr_rejected` / `operator_resolution_failed`）
- ⚠️ N5 §7 末尾 state 取值约定内部矛盾（合法值含 `in_progress` 又标未实现，见新发现 5）
- ⚠️ N5 §8 L267 对比表残留 `close_business_session 转换`（见新发现 3）

### 维度 10：术语一致性（主体通过，4 处残留）

- ✅ N1 §3 主分支（提交 PR / 结束任务）、N4 §6.7 场景 A/B、C 与 N6 §5.2 主线条目统一
- ⚠️ N1 §3 L33 stateDiagram 仍用"业务结束"
- ⚠️ N1 §7 L246 "业务结束 / 业务超时 / 关闭命令" 混用
- ⚠️ N4 §6.1 L470 "业务结束时转换为 LogEntry" 与 H1 矛盾
- ⚠️ N5 §7 L245 "关闭会话 + 广播 ended" 与 N1 §3 L91 "结束任务" 术语分叉

### 维度 11：状态字段命名一致性（通过）

- ✅ `changesCount` 字段命名在 N4 §6.5 / §6.8 + N5 §8 双写策略块已统一

### 维度 12：任务日志对象生命周期阶段命名（主体通过）

- ✅ 创建 / 累积 / 提交 / 销毁 在 N1 §6.1 mermaid、N1 §6.2 表、N5 §2 JSDoc、N5 §5 mermaid、N6 §2.6 表均已统一
- ⚠️ N5 §5 ASCII 流程图仍用"初始化 / 累积中"（L2 残留）

---

## 总结

### 总体评价

**996a974 commit 修复整体合格，但 H5 / L6 / L7 类问题在"按位置修复"模式下未彻底解决，导致残留 21+ 处同类问题 + 1 处新计数不一致 + 4 处表内残留。**

- **H1–H6 高优先级**：H2/H3 全部修复；H1 / H4 / H5 / H6 主体修复但有残留。
- **M1–M11 中优先级**：M2/M3/M4/M5/M8 全部修复；M1/M6/M7/M9/M10/M11 主体修复但有残留。
- **5 项裁决**：裁决 #1 全部落地（1 处表残留）；裁决 #2 部分落地（引入 N4/N6 计数不一致）；裁决 #3 主体落地（内部矛盾）；裁决 #4 全部落地（1 处 L2 残留）；裁决 #5 部分落地（文档化不完整）。
- **回归检测**：发现 9 处新问题（其中 4 处为 H5 同类残留、5 处为表/汇总/计数同步遗漏），但未引入"破坏性"问题（如 registerTool 名被改、流程图被破坏）。

### 建议

1. **建议增加一个清理 PR**（`docs(lark-bot): 同步 996a974 修复残留 + registerTool 总数一致化`），专门解决：
   - H5 残留（21+ 处 registerTool 前缀）
   - 新发现 1（N4 §2.4 vs N6 §5 总数 14 vs 15）
   - 新发现 2（N5 §5 ASCII 流程图术语）
   - 新发现 3（N5 §8 L267 对比表）
   - 新发现 5（N5 §7 state 合法值内部矛盾）
   - 新发现 6（N4 §8 回滚汇总表）
   - 新发现 7（N4 §6.1 L470 H1 矛盾）
   - 新发现 8（N4 §3.8 测试计数）
   - 新发现 9（N6 §6 L184 前缀）

2. **裁决 #5 文档化**：建议在 N5 §4 增加注释说明 `commitChanges` / `closeBusinessSession` 命名变更；或显式注明"closeBusinessSession 作为底层 helper 函数被 commit_changes 内部调用"。

3. **原始 L1-L7 低优先级问题**：建议并入上述清理 PR 一并处理（如 N5 §6.3 流程补全、N4 §6.10 描述一致性等）。

4. **结构性建议**：考虑将"registerTool 引用一致性"作为文档 lint 规则（commit hook），避免再次出现同类残留。
