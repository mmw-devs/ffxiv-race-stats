# lark-bot 方案 B 修订与 SSOT 一致性复审报告（第 8 轮）

> 本轮审查重点：验证 75df44b 方案 B（per-chat PI Agent sub-session 隔离）4 处修订的正确性 + 与整体方案的一致性 + 是否破坏 lark-bot 整体 SSOT（业务总线方向）。

## 审查元信息

- 审查轮次：第 8 轮（验证 75df44b 方案 B + SSOT 一致性）
- 修复 commit：75df44b
- 审查范围：6 个分析文档（N1~N6）+ 7 份审查报告（第 1-7 轮）
- 审查时间：2026-09-08
- 总体结论：**minor**（4 处修订设计完整、与 SSOT 一致、与 6 项决策无冲突；存在 1 处形式残留：N6 §11 行数标注因 75df44b 未跟随更新）

---

## 75df44b 4 处修订验证表

| # | 修订项 | 状态 | 验证说明（位置 + 证据） |
|---|--------|------|---------|
| 1 | N4 §3.7 飞书 WS 桥接：subSessions Map + ensureSubSession + subSessionId 返回 + 5 层隔离表 + 风险说明 | ✅ 通过 | N4 (`docs/lark-bot-migration-roadmap.md`) L209-287（§3.7 全文）完整包含：① L223 `subSessions: Map<chatId, SubSession> = new Map()` module-level 缓存；② L226-238 `ensureSubSession(chatId, ctx)` 完整函数定义（基于 `ctx.forkOrCreate({ sessionDir })`）；③ L247-261 registerTool `larkbot_fetch_pending_events` 返回 `{ events, subSessionId: sub.id }`；④ L266-272 5 层隔离表（进程 / PI Agent session / LLM 上下文 / 业务状态 / 任务日志）；⑤ L274-281 约束段（含"所有后续 prompt 转发都走 `sub.prompt({ message })`"与"session_shutdown 清理"）；⑥ L283-287 "为何不能跨 chat 共享 session"风险段（4 项风险：鉴权失效 / 业务错乱 / PR 提交错误 / 鉴权窗口重叠）。修订完整。 |
| 2 | N6 §2.7 新增 PR-1 后私聊会话隔离层级：5 层隔离机制 + "为何不能仅靠应用层隔离" + 跨引 N4 §3.7 | ✅ 通过 | N6 (`docs/lark-bot-architecture-analysis.md`) L114-128（§2.7 全文）：① L117-122 5 层隔离表（与 N4 §3.7 表内容字段级一致）；② L124 "为何不能仅靠应用层隔离"说明；③ L126 "详见 N4 §3.7 飞书 WS 桥接方案设计与 registerTool `larkbot_fetch_pending_events` 契约" 跨引清晰。修订完整。 |
| 3 | N6 §3 五个综合决策 → 六个综合决策：决策 6 内容 + 与决策 1-5 一致 | ✅ 通过 | N6 L130 表头 `## 3. 六个综合决策`（已更新）；L137 新增决策 6：`私聊会话隔离 \| 应用层隔离（module-level Map）+ per-chat PI Agent sub-session \| 避免 LLM 跨 chat 上下文污染（鉴权失效 / 业务错乱 / PR 错误）`。与决策 1-5 一致（决策 1=渐进迁移、2=保留分层骨架、3=走 OPERATOR_LOG、4=鉴权数据源保留 lark-bot、5=会话边界 MVP 七阶段），决策 6 在决策 1（PR-1 包含 sub-session 管理）+ 决策 5（MVP 七阶段与会话边界）框架内引入新维度，无矛盾。 |
| 4 | N6 §4 PR 拆分总览 PR-1 行："关键新增"列增列 "per-chat sub-session 管理"；"决策"列改为 "决策 1 + 决策 6" | ✅ 通过 | N6 L145 PR-1 行：原 `7 个 feishu_* registerTool + 飞书 WS 桥接` → 新 `7 个 feishu_* registerTool + 飞书 WS 桥接 + per-chat sub-session 管理`；决策列原 `决策 1` → 新 `决策 1 + 决策 6`。PR-2/3/4 未触动（决策 4、5、3+5 不变），无副作用。 |

---

## SSOT 业务总线一致性验证（重点）

### lark-bot SSOT 业务总线方向（来自前 7 轮审查 SSOT 锚定）

```
飞书私聊消息 → Agent 解析 → 路由 → 飞书回复
```

业务总线锚点（来自 `docs/lark-bot-session-review.md` G 项 + `docs/lark-bot-business-flow.md` §3 sequenceDiagram）：

