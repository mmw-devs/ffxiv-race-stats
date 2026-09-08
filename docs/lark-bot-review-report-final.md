# lark-bot 文档一致性复审报告（第 3 轮 / 最终）

## 审查元信息

- 审查轮次：第 3 轮（最终复审 efdbeb8 修复完整性）
- 修复 commit：efdbeb8
- 审查时间：2026-09-08
- 总体结论：**minor**（efdbeb8 主体修复完成；9 处残留全部清零；5 项裁决全部落地；N4 §2.4 合计行一致；存在 1 处因修复引入的小回归：N4 §2.4 表格叠加 2 行旧表残留 + 1 处 closeBusinessSession 测试名残留，2 处均无功能性影响但需在合并前清理）
- 建议：**可以推 origin 开 PR**，但建议合入前追加 1 个最小修复 commit 删除 N4 §2.4 旧表 2 行 + N5 §11 测试表 1 处残留，详见"回归检测"段。

---

## 第 2 轮 9 处残留修复验证表

| # | 第 2 轮问题 | 状态 | 验证说明 |
|---|-----------|------|---------|
| 新 1 | N4 §2.4 vs N6 §5 总数 14 vs 15 | ✅ 已修复 | N4 §2.4 新 5 列表（L87–93）：PR-1 7 飞书 + 1 桥接 / PR-2 3 业务 / PR-4 3 业务 + 1 调试 = **合计 7+6+1+1=15** ✓；N6 §5 (L135) 标题"registerTool 清单（15 个）"，§5.3 (L167) 标"2 个"，合计 7+6+2=15 ✓。两处一致。 |
| 新 4 | H5 残留 21+ 处 registerTool 缺前缀 | ✅ 已修复 | 全文档 grep（不含 2 份审查报告）：`grep -nE "(commit_changes\|close_business_session\|record_change\|authorize_user)" docs/lark-bot-*.md \| grep -v "larkbot_"` 在 6 个分析文档中**返回 0 行** ✓。所有 registerTool 引用均带 `larkbot_` 前缀或为 `feishu_` 前缀。N1 §8 (L268) `record_change` → `larkbot_record_change` ✓；N4 §1.2 (L33) ✓ / §6.7 (L654) ✓ / §6.9 (L696–700) ✓；N5 §2 JSDoc (L49) ✓ / §5 ASCII (L165–167) ✓ / §5 mermaid (L176–180) ✓ / §6.1 (L192/193/195/205) ✓ / §7 (L241/242) ✓ / §8 (L267 → L277 表格对比) ✓ / §11 (L386–388)；N6 §6 (L184) ✓。 |
| 新 2 | N5 §5 ASCII 流程图术语未统一 | ✅ 已修复 | N5 §5 ASCII (L168–170) 现统一为 `创建 → 累积 → 提交 → 累积 → ... → 销毁 → 已清理`，节点前缀均加 `larkbot_`：`larkbot_record_change`（多次）。与 mermaid stateDiagram 节点 `创建/累积/提交/销毁` 完全一致 ✓。 |
| 新 3 | N5 §8 L267 对比表残留 | ✅ 已修复 | N5 §8 对比表"task_journal business 生命周期"列（L277）现为 `larkbot_commit_changes 转换`，删除原 `close_business_session 转换` ✓。 |
| 新 5 | N5 §7 state 合法值 vs 未实现矛盾 | ✅ 已修复 | N5 §7 约定段（L253–260）现分为两段："当前已落地（emit 点使用）的合法值（3 个）：`awaiting_review` / `post_review` / `terminated`" + "规划值（待业务扩展时补齐 emit 点，2 个）：`pre_business`（未实现）/ `in_progress`（未实现）"。内部矛盾消除 ✓。 |
| 新 6 | N4 §8 回滚汇总表漏 commitOnClose | ✅ 已修复 | N4 §8 (L755) PR-4 行现为 `larkBot.enableTaskJournal / larkBot.commitOnClose`，回滚步骤明确包含两个 flag ✓。 |
| 新 7 | N4 §6.1 L470 描述与 H1 矛盾 | ✅ 已修复 | N4 §6.1 (L473) 现为"业务私聊开始时累积 task_journal buffer，业务执行中由 `larkbot_record_change` 累积 ChangeEntry；提交时由 `larkbot_commit_changes` 转换 LogEntry 返回给 LLM，会话关闭由 `larkbot_close_business_session` 触发（cleanupSessionForClose 六步 + ended 广播）。" ✓ |
| 新 8 | N4 §3.8 测试计数 7 vs 8 | ✅ 已修复 | N4 §3.8 (L251) 现为"`registerTool TypeBox schema 验证（8 个工具）`" ✓，与 §2.4 合计 15 + 7 飞书 I/O 一致。 |
| 新 9 | N6 §6 commitOnClose 描述列缺前缀 | ✅ 已修复 | N6 §6 (L184) 现为"`larkBot.commitOnClose` \| PR-4 \| false \| 会话关闭时是否自动 `larkbot_commit_changes`" ✓。 |