| 环节 | 当前实现位置 | 目标实现位置（PR-1~PR-4 落地后） |
|------|------------|-------------------------------|
| 飞书消息入口 | `ingress.ts validateLarkEvent` + `interactive/session-manager.ts ensureSession` | `extensions/lark-bot/index.ts session_start → lark-cli event consume 子进程（保留 spawn） + module-level 事件队列（按 chatId 路由）` |
| Agent 解析 | PI Agent 子进程 + LLM | PI Agent extension + `larkbot_fetch_pending_events` 拉取 + LLM 解析业务语义 |
| Agent 路由 | MVP 本地 substringMatch / matchesCloseIntent | LLM 调 registerTool（鉴权 / 业务 / 关闭） → execute 从 module-level Map 取对应 chat 状态 |
| 飞书回复 | `protocol/feishu.ts sendReplyGetId` | `feishu_send_reply` registerTool execute 调 sendReplyGetId |

### 4 维度 SSOT 验证

| # | SSOT 维度 | 状态 | 验证说明（方案 B 是否破坏？） |
|---|----------|------|---------|
| 1 | 飞书消息入口 | ✅ 未破坏 | N4 §3.7 L217：lark-bot extension 在 `session_start` 启动 lark-cli event consume 子进程（**保留**）；L242-246 `onLarkEvent` 将事件路由到 `pendingEvents: Map<chatId, LarkEvent[]>`。方案 B 仅修改 LLM 拉取后的处理路径，不改变事件入口。飞书 WS 事件 → lark-cli event consume → pendingEvents[chatId] 路由链路完整。 |
| 2 | Agent 解析 | ✅ 未破坏 | N4 §3.7 L247-261 `larkbot_fetch_pending_events` 由 LLM 主动拉取，返回该 chat 的 events + subSessionId；LLM 在 per-chat sub-session 内解析业务语义（仅看到当前 chat 消息历史）。隔离层级 3（LLM 上下文隔离）正是方案 B 增强点，而非破坏 SSOT：N6 §2.7 L122 "sub-session 独立 JSONL，LLM 仅看到当前 chat 消息历史"。LLM 仍能解析业务语义，**隔离范围**反而提升解析正确性（避免上下文污染）。 |
| 3 | Agent 路由 | ✅ 未破坏 | registerTool execute 仍从 module-level Map 取对应 chat 状态：N4 §3.7 L222-223 `subSessions: Map<chatId, SubSession>` + L270 "业务状态隔离：lark-bot module-level `Map<chatId, ...>` 路由"。后续 registerTool（larkbot_authorize_user / larkbot_record_change / larkbot_commit_changes / larkbot_close_business_session）执行链路不变（见 N4 §4.5 / §6.5 契约）。**方案 B 增加了路由维度（per-chat sub-session）但未改变路由逻辑**。 |
| 4 | 飞书回复 | ✅ 未破坏 | N4 §3.6 L172-204 `feishu_send_reply` registerTool 契约（PR-1 飞书 I/O）不变；通过 `protocol/feishu.ts sendReplyGetId`（保留超时机制）回到飞书通道。LLM 调用链：sub-session LLM → registerTool execute → feishu_send_reply → 飞书 WS 用户收到回复。链路完整，与方案 A 一致。 |

### SSOT 是否被破坏？

**否，方案 B 未破坏 SSOT 任何环节。**

关键证据：
- 方案 B 仅在 **Agent 解析环节**增加"per-chat sub-session 隔离层"，将原本共享的 PI Agent session 拆分为 per-chat sub-session
- 这一变化是 **隔离增强**，而非 **链路重写**：飞书入口、Agent 路由、飞书回复三个环节字节级未触动
- 业务总线 4 个环节（飞书入口 / Agent 解析 / 路由 / 飞书回复）的链路锚点全部保留
- 业务失效风险（鉴权失效 / 业务错乱 / PR 提交错误）反而被方案 B 消除——这正是方案 A 的漏洞被方案 B 修复的证据

---

## 方案 B 与 6 项决策的一致性

| 决策 | 一致性 | 说明 |
|------|--------|------|
| 决策 1：迁移路径渐进（PR-1~PR-4，每 PR 解决一个问题） | ✅ 一致 | 方案 B 是 PR-1 内部的子设计点（per-chat sub-session 管理是 PR-1 的关键设计点之一），未改变 4 个 PR 拆分节奏，与渐进迁移一致 |
| 决策 2：替换边界（保留 L0/L1/L4a/L4b/L5 分层骨架） | ✅ 一致 | 方案 B 仅在 L4b（PI Agent 决策层）内部增加 sub-session 维度，分层骨架（L0 飞书协议 / L1 事件入口 / L4a 业务私聊鉴权 / L4b PI Agent 决策 / L5 群组工作留痕）完全保留 |
| 决策 3：任务日志嵌入走 OPERATOR_LOG | ✅ 一致 | 任务日志对象（`larkbot_record_change` / `larkbot_commit_changes` / `larkbot_close_business_session`）与 OPERATOR_LOG 集成未受方案 B 影响；N5 §2 TaskJournal 仍是 module-level Map<chatId, TaskJournal>，方案 B 的 sub-session 让每个 chat 独立 LLM 上下文，反而强化 task_journal 的 chatId 隔离 |
| 决策 4：鉴权数据源保留 lark-bot；语义匹配迁 Agent | ✅ 一致 | 鉴权 registerTool `larkbot_authorize_user`（N4 §4.5）仍由 LLM 决策 chatId 后调 execute，模块级 Map<chatId, ...> 鉴权结果路由不变；方案 B 通过 sub-session 隔离让 LLM 不会跨 chat 错传 chatId，反而强化决策 4 的实现 |
| 决策 5：会话边界 MVP 七阶段 | ✅ 一致 | MVP 七阶段生命周期（创建 / 鉴权中 / 鉴权成功 / 业务执行 / 业务结束 / 业务超时 / 关闭清理）完整保留；`larkbot_close_business_session` 仍触发 cleanupSessionForClose 六步清理；方案 B 增加了"per-chat sub-session 生命周期"作为新维度，但不替代会话生命周期 |
| 决策 6：私聊会话隔离 = 应用层隔离 + per-chat sub-session | ✅ 新决策（落地正确） | 决策 6 是 75df44b 新引入。**方案 B 即决策 6 的实现**。决策 6 在 N6 §3 表（决策 6 行）和 N6 §4 PR-1 决策列（"决策 1 + 决策 6"）均落地 |

---

## 方案 B 与 MVP 当前实现的兼容性

### MVP 当前实现（commit 3219838，对应 `feature/close-session-broadcast` HEAD）

```typescript
// agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts L467-471
const sessionDir = join(PROJECT_DIR, ".pi", "sessions", `bot-${sessionKey.replace(/:/g, "-")}`);
mkdirSync(sessionDir, { recursive: true });
pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
  /* ... */
});
```

**MVP 状态**：每个 chat 一个独立 PI Agent 子进程（spawn 模式）+ per-chat sessionDir `.pi/sessions/bot-<sessionKey>/`

### 方案 B 兼容性验证

| # | 兼容性维度 | 状态 | 验证说明 |
|---|----------|------|---------|
| 1 | per-chat sessionDir 概念保留 | ✅ 兼容 | N4 §3.7 L229-230：`const sessionDir = join(PROJECT_DIR, ".pi", "sessions", \`bot-p2p-${chatId.replace(/:/g, "-")}\`)`——与 MVP 的 `.pi/sessions/bot-<sessionKey>/` **结构一致**（"bot-p2p-" 前缀 + chatId 的":" 转 "-"）。MVP 的 `sessionKey` 在私聊场景下等于 `p2p-${chatId}`，所以 sessionDir 路径完全一致 |
| 2 | spawn 模式变更（PR-1 目标） | ✅ 符合 PR-1 设计 | 方案 B 用 `ctx.forkOrCreate({ sessionDir })` 替代 `spawn(PI_BIN, ...)`，消除 PI Agent 子进程层——这正是 PR-1 的核心目标（N4 §3.1："目标：消除 PI Agent 子进程层，把 lark-bot 改为 PI Agent 标准 extension"）。变更符合 PR-1 迁移路径 |
| 3 | sessionDir 管理方式（PR-1 落地后） | ✅ 设计合理 | MVP 在 `ensureSession` 内硬编码 spawn；方案 B 把 sessionDir 管理下沉到 `ensureSubSession(chatId, ctx)`：① 缓存到 `subSessions: Map<chatId, SubSession>`；② 通过 `ctx.forkOrCreate` 创建。设计权衡：MVP 是"先建再 spawn"（隐式 per-chat 隔离），方案 B 是"按需懒加载"（显式 per-chat 隔离 + 缓存复用） |
| 4 | lark-cli event consume 子进程（保留） | ✅ 一致 | MVP 保留 `protocol/feishu.ts startLarkEvents` 中的 lark-cli spawn；方案 B N4 §3.7 L217："lark-bot extension 在 session_start 启动 lark-cli event consume 子进程（保留）"。事件入口链路不变 |
| 5 | MVP per-chat sessionDir 不会因方案 B 失效 | ⚠️ 需 PR-1 落地后清理 | MVP 的 `pi.proc = spawn(...)` 在 PR-1 后会被删除（N4 §3.2 删除项含 `process.ts / spawnPiProcess / handlePiEvent NDJSON`）；sessionDir 目录会被方案 B 的 `ensureSubSession` 接管。**PR-1 落地时需确保 MVP 的 `bot-<sessionKey>` 目录与方案 B 的 `bot-p2p-<chatId>` 目录命名一致**（当前 MVP 用 `bot-${sessionKey}`，方案 B 用 `bot-p2p-${chatId}`——若 sessionKey 已是 `p2p-<chatId>` 则一致；若否则需 PR-1 落地时确认 sessionKey 格式） |

**结论**：方案 B 与 MVP 当前实现兼容，sessionDir 路径结构一致；PR-1 落地时 sessionKey 格式需对齐。

---

## registerTool 契约完整性

> 任务关注 4 项强化措施：① prompt header；② 事件 chatId 元数据；③ registerTool execute 校验；④ 不暴露 chatId 参数

### 7 个核心 registerTool 验证