---

## 5 项裁决最终验证

| # | 裁决项 | 状态 | 验证说明 |
|---|-------|------|---------|
| 1 | commitOnClose 纳入 feature flag | ✅ 已落地（5 处全部含） | N4 §7.2 (L729) feature flag 总表 5 个 ✓；N4 §8 (L755) 回滚汇总表 PR-4 行含 `larkBot.commitOnClose` ✓；N4 §6.10 (L709) 回滚方案提到 ✓；N4 §10 (L789) "5 个 flag 是 MVP 上限" ✓；N6 §6 (L184) 表 + 示例 (L195) ✓。5 个 flag 全部文档对齐：useExtensionMode / useAgentMatcher / useNaturalLanguageClose / enableTaskJournal / commitOnClose。 |
| 2 | larkbot_fetch_pending_events 计入总数（15 = 7+6+2） | ✅ 已落地 | N4 §2.1 (L66) PR-1 registerTool 表含 `larkbot_fetch_pending_events` ✓；N4 §2.4 合计 = 7+6+1+1=15 ✓；N6 §5 (L135) 标题"15 个" + §5.1 7 + §5.2 6 + §5.3 2 = 15 ✓；N4 §3.8 测试计数 8 ✓。N4 与 N6 合计一致 15。 |
| 3 | 5 个 audit state 仅落地 3 个 | ✅ 已落地 | N5 §7 (L255–257) 仅列 `awaiting_review` / `post_review` / `terminated` 为"当前已落地"合法值；(L259–260) `pre_business` / `in_progress` 列入"规划值（未实现）"。内部矛盾已消除 ✓。 |
| 4 | N5 §5 stateDiagram 节点名统一 | ✅ 已落地 | N5 §5 ASCII (L168–170) 与 mermaid stateDiagram (L181–186) 节点名均为 `创建/累积/提交/销毁`（保留 `已清理`/`立即清理` 作子状态）。前缀统一为 `larkbot_*` ✓。 |
| 5 | closeBusinessSession 文档化 | ✅ 已落地 | N5 §4 (L144–147) 增加 4 行注释明确"原 `closeBusinessSession` 命名废弃，实际语义由 `commitChanges` + `taskJournalToLogEntry` 承接。底层辅助函数 `taskJournalToLogEntry` 仍保留，供 `commitChanges` 内部调用。" ✓。裁决 #5 完整文档化。 |

---

## 回归检测

### 新发现 R1：N4 §2.4 表格叠加 2 行旧表残留（efdbeb8 引入）

- **位置**：`docs/lark-bot-migration-roadmap.md` L94–95
- **现象**：
  ```
  | PR-4 | 0 | 3 | 1 |
  | **合计** | **7** | **6** | **1** |
  ```
  这 2 行是 996a974 之前的旧 3 列表的尾巴；efdbeb8 添加新 5 列表（L87–93）时仅替换了表头与 PR-1/PR-2/合计头部，未删除旧 PR-4 行与旧合计行。git diff 996a974..efdbeb8 显示 `-` 行只有表头替换，PR-4 行 / 旧合计行从未 `-` 移除。