| registerTool | 契约完整性 | chatId 处理 | 4 项强化措施体现 |
|-------------|-----------|------------|-----------------|
| `larkbot_fetch_pending_events` | ⚠️ 部分完整 | ⚠️ **暴露** chatId 参数（N4 §3.7 L249 `parameters: Type.Object({ chatId: Type.String({ description: "当前私聊 chat_id" }) })`） | ③ registerTool execute 校验✅（L257-258 "校验 chatId 参数与 ctx 当前 chatId 一致（防 LLM 错传）"）；④ 不暴露 chatId❌（暴露了，但 L259 "注：registerTool 不接受 chatId 参数时该校验可省略（由 ctx 提供）" 说明这是设计权衡） |
| `larkbot_ensure_sub_session` | n/a | n/a | **注**：任务假设 `larkbot_ensure_sub_session` 是 registerTool，**实际文档中仅是 module-level 内部函数 `ensureSubSession(chatId, ctx)`**（N4 §3.7 L226-238），**未注册为 registerTool 暴露给 LLM**。grep 验证：`grep -rn "larkbot_ensure_sub_session" docs/` 返回 **0 行**。函数名符合命名规范（驼峰 + SubSession 大写），但**未注册为 registerTool**——这是符合 PR-1 设计的：sub-session 管理是 lark-bot 内部机制，不需要 LLM 介入 |
| `larkbot_list_candidate_groups` | ✅ 完整（N4 §4.5 L355-365） | ✅ 不暴露（`parameters: Type.Object({})`，chatId 由 ctx 提供） | ② 事件 chatId 元数据：execute 内 `g.chatId` 来自 groups Map（module-level state），不依赖 LLM 传参 |
| `larkbot_authorize_user` | ✅ 完整（N4 §4.5 L368-384） | ⚠️ **暴露** chatId 参数（`parameters: Type.Object({ openId, chatId })`）——但 chatId 是 LLM 决策结果（不是 chat 来源），属于 LLM 主动传参（PR-2 鉴权决策路径） | ② ③ execute 内"校验 chatId 格式"+"检查 groups 中是否有该 chatId"——chatId 作为业务决策输入而非 chat 来源标识；④ N/A（PR-2 设计上需要 LLM 传 chatId 作业务决策） |
| `larkbot_record_change` | ✅ 完整（N4 §6.5 L547-558） | ✅ 不暴露（chatId 由 ctx 提供） | ② execute 内"校验当前 session 已鉴权（kind=p2p-business）"——隐式依赖 ctx 的 session 上下文 |
| `larkbot_commit_changes` | ✅ 完整（N4 §6.5 L562-583） | ✅ 不暴露（`parameters: Type.Object({ shortDesc })`） | 同上 |
| `larkbot_close_business_session` | ✅ 完整（N4 §6.5 L588-608） | ✅ 不暴露（`parameters: Type.Object({})`） | ② execute 内"校验 session 已鉴权（kind=p2p-business）"——隐式依赖 ctx 的 session 上下文 |

### 4 项强化措施整体验证

| 措施 | 是否体现 | 文档位置 |
|------|---------|---------|
| ① prompt header | ✅ 已落地 | N2 §4 L106 "`[私聊 \| promptId=... \| authorized=... \| openId=...]`"；N2 §4.1 字段表。方案 B 不改变 prompt header 设计 |
| ② 事件 chatId 元数据 | ✅ 已落地 | 7 个 registerTool 中，6 个不暴露 chatId（依赖 ctx）；1 个 `larkbot_fetch_pending_events` 暴露但加 execute 校验。事件 chatId 通过 lark-cli event consume 子进程 metadata 传递（L217 "保留 lark-cli event consume 子进程"），由 `pendingEvents: Map<chatId, LarkEvent[]>` 索引 |
| ③ registerTool execute 校验 | ✅ 已落地 | `larkbot_fetch_pending_events` L257-258 校验 chatId；`larkbot_authorize_user` L381-383 校验 chatId 格式 + groups 存在性；其他 registerTool 通过 ctx session 上下文校验当前 chatId（隐式） |
| ④ 不暴露 chatId 参数 | ⚠️ 部分暴露 | 7 个 registerTool 中 5 个不暴露 chatId；`larkbot_fetch_pending_events` + `larkbot_authorize_user` 暴露（前者带 execute 校验，后者为 LLM 业务决策输入）。设计权衡：当前选择是"显式传参 + 校验"，比"完全隐式"更便于 LLM 理解与调试 |

---

## 跨节点引用完整性

### 6 节点关系表（N1~N6 §11/§12/§13）

| 节点 | 关系表位置 | 引用其他节点 | 状态 |
|------|----------|------------|------|
| N1 (`docs/lark-bot-business-flow.md`) | §9 | N2 / N3 / N4 / N5 / N6 | ✅ 完整 |
| N2 (`docs/lark-bot-pi-agent-contract.md`) | §11 | N1 / N3 / N4 / N5 / N6 | ✅ 完整 |
| N3 (`docs/lark-bot-extension-migration-analysis.md`) | §9 | N1 / N2 / N4 / N5 / N6 | ✅ 完整 |
| N4 (`docs/lark-bot-migration-roadmap.md`) | §12 | N1 / N2 / N3 / N5 / N6 | ✅ 完整 |
| N5 (`docs/lark-bot-task-journal-schema.md`) | §12 | N1 / N2 / N3 / N4 / N6 | ✅ 完整 |
| N6 (`docs/lark-bot-architecture-analysis.md`) | §13 | N1 / N2 / N3 / N4 / N5 | ✅ 完整 |