- **影响**：
  - 数据上不冲突（旧 3 列表 PR-4 0+3+1=4 与新 5 列表 PR-4 0+3+1+0=4 一致；旧合计 7+6+1=14 是 5 列之前的旧合计，但已不再适用新口径）
  - 视觉上表格错位（合计行有两段），第一次读 §2.4 的 reviewer 可能困惑
  - 严格来说是"双合计行"，建议删除 L94–95
- **建议**：删除 N4 §2.4 L94–95 两行（`git diff` 显示是 996a974 修复 commit message 中"已修"但未真正删除的脏数据）。

### 新发现 R2：N5 §11 测试表 1 处残留（efdbeb8 未触及）

- **位置**：`docs/lark-bot-task-journal-schema.md` L394
- **现象**：测试覆盖表行写"`closeBusinessSession` 在 changes 为空时拒绝"。该行是 919c0d3 拆分前的旧表述（commit_changes 拆分前 closeBusinessSession 承担此职责）。efdbeb8 commit message 声明已修复"N5 §11 L386–388 测试覆盖表"，但漏了 L394 这一行（commit message 中 N5 §11 标的范围是 L386–388，实际错位到 L394）。
- **影响**：
  - 文档一致性：测试名指向已废弃的 `closeBusinessSession`，与 N5 §4 (L144–147) 命名变更注释直接矛盾
  - 实际测试代码中 `larkbot_commit_changes` 拒绝空 changes（见 N4 §6.9 (L699) ✓）
- **建议**：N5 §11 L394 改为"`larkbot_commit_changes` 在 changes 为空时拒绝"，与 N4 §6.9 (L699) 对齐。

### 其他回归检测（全部通过）

| 检测项 | 状态 | 验证 |
|-------|------|------|
| registerTool 总数（15）跨文档一致 | ✅ | N4 §2.4 = 15（7 飞书 I/O + 6 业务 + 1 调试 + 1 桥接）✓；N6 §5 = 15（7+6+2）✓ |
| feature flag 列表（5 个）跨文档一致 | ✅ | N4 §7.2 (5 个) = N4 §8 (5 个) = N6 §6 (5 个)；所有 flag 默认值一致 |
| registerTool 名称带 `larkbot_` 前缀 | ✅ | 6 个分析文档中所有业务 registerTool 引用均带前缀；`feishu_*` 飞书 I/O 保持原前缀 |
| 任务日志对象生命周期阶段命名（创建/累积/提交/销毁） | ✅ | N1 §6.1 mermaid ✓；N1 §6.2 表 ✓；N5 §2 JSDoc ✓；N5 §5 ASCII ✓ + mermaid ✓；N6 §2.6 ✓ |
| closeBusinessSession 引用（仅底层 helper 概念） | ⚠️ 1 处残留 | 见 R2 |
| state 取值约定（无内部矛盾） | ✅ | N5 §7 合法值 3 个 + 规划值 2 个；与 N4 §6.8 双写策略块一致 |
| N1/N4/N5/N6 cross-reference 一致 | ✅ | N1 §9 (L271–279) / N2 §11 (L428–435) / N3 §9 (L356–363) / N4 §12 (L803–810) / N5 §12 (L403–410) / N6 §11 (L269–284) 互相指向一致 |
| mermaid 语法正确 | ✅ | N1 §3 sequenceDiagram + §4 flowchart + §6.1 flowchart 渲染正常；N5 §5 stateDiagram 渲染正常 |

---

## 全面复审

### cross-reference 一致性

| 引用方 | 被引 | 状态 |
|--------|------|------|
| N1 §0 不在范围 → N2/N3 | N2 §11 / N3 §9 互相反向引用 | ✅ |
| N1 §9 → N2/N3/N4/N5/N6 | 6 节点互向一致 | ✅ |
| N2 §11 → N1/N3/N4/N5/N6 | 6 节点互向一致 | ✅ |
| N3 §9 → N1/N2/N4/N5/N6 | 6 节点互向一致 | ✅ |
| N4 §12 → N1/N2/N3/N5/N6 | 5 节点互向一致（不含自身 N4 节点） | ✅ |
| N5 §12 → N1/N2/N3/N4/N6 | 5 节点互向一致（不含自身 N5 节点） | ✅ |
| N6 §11 → N1/N2/N3/N4/N5 | 5 节点互向一致（不含自身 N6 节点） | ✅ |

所有 6 节点互引一致，无悬空引用。

### 命名一致性（最终扫描）

#### registerTool 名称

| registerTool | N1 | N2 | N3 | N4 | N5 | N6 |
|-------------|----|----|----|----|----|-----|
| `larkbot_record_change` | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| `larkbot_commit_changes` | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| `larkbot_close_business_session` | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| `larkbot_authorize_user` | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| `larkbot_resolve_operator` | — | — | ✓ | ✓ | — | ✓ |
| `larkbot_list_candidate_groups` | — | — | ✓ | ✓ | — | ✓ |
| `larkbot_query_journal` | — | — | ✓ | ✓ | — | ✓ |
| `larkbot_fetch_pending_events` | — | — | — | ✓ | — | ✓ |
| `feishu_*` (7 个) | — | — | ✓ | ✓ | — | ✓ |

#### 生命周期阶段

| 阶段 | N1 | N5 | N6 |
|------|----|----|-----|
| 创建 | ✓ (stateDiagram, §6.1) | ✓ (JSDoc, ASCII, mermaid, §5 关键不变量) | ✓ (§2.6 表) |
| 累积 | ✓ (§6.1 流程图"累积阶段") | ✓ (JSDoc, ASCII, mermaid, §7 失败模式) | ✓ (§2.6 表) |
| 提交 | ✓ (§6.1 流程图"提交阶段") | ✓ (JSDoc, ASCII, mermaid) | ✓ (§2.6 表) |
| 销毁 | ✓ (§6.1 流程图"销毁阶段") | ✓ (JSDoc, ASCII, mermaid) | ✓ (§2.6 表) |

#### feature flag（5 个）

| flag | N4 §7.2 | N4 §8 | N6 §6 |
|------|---------|-------|-------|
| `larkBot.useExtensionMode` | ✓ | ✓ | ✓ |
| `larkBot.useAgentMatcher` | ✓ | ✓ | ✓ |
| `larkBot.useNaturalLanguageClose` | ✓ | ✓ | ✓ |
| `larkBot.enableTaskJournal` | ✓ | ✓ | ✓ |
| `larkBot.commitOnClose` | ✓ | ✓ | ✓ |

#### state 取值

| 状态值 | N5 §7 已落地 | N5 §7 规划值 |
|--------|-------------|-------------|
| `awaiting_review` | ✓ | — |
| `post_review` | ✓ | — |
| `terminated` | ✓ | — |
| `pre_business` | — | ✓ (未实现) |
| `in_progress` | — | ✓ (未实现) |

### 残留清单（最终）

#### 🔴 新发现（efdbeb8 引入或未触及）

1. **R1**：N4 §2.4 (L94–95) 旧 3 列表残留 2 行（PR-4 行 + 旧合计行），efdbeb8 添加新表时未删除
2. **R2**：N5 §11 (L394) 测试覆盖表 1 处残留 `closeBusinessSession` 测试名（旧表述）

#### 🟢 之前审查遗留（L1–L7 低优先级，已声明"下个清理 PR"）

- M10 术语混用残留：N1 §3 L33 stateDiagram "业务结束" / §7 L246 "业务结束/业务超时/关闭命令" / N4 §6.1 L470 "业务结束时转换" / N5 §7 L245 "关闭会话 + 广播 ended"（注：M10 与 R2 之外的 N4 §6.1 L470 残留已被 R2 fix 验证项新 7 修复，本条仅指其他位置）
- L1–L7（首轮 review 标注的 7 项低优先级问题）—— efdbeb8 commit message 已声明"未涉及 L1–L7"

---

## 通过项（最终）