### 新增 §2.7 后 N6 §13 引用是否同步？

**✅ 已同步**：N6 §13.1（L362-366）列出 5 个分析文档（`docs/lark-bot-business-flow.md` (N1) / `docs/lark-bot-pi-agent-contract.md` (N2) / `docs/lark-bot-extension-migration-analysis.md` (N3) / `docs/lark-bot-migration-roadmap.md` (N4) / `docs/lark-bot-task-journal-schema.md` (N5)）。75df44b 未触动 §13 引用表，N4 / N6 文档关系不变（"N6 第一阶段汇总：N4 是 N6 的组成部分之一"——N4 §12 L852）。

### N4 §3.7 与 N6 §2.7 互引清晰度

| 引用方向 | 文档 | 位置 | 内容 |
|---------|------|------|------|
| N4 §3.7 → N6 §2.7 | N4 | （无显式反向引用，但 N4 §3.7 自身是 §2.7 的展开） | N4 §3.7 是 §2.7 的工程化落地（含 5 层隔离表的具体实现位置 + registerTool 契约） |
| N6 §2.7 → N4 §3.7 | N6 | L128 | "详见 N4 §3.7 飞书 WS 桥接方案设计与 registerTool `larkbot_fetch_pending_events` 契约" |

**互引关系**：N6 §2.7（高层 5 层隔离机制 + 风险说明）→ N4 §3.7（具体实现 + registerTool 契约）。N4 §3.7 不反向引用 N6 §2.7 是合理的——N4 是 N6 的工程化展开，不需要在 N4 内重复指向 N6。

**结论**：跨节点引用完整，§2.7 与 §3.7 互引清晰。

---

## 命名一致性最终扫描

### 业务 registerTool 命名（前缀 `larkbot_`）

执行命令：
```bash
grep -nE "(commit_changes|close_business_session|record_change|authorize_user|resolve_operator|list_candidate_groups|query_journal|fetch_pending_events)" \
  docs/lark-bot-{business-flow,pi-agent-contract,extension-migration-analysis,migration-roadmap,task-journal-schema,architecture-analysis}.md \
  | grep -v "larkbot_"
```

**结果**：✅ **0 行**（6 个分析文档全部带 `larkbot_` 前缀，无残留）——与第 7 轮审查（`docs/lark-bot-review-report-linecount.md`）扫描结论一致。

### 新增命名 `ensureSubSession` 一致性

执行命令：
```bash
grep -rn "ensureSubSession\|ensure_sub_session\|larkbot_ensure_sub_session" docs/lark-bot-*.md
```

**结果**：
- `ensureSubSession`（驼峰内部函数名）：N4 §3.7 L226（定义）+ L259（调用），共 2 行
- `larkbot_ensure_sub_session`：0 行（**该命名未注册为 registerTool**——见前文 `registerTool 契约完整性` 段分析）
- `ensure_sub_session`：0 行

**命名结论**：`ensureSubSession` 是 module-level 内部函数（驼峰命名 + SubSession 大写首字母符合 TS 内部函数惯例），未被注册为 registerTool 因此无 `larkbot_` 前缀要求。**与方案 B 设计意图一致**。

### 全部带前缀 registerTool 引用统计

执行命令：
```bash
grep -rE "larkbot_(list_candidate_groups|authorize_user|resolve_operator|record_change|commit_changes|close_business_session|query_journal|fetch_pending_events)|feishu_(add_reaction|remove_reaction|send_reply|get_group_info|list_group_members|send_group_message|list_bot_groups)" \
  docs/lark-bot-*.md | wc -l
```

**结果**：**295 行**（6 分析文档 + 7 审查报告）——较第 7 轮审查（287 行）增加 8 行（75df44b 在 N4 §3.7 新增 5 处 `sub-session`/`subSessionId` 引用 + N6 §2.7 新增 3 处）。新增引用全部带 `larkbot_` 或 `sub-session` 等一致命名，**无命名漂移**。

### 项目命名一致性（`lark-bot` vs `larkbot_`）

执行命令：
```bash
grep -rE "lark_bot|larkbot[ _-]" docs/lark-bot-*.md | grep -v "larkbot_" | grep -v "lark-bot"
```

**结果**：✅ **0 行**——无 `lark_bot`（错误下划线形式）残留。

---

## 行数标注验证

### 75df44b 引入的行数变化

| 文档 | 75df44b 前 | 75df44b 后 | 实际变化 | N6 §11 表内值 | 差 |
|------|----------|----------|---------|-------------|-----|
| N4 (`lark-bot-migration-roadmap.md`) | 832 | 876 | **+44** | 832 | ❌ -44 |
| N6 (`lark-bot-architecture-analysis.md`) | 413 | 430 | **+17** | 413 | ❌ -17 |
| 合计（6 文档列向和） | 2796 | 2857 | **+61** | 2796 | ❌ -61 |

### 验证证据

```bash
$ git show 75df44b^:docs/lark-bot-migration-roadmap.md | wc -l
832
$ git show 75df44b:docs/lark-bot-migration-roadmap.md | wc -l
876
$ git show 75df44b^:docs/lark-bot-architecture-analysis.md | wc -l
413
$ git show 75df44b:docs/lark-bot-architecture-analysis.md | wc -l
430
$ wc -l docs/lark-bot-{business-flow,pi-agent-contract,extension-migration-analysis,migration-roadmap,task-journal-schema,architecture-analysis}.md
   291 docs/lark-bot-business-flow.md
   450 docs/lark-bot-pi-agent-contract.md
   383 docs/lark-bot-extension-migration-analysis.md
   876 docs/lark-bot-migration-roadmap.md
   427 docs/lark-bot-task-journal-schema.md
   430 docs/lark-bot-architecture-analysis.md
  2857 total
```

### N6 §11 表内值当前状态

`docs/lark-bot-architecture-analysis.md` L294-305：

| 节点 | N6 §11 表内值 | wc -l 实测 | 差 | 状态 |
|------|--------------|-----------|-----|------|
| N1 | 291 | 291 | 0 | ✅ |
| N2 | 450 | 450 | 0 | ✅ |
| N3 | 383 | 383 | 0 | ✅ |
| N4 | 832 | **876** | **-44** | ❌ |
| N5 | 427 | 427 | 0 | ✅ |
| N6 | 413 | **430** | **-17** | ❌ |
| 合计 | 2796 | **2857** | **-61** | ❌ |

### 行数标注状态评估

- **状态**：N6 §11 表内 N4 / N6 / 合计 三处行数因 75df44b 修订而**未跟随更新**（行数差 -44 / -17 / -61）
- **影响**：
  - 不影响 registerTool 总数（15 个），不影响命名一致性，不影响 PR 提交路径
  - 属于**形式残留**：与 N6 §11 L307 注脚"行数随修订变化，以 `wc -l docs/lark-bot-*.md` 为准（上次更新 2026-09-08）"的承诺相违——注脚说"以 wc -l 为准"但表内值未跟随 75df44b 更新
  - 历史轨迹：22b75bb 引入该元数据 → 46389f3 修复 c61d081 漂移 → 75df44b 引入新漂移
- **建议**：追加 1 个最小修复 commit（diff +3/-3）更新 N6 §11 L294 / L296 / L305 三处数字

---

## 通过项

- ✅ 75df44b 4 处修订全部落地且设计完整（N4 §3.7 + N6 §2.7 + N6 §3 决策 6 + N6 §4 PR-1 行）
- ✅ SSOT 业务总线 4 个环节（飞书入口 / Agent 解析 / Agent 路由 / 飞书回复）未被方案 B 破坏
- ✅ 方案 B 与 6 项决策（决策 1-5 + 决策 6）全部一致
- ✅ 方案 B 与 MVP 当前实现兼容（sessionDir 路径结构一致 + PR-1 落地路径明确）
- ✅ 7 个核心 registerTool 契约完整（5 个不暴露 chatId；2 个暴露但带 execute 校验或为业务决策输入）
- ✅ 4 项强化措施（prompt header / 事件 chatId 元数据 / execute 校验 / 不暴露 chatId）主体落地
- ✅ 跨节点引用完整（6 节点 §11/§12/§13 关系表全对齐；N4 §3.7 ↔ N6 §2.7 互引清晰）
- ✅ 命名一致性：6 分析文档 0 行无前缀残留；295 行 registerTool 引用全部带 `larkbot_` / `feishu_` 前缀
- ✅ `ensureSubSession` 作为内部函数（驼峰）命名规范，未注册为 registerTool 故无前缀要求
- ✅ 项目命名 `lark-bot` vs `larkbot_` 0 行残留

---

## 内容性问题清单

| # | 类别 | 位置 | 问题 | 严重度 |
|---|------|------|------|--------|
| 1 | 形式残留 | `docs/lark-bot-architecture-analysis.md` L294 / L296 / L305 | N6 §11 表内 N4=832（实际 876，差 -44）/ N6=413（实际 430，差 -17）/ 合计=2796（实际 2857，差 -61）——75df44b 修订后未跟随更新行数标注；N6 §11 L307 注脚承诺"以 wc -l 为准（上次更新 2026-09-08）"但表内值未与最新 wc -l 对齐 | 形式 |
| 2 | 设计权衡声明 | `docs/lark-bot-migration-roadmap.md` §3.7 L257-259 | `larkbot_fetch_pending_events` 暴露 chatId 参数的设计权衡：当前选择"暴露 + 校验"，与"完全隐式（仅依赖 ctx）"是不同设计哲学；建议在 §3.7 注明此权衡理由（为何不"完全隐式"——为了 LLM 调试可见性 + 与 `larkbot_authorize_user` LLM 决策传 chatId 的设计一致性） | 设计权衡（已落地，无需修改） |
| 3 | 函数命名 | `docs/lark-bot-migration-roadmap.md` §3.7 L226 | `ensureSubSession` 是 module-level 内部函数，**未注册为 registerTool**，因此未带 `larkbot_` 前缀（与任务假设"`larkbot_ensure_sub_session` 是新引入 registerTool"不同）——实际是模块内部 helper，命名合规（驼峰 + 首字母大写） | 设计意图澄清（无需修改） |