| 维度 | 状态 |
|------|------|
| registerTool 命名一致性 | ✅ 通过（除 N5 §11 R2） |
| registerTool 契约一致性 | ✅ 通过 |
| registerTool 数量一致性（N4=N6=15） | ✅ 通过 |
| 任务日志生命周期阶段命名 | ✅ 通过 |
| buffer.changes 清空时机 | ✅ 通过 |
| PR 提交职责划分 | ✅ 通过 |
| feature flag 列表（5 个） | ✅ 通过 |
| PR-1~PR-4 描述 | ✅ 通过 |
| 审计 journal state 字段 | ✅ 通过 |
| 任务日志对象生命周期阶段 | ✅ 通过 |
| 6 节点 cross-reference | ✅ 通过 |
| 文档行数（合计） | ✅ wc -l 与 N6 §11 自指漂移 3 行（已知，不影响合并） |

---

## 总结

### 总体评价

**efdbeb8 修复主体完整，9 处残留全部清零（仅 grep 命令行专项检查显示 6 个分析文档 0 行残留），5 项裁决全部落地，N4/N6 registerTool 总数一致为 15**。

- **9 处残留修复**：100% 通过（含 R1/R2 修复项新 1/2/3/4/5/6/7/8/9 全部命中）
- **5 项裁决**：全部落地（commitOnClose 5 处文档同步 / larkbot_fetch_pending_events 计入 15 / state 合法值内部矛盾消除 / 生命周期阶段 ASCII + mermaid 一致 / closeBusinessSession 命名变更注释）
- **回归检测**：发现 2 处小残留：
  - **R1（N4 §2.4 L94–95 旧表尾巴）**：efdbeb8 引入的脏数据，建议合入前最小修复
  - **R2（N5 §11 L394 closeBusinessSession 测试名）**：919c0d3 拆分时残留 + efdbeb8 commit message 标的范围（"L386–388"）错位 6 行，建议合入前最小修复
- **2 处小残留均无功能性影响**（不影响 registerTool 总数、不影响命名一致性主结论、不影响 PR 提交路径）

### 建议

**可以推 origin 开 PR，但建议在合并前追加一个最小修复 commit**（`docs(lark-bot): 清理 efdbeb8 §2.4 + §11 残留 2 处`），仅 3 处编辑（删除 N4 §2.4 L94–95 两行 + 修改 N5 §11 L394 测试名）。该 commit 极小（diff +3/-4），可与主 commit 一起 push，或单独追加 commit。

理由：
1. efdbeb8 已修复 9 处残留的全部实质性内容
2. R1 是表叠加错位（视觉问题 + 严格合计行冲突）
3. R2 是与 N5 §4 命名变更注释直接矛盾的测试名
4. 这 2 处都是"按 commit message 应修但遗漏"的边角，不构成新问题
5. 推 origin 后在 PR review 中 reviewer 大概率会再次指出，提前处理减少 PR review 往返

### 最终判断

**是否可以推 origin 开 PR：是**（建议追加 R1+R2 最小修复后）

**总体评级**：**minor**（主体质量 pass，2 处边角残留需在合并前清理）

---

## 审查证据清单

- 已实际读取所有 8 个文档：
  - `docs/lark-bot-business-flow.md`（N1，291 行）
  - `docs/lark-bot-pi-agent-contract.md`（N2，450 行）
  - `docs/lark-bot-extension-migration-analysis.md`（N3，383 行）
  - `docs/lark-bot-migration-roadmap.md`（N4，834 行）
  - `docs/lark-bot-task-journal-schema.md`（N5，423 行）
  - `docs/lark-bot-architecture-analysis.md`（N6，407 行）
  - `docs/lark-bot-review-report.md`（第 1 轮报告，416 行）
  - `docs/lark-bot-review-report-revised.md`（第 2 轮报告，254 行）
- 已使用 grep 工具进行残留扫描（详见各表"验证说明"列）
- 已使用 `git show efdbeb8 --stat` 与 `git diff 996a974..efdbeb8` 比对修改前后内容
- 未修改任何文档（review-only 模式）
- 输出路径：`/home/weunimix/projects/ffxiv-about/FFXIVRanking/.pi-subagents/artifacts/outputs/259cd2cd/docs/lark-bot-review-report-final.md`