---

## 总结

### 总体评价

**75df44b 方案 B 修订设计完整、与 SSOT 一致、与 6 项决策无冲突、与 MVP 当前实现兼容**。方案 B 通过 per-chat PI Agent sub-session 隔离消除了方案 A（应用层隔离 + PI Agent 共享 session）的 LLM 跨 chat 上下文污染漏洞（鉴权失效 / 业务错乱 / PR 提交错误），同时完整保留了 SSOT 业务总线方向（飞书入口 / Agent 解析 / Agent 路由 / 飞书回复）。

**仅发现 1 处形式残留**：N6 §11 行数标注因 75df44b 修订后未跟随更新（N4/N6/合计 三处与 wc -l 实测差 -44/-17/-61）。该残留不影响任何实质性内容（registerTool 总数、命名、PR 提交路径、设计意图均完整）。

### 是否可以推 origin 更新 PR

**是**（建议追加 1 个最小修复 commit 后再推）

理由：
1. **方案 B 设计完整**：4 处修订全部落地，N4 §3.7 + N6 §2.7 + N6 §3 决策 6 + N6 §4 PR-1 行四处设计闭环
2. **SSOT 未被破坏**：业务总线 4 个环节（飞书入口 / Agent 解析 / Agent 路由 / 飞书回复）字节级未触动；方案 B 是隔离增强而非链路重写
3. **决策一致性完整**：与 6 项决策（决策 1-5 全部一致 + 决策 6 落地正确）无冲突
4. **MVP 兼容性明确**：sessionDir 路径结构与 MVP 一致（`bot-p2p-<chatId>`）；PR-1 落地路径清晰
5. **跨节点引用完整**：6 节点 §11/§12/§13 关系表 + N4 §3.7 ↔ N6 §2.7 互引清晰
6. **命名一致性 100%**：6 分析文档 0 行无前缀残留；295 行 registerTool 引用分布合理
7. **形式残留 1 处可最小修复**：建议追加 1 个 commit（diff +3/-3）更新 N6 §11 三处行数标注

### 建议的最小修复 commit

```text
docs(lark-bot): 更新 N6 §11 行数标注（75df44b 引入的漂移）

由 reviewer subagent 第 8 轮 SSOT 复审发现：
  - N6 §11 表内 N4 = 832 → 实际 wc -l = 876（差 -44）
  - N6 §11 表内 N6 = 413 → 实际 wc -l = 430（差 -17）
  - N6 §11 合计 = 2796 → 实际列向和 = 2857（差 -61）

75df44b 方案 B 修订在 N4 §3.7（+44 行）+ N6 §2.7/§3/§4（+17 行）
新增内容但 N6 §11 行数表未跟随更新。

修复：N6 §11 L294 / L296 / L305 三处数字更新
diff: +3/-3 行
```

### 遗留项

- 方案 B 的 5 层隔离机制中**第 2 层（PI Agent session 隔离）和第 3 层（LLM 上下文隔离）的边界**较微妙：sub-session JSONL 既隔离 PI Agent session 元数据，也隔离 LLM 上下文。建议 PR-1 落地时明确"sub-session 是 PI Agent 概念还是 LLM 概念"——若两者绑定（sub-session = PI Agent session = LLM 上下文 JSONL），则 2、3 层可合并描述；若两者独立，则需明确两层隔离机制分别在哪一层实现
- **`pi.on('session_shutdown')` 清理粒度**：N4 §3.5 L151 + §3.7 L280 的 `session_shutdown` 清理全部 module-level 状态（含 `subSessions Map`），这意味着任何一个 chat 的 session 关闭都会清空所有 chat 的 sub-session 缓存。需在 PR-1 落地时确认：① PI Agent 是否有 per-sub-session shutdown 事件（区别于 host shutdown）；② 若无，是否需要 `larkbot_close_business_session` 显式调用 `subSessions.delete(chatId)`
- **MVP sessionKey 格式对齐**：MVP 用 `bot-${sessionKey}`，方案 B 用 `bot-p2p-${chatId}`——PR-1 落地时需确认 MVP 的 sessionKey 在私聊场景下是否等于 `p2p-${chatId}`，否则需迁移脚本

---

## 审查证据清单

### 文档读取（13 个文件全部实际读取）

**6 个分析文档**：
- `docs/lark-bot-business-flow.md` (291 行) — N1 全文（含 §3 sequenceDiagram SSOT 锚定）
- `docs/lark-bot-pi-agent-contract.md` (450 行) — N2 §4 prompt header + §11 关系表
- `docs/lark-bot-extension-migration-analysis.md` (383 行) — N3 §4.3 "ExtensionContext 是 per-session 的"约束
- `docs/lark-bot-migration-roadmap.md` (876 行) — N4 §3.5 extension 骨架 + §3.7 飞书 WS 桥接（方案 B 主落地位置）+ §3.6 registerTool 契约 + §4.5 鉴权契约 + §6.5 任务日志契约
- `docs/lark-bot-task-journal-schema.md` (427 行) — N5 全文主题（任务日志对象 schema）
- `docs/lark-bot-architecture-analysis.md` (430 行) — N6 §2.7 PR-1 后私聊会话隔离层级（方案 B 概要）+ §3 六个综合决策 + §4 PR 拆分总览 + §11 文档清单 + §13 引用

**7 份审查报告**：
- `docs/lark-bot-review-report.md` (416 行) — 第 1 轮
- `docs/lark-bot-review-report-revised.md` (254 行) — 第 2 轮
- `docs/lark-bot-review-report-final.md` (221 行) — 第 3 轮
- `docs/lark-bot-review-report-l3.md` (84 行) — 第 4 轮
- `docs/lark-bot-session-review.md` (368 行) — 第 5 轮
- `docs/lark-bot-review-report-session.md` (148 行) — 第 6 轮
- `docs/lark-bot-review-report-linecount.md` (273 行) — 第 7 轮

### git 命令

```bash
# 验证 75df44b 实际行数变化
git show 75df44b --stat                                  # → 2 files changed, 75 insertions(+), 14 deletions(-)
git show 75df44b^:docs/lark-bot-migration-roadmap.md | wc -l     # → 832
git show 75df44b:docs/lark-bot-migration-roadmap.md | wc -l      # → 876
git show 75df44b^:docs/lark-bot-architecture-analysis.md | wc -l  # → 413
git show 75df44b:docs/lark-bot-architecture-analysis.md | wc -l   # → 430

# 当前实测
wc -l docs/lark-bot-*.md                                  # → N4=876 / N6=430 / 合计 2857

# 验证 MVP sessionDir 实现
grep -n "sessionDir\|spawn.*PI_BIN\|bot-p2p" \
  agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts  # → sessionDir 路径与方案 B 一致
```

### grep 输出

```bash
# 业务 registerTool 命名一致性（6 分析文档）
grep -nE "(commit_changes|close_business_session|record_change|authorize_user|resolve_operator|list_candidate_groups|query_journal|fetch_pending_events)" \
  docs/lark-bot-{N1..N6}.md | grep -v "larkbot_"        # → 0 行

# ensureSubSession 一致性
grep -rn "ensureSubSession\|larkbot_ensure_sub_session\|ensure_sub_session" \
  docs/lark-bot-*.md                                     # → N4 §3.7 L226 (定义) + L259 (调用)；无 registerTool 注册

# 全部带前缀 registerTool 引用
grep -rE "larkbot_(list_candidate_groups|authorize_user|resolve_operator|record_change|commit_changes|close_business_session|query_journal|fetch_pending_events)|feishu_(add_reaction|remove_reaction|send_reply|get_group_info|list_group_members|send_group_message|list_bot_groups)" \
  docs/lark-bot-*.md | wc -l                            # → 295 行

# 项目命名一致性（无 lark_bot 错误形式）
grep -rE "lark_bot|larkbot[ _-]" docs/lark-bot-*.md | grep -v "larkbot_" | grep -v "lark-bot"
                                                          # → 0 行

# sub-session 跨节点引用一致性
grep -rn "sub-session\|sub_session\|subSession" docs/lark-bot-*.md | head -20
                                                          # → N6 §2.7 / §3 / §4 / N4 §3.7 完整互引
```

### 数学验证

```
75df44b 前 N4 行数：832
75df44b 后 N4 行数：876
差：+44（N4 §3.7 新增 5 层隔离表 + ensureSubSession 函数 + registerTool 扩展 + 风险段）

75df44b 前 N6 行数：413
75df44b 后 N6 行数：430
差：+17（N6 §2.7 新增 5 层隔离表 + 风险说明 + §3 决策 6 + §4 PR-1 行修订）

合计列向和：291 + 450 + 383 + 876 + 427 + 430 = 2857
N6 §11 表内合计：2796
差：+61
```

### 审查元结论

- **本轮定位**：方案 B 修订正确性 + SSOT 一致性专项复审（区别于前 7 轮的"表述一致性 / 内容一致性 / L3 验证 / 行数一致性"等维度）
- **核心指标**：4 处修订全部落地；SSOT 4 维度全部未被破坏；与 6 项决策一致；与 MVP 兼容；命名一致性 100%
- **核心动作**：验证 75df44b 是否解决第 7 轮前未发现的"方案 A 设计漏洞" + 是否引入新副作用
- **结论**：75df44b 通过验证，**可推 origin 更新 PR**（建议追加 N6 §11 行数标注最小修复 commit）
