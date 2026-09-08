# PI Agent 上游契约盘点与不稳定点清单（issue #168 第一阶段 N2）

> lark-bot 与 PI Agent 通信面的契约盘点，以及 PR #159 / #161 / #163 反复暴露的不稳定点清单。
> 范围：lark-bot 作为 PI Agent extension 的所有通信面。
> 不在范围：spawn vs extension 迁移分析（见 N3）、registerTool 契约设计（见 N4）、任务日志 schema（见 N5）。

## 0. 阅读对象与范围

- 阅读对象：lark-bot 维护者、Agent 协议设计者、issue #168 重构方案设计者。
- 范围：stdin/stdout NDJSON 协议面、上下文注入契约、进程生命周期契约、行为约束。
- 不在范围：lark-bot 与飞书的 I/O（归 `protocol/feishu.ts`）、业务语义判断（鉴权匹配 / 关闭意图的判定逻辑本身）。

## 1. 契约盘点总览

lark-bot 与 PI Agent 之间的通信分四层：

```
┌─────────────────────────────────────────────────────────┐
│ L1 进程层      spawn / exit / restart / stdin shutdown   │
├─────────────────────────────────────────────────────────┤
│ L2 stdin       lark-bot → PI Agent 指令                 │
├─────────────────────────────────────────────────────────┤
│ L3 stdout      PI Agent → lark-bot NDJSON 事件          │
├─────────────────────────────────────────────────────────┤
│ L4 上下文注入   prompt header / SKILL.md / env           │
└─────────────────────────────────────────────────────────┘
```

## 2. stdin 协议（lark-bot → PI Agent）

来自 `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` 与 `task-state-machine.ts`：

| 命令 | 调用点 | JSON Line | 用途 |
|------|--------|-----------|------|
| `prompt` | `task-state-machine.ts:211` | `{type:"prompt", id:promptId, message:prompt}` | 投递任务到 PI Agent |
| `get_state` | `session-manager.ts:548` | `{type:"get_state"}` | spawn 后探测 ready 状态 |
| `get_last_assistant_text` | `task-state-machine.ts:129` | `{type:"get_last_assistant_text", id:fetchId}` | agent_settled 后取最终文本 |

**契约稳定性**：稳定（lark-bot 自己构造，不依赖 PI Agent 行为）。

**约束**：

- 每条命令必须是一行 JSON（`\n` 分隔）
- `prompt` 的 `message` 字段是已装配好的完整 prompt（含 header + SKILL.md + 用户内容）
- `id` 字段是 promptId / fetchId，PI Agent 响应时必须原样回显

## 3. stdout NDJSON 协议（PI Agent → lark-bot）

由 `session-manager.ts:566+` `handlePiEvent` 处理：

| 事件类型 | 来源命令/触发 | 必填字段 | 当前处理 | 稳定性 |
|---------|--------------|---------|---------|-------|
| `response` | get_state / prompt / get_last_assistant_text | `command`, `success`, `id`, `data` | case 分支按 command 分发 | ⚠️ **不稳定** |
| `agent_end` | PI Agent 决定重试或停止 | `willRetry` | 仅日志，不消费 | 稳定 |
| `agent_settled` | agent 完成一个工作周期 | （无必填） | completeActiveTask 触发 | ⚠️ **不稳定**（issue #168 提到"有时不 emit"） |
| `task_log` | Agent 理解任务主题 | `promptId`, `subject` | handleTaskLog 定位 task + 写 journal | ⚠️ **不稳定**（issue #168 提到"有时把 JSON 放 markdown 代码块"） |
| `close_session` | Agent 识别关闭意图 | `reason?` | closeSessionFromAgent + 触发 ended 广播 | ⚠️ **不稳定**（issue #168 提到三处散落兜底） |

### 3.1 response 命令子类型

```typescript
// session-manager.ts handlePiEvent case 'response'
switch (event.command) {
  case "get_state":
    // event.success === true → pi.ready = true
    break;
  case "prompt":
    // event.success === true → 等待 agent_settled
    // event.success === false → attemptCount===0 重试；>0 ERROR 收尾
    break;
  case "get_last_assistant_text":
    // event.data.text → pendingResultFetch.resolve(text)
    // event.id 必须 === fetch.expectedId
    // 兜底：解析 text 中的 close_session JSON
    break;
}
```

### 3.2 解析容错

```typescript
// session-manager.ts:497
pi.proc.stdout?.on("data", (d: Buffer) => {
  buf += d.toString("utf-8");
  let idx: number;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try { handlePiEvent(sessionKey, JSON.parse(line)); } catch {}
  }
});
```

**容错策略**：JSON 解析失败时静默吞掉 + 写日志。**问题**：

- 静默吞掉让上游协议错误难以发现
- 不区分"格式错误"（PI Agent 真坏了）和"延迟到的过时事件"
- 不重连、不上报、不告警

## 4. 上下文注入契约

lark-bot 通过四种方式向 PI Agent 注入上下文：

| 注入方式 | 实现位置 | 备注 |
|---------|---------|------|
| prompt header | `ingress.ts formatPrompt` | `[私聊 \| promptId=... \| authorized=... \| openId=...]` |
| SKILL.md 全文 inline | `ingress.ts formatPrompt` | ⚠️ 临时方案（PR#162 起） |
| 环境变量 | `session-manager.ts spawnPiProcess` | `LARK_BOT_RUNTIME=1` 防递归 |
| `--mode rpc --session-dir` | `session-manager.ts spawnPiProcess` | PI Agent 子进程启动参数 |

### 4.1 prompt header 字段

```typescript
// ingress.ts formatPrompt 片段
return [
  `[私聊 | promptId=${promptId} | authorized=${pi.authorized} | openId=${event.sender_id}]`,
  `[协议] 以下为 lark-bot-protocol skill 全文。处理本任务时必须严格遵守：`,
  "```",
  skillContent,
  "```",
  `${stripMention(event.content)}`,
].join("\n");
```

**契约假设**（lark-bot 持有）：

- PI Agent 能在 prompt 中识别 `[协议]` 段并加载协议语义
- PI Agent 能从 prompt header 中读取 promptId 用于 task_log 上报
- PI Agent 能识别 `[私聊 | authorized=true]` 决定是否走业务执行路径

**未验证假设**：当前 lark-bot 无法验证 PI Agent 是否真按 prompt header 行为。

### 4.2 SKILL.md 全文 inline（不稳定点 #3）

**为什么 inline**：

- PI Agent 不自动扫描 cwd 下 `.pi/skills/`（issue #168 明确）
- PI Agent 拒绝带 markdown 的 system prompt append（issue #168 / PR #159 明确）
- 因此 lark-bot 把 `agent-src/.pi/skills/lark-bot-protocol/SKILL.md` 全文塞进 prompt

**问题**：

- SKILL.md 体积增长会撑爆 prompt 上下文窗口
- 与 prompt 内容穿插，PI Agent 可能把 SKILL.md 内容误当用户输入
- 无法保证 PI Agent 准确理解"以下为协议"指令（与 #3 不稳定点同根）

### 4.3 环境变量 LARK_BOT_RUNTIME=1

```typescript
// extensions/lark-bot/index.ts:36
if (process.env.LARK_BOT_RUNTIME === "1") return; // 防递归
```

**作用**：PI Agent 启动 lark-bot 时，lark-bot 不会因为 PI Agent 的 `session_start` 事件递归启动自己。

**契约稳定性**：稳定。

## 5. 进程生命周期契约

```typescript
// session-manager.ts:471
pi.proc = spawn(PI_BIN, ["--mode", "rpc", "--session-dir", sessionDir], {
  cwd: PROJECT_DIR,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, LARK_BOT_RUNTIME: "1" },
  shell: IS_WIN,
});
```

### 5.1 启动契约

| 契约项 | 当前实现 | 稳定性 |
|-------|---------|-------|
| 命令 | `pi --mode rpc --session-dir <sessionDir>` | 假设稳定 |
| 工作目录 | `process.cwd()`（PR #135 修复后） | ⚠️ 调用方必须从仓库根启动（config.ts sanity check） |
| stdio | pipe × 3 | 稳定 |
| 环境 | `LARK_BOT_RUNTIME=1` 必须设置 | 稳定 |
| Shell | Windows 下 `shell: true` | 已知 Windows 行为差异 |

### 5.2 退出与重启契约

```typescript
// session-manager.ts:505+
pi.proc.on("exit", (code) => {
  // 1. activeTask 强制 ERROR + emitTaskJournal
  // 2. pendingResultFetch resolve(null)
  // 3. recordPiRestart（per-session 重启计数器）
  // 4. 5s 后 spawnPiProcess 重启（除非 permanentlyDead）
});
```

**契约假设**：PI Agent 进程是**可重启的长时间运行子进程**——重启后通过 `--session-dir` 加载历史上下文。

**风险**：

- 重启后 activeTask 丢失（已强制 ERROR 收尾）
- waitingTasks 保留但 prompt 上下文是新 PI Agent 实例的
- seenMessageIds 保留

### 5.3 重启风暴防护（双层）

| 层 | 文件 | 阈值 | 触发 |
|----|------|------|------|
| 进程级 | `process.ts checkRestartStorm` | 5min 内 ≥3 次 → cooldown 5min | lark-bot 进程被 supervisor 重启 |
| per-session | `session-manager.ts recordPiRestart` | 5min 内 ≥10 次 → permanentlyDead | 单 session 的 PI Agent 子进程重启 |

**问题**：

- 两层阈值不同（3 vs 10），无明确文档说明为什么不同
- 两层都写日志到 `/tmp/`，但路径不同（`lark-bot.restart-history` vs `lark-bot.pi-restart-history`）
- 运维侧需要看两个文件才能完整判断

### 5.4 stdin shutdown（已撤回）

PR #159 → PR #160 → PR #161 演进：

| PR | 内容 | 结果 |
|----|------|------|
| #159 | 引入 stdout NDJSON close_session | 合并 |
| #160 | 引入 stdin IPC shutdown | 合入后撤回 |
| #161 | 撤回 #160，恢复 #159 stdout NDJSON | 合并 |

**撤回原因**：Windows 下 `subprocess.kill("SIGTERM")` = TerminateProcess 硬杀，cleanup() 和 `process.on("exit")` 都不执行，PID_FILE 残留。

**当前实现**：stdin shutdown 仍在 `process.ts installStdinShutdown` 中保留，但作为 **extension 通过 stdin 发送 `{"type":"shutdown"}` 触发优雅退出**（不是 PI Agent 关闭 lark-bot 的反向路径）。

## 6. 行为约束与假设

lark-bot 对 PI Agent 的行为有以下**未验证假设**（issue #168 第一阶段第 3 项要求盘点）：

| 假设 | 验证手段 | 风险 |
|------|---------|------|
| PI Agent 在 prompt header `[协议]` 段后行为符合 SKILL.md | 无 | 高（SKILL.md 全文 inline 兜底） |
| PI Agent 在 stdout 输出 NDJSON（不是 markdown 代码块） | 无 | 高（多路径兜底） |
| PI Agent 在 agent_settled 后保持静默（不输出 NDJSON 干扰） | 无 | 中 |
| PI Agent 在 prompt 拒绝时返回 `success: false` | 无 | 中 |
| PI Agent 不主动写 stdin 之外的 channel | 无 | 中 |
| PI Agent 在 promptId 不匹配时仍按 promptId 处理 | 无 | 中 |
| PI Agent 不修改 data.json（仅 lark-bot 业务执行后修改） | 无 | 中 |
| PI Agent 在 spawn 后 3s 内处理 get_state 命令 | 无 | 低（5s 兜底） |

## 7. 不稳定点清单

按 issue #168 背景 PR 暴露顺序：

### 7.1 close_session 协议散落三处（高优先级）

```
路径 A: NDJSON 解析（session-manager handlePiEvent case 'close_session'）
路径 B: 文本兜底（session-manager parseCloseSessionFromText，正则匹配 get_last_assistant_text 响应）
路径 C: 自然语言正则（ingress matchesCloseIntent → closeSessionFromUserIntent）
```

**问题**：三条路径互不感知对方存在，可能同时触发，导致：

- close_session 被处理多次
- 清理动作重复（sessions.delete 多次无害，但 broadcastModule.announce 可能多次）
- 用户语义"结束"在不同路径下产生不同 reason（`agent_close_session` / `text_parse_close_session` / `user_natural_language`）

### 7.2 PI Agent stdout NDJSON 不稳定（高优先级）

| 现象 | 当前兜底 | 缺失 |
|------|---------|------|
| 有时 emit NDJSON 正常 | handlePiEvent 正常分发 | 无 |
| 有时把 JSON 放 markdown 代码块 | 文本兜底正则解析 | 无（无法识别代码块标记） |
| 有时输出纯文本 | parseCloseSessionFromText 正则 | 仅针对 close_session，其他事件无兜底 |
| agent_settled 有时不 emit | activeTask 超时 (TASK_MAX_AGE_MS=30min) 兜底 | 不可接受的长尾延迟 |

### 7.3 SKILL.md 不自动加载（高优先级）

- PI Agent 不扫描 cwd 下 `.pi/skills/`
- PI Agent 拒绝带 markdown 的 system prompt append
- 当前兜底：prompt 全文 inline（PR#162 起）

**问题**：这是"协议注入"的根本不稳定，SKILL.md 是 PI Agent 与 lark-bot 协议的唯一约定文档。

### 7.4 prompt 拒绝处理（中等）

```typescript
// handlePiEvent case 'response' command='prompt' success:false
if (task.attemptCount === 0) {
  task.attemptCount++;
  pi.activeTask = null;
  pi.waitingTasks.unshift(task);
  promoteNext(pi);  // 重试
} else {
  finishTaskWithError(pi, task, "prompt 被拒绝");
}
```

**问题**：

- `attemptCount === 0` 重试可能掩盖上游协议不稳定
- 没有失败计数器累计到 session 级，超阈值后转 ERROR
- 重试入队到队首可能挤掉其他 waitingTasks

### 7.5 spawn cwd 不稳定（低等，已修复）

PR `fix/lark-bot-cwd-path` 修复 `__dirname` 推导改为 `process.cwd()`，并加 sanity check 确认 cwd 是 dev 或 ops 仓库根。

**剩余风险**：dev CI 推送至 ops 后，ops 仓库 `agent-src/` 被剥离，sanity check 路径不同。

### 7.6 restart storm 双层配置（中等）

`process.ts` 与 `session-manager.ts` 各有独立阈值（3 vs 10）、独立历史文件、无统一文档。

### 7.7 SKILL.md 全文 inline 是 prompt 污染（中等）

随 SKILL.md 增长会撑爆 prompt 上下文窗口；与用户内容穿插可能被误读。

### 7.8 AgentMatcher 钩子未注入（中等）

`auth.ts` 的 `agentMatcher` 选项类型已声明但 factory 调用时未注入，匹配永远走 substringMatch 兜底。MVP 设计意图是 Agent 决策（决策 4），但当前未落地。

### 7.9 stdout JSON 解析失败静默吞掉（中等）

```typescript
try { handlePiEvent(sessionKey, JSON.parse(line)); } catch {}
```

**问题**：

- 上游协议错误难以发现
- 不区分"格式错误"和"过时事件"
- 无重连 / 上报 / 告警机制

### 7.10 activeTask 状态机约束（低等，已稳定）

```typescript
// task-state-machine.ts startTask invariant check
if (pi.activeTask) {
  log(`🚨 [startTask] 不变量违反: activeTask=${pi.activeTask.promptId} 已存在，但被请求启动 task=${task.promptId}。强制清空旧 task 并 ERROR 收尾。`);
  // 强制清空 + ERROR
}
```

**稳定性**：稳定但属于"如果违反就报错"，说明上游并发控制不严。

## 8. 兜底策略矩阵

| 不稳定点 | 当前兜底 | 散落位置 | 集中化建议（issue 第一阶段第 3 项产出） |
|---------|---------|---------|--------------------------------------|
| close_session 三处 | NDJSON + 文本正则 + 自然语言正则 | 3 处 | **集中到 `closeIntentRouter`**：单一入口 + priority 队列 + 去重 |
| SKILL.md 不自动加载 | prompt 全文 inline | ingress.formatPrompt | PI Agent 协议升级后删除（决策 5 路线 A） |
| prompt 拒绝 | attemptCount 重试 | handlePiEvent | 已稳定（保留） |
| pi exit | restart storm + 5s 重试 | session-manager | 已稳定（保留） |
| spawn cwd | process.cwd() + sanity check | config.ts | 已稳定（保留） |
| stdout JSON 解析失败 | 静默吞掉 + 日志 | handlePiEvent stdout handler | **改为显式告警 + 计数** |
| 重启风暴双层 | 进程级 3 + per-session 10 | process.ts + session-manager.ts | **统一抽象为 `restartGuard`**，单一阈值策略 |
| AgentMatcher 未注入 | substringMatch 兜底 | auth.ts | **PR-2 激活**（决策 4） |
| activeTask 状态机违反 | 强制 ERROR 旧 task | task-state-machine.ts | 已稳定（保留） |
| agent_settled 不 emit | TASK_MAX_AGE_MS=30min 兜底 | task-state-machine.ts | **缩短到 5min**（超时即放弃） |

## 9. 协议扩展点（与 N5 / 决策 4 对齐）

### 9.1 新增 task_change 事件（N5 §9 提议）

```typescript
// PI Agent → lark-bot
interface TaskChangeEvent {
  type: "task_change";
  promptId: string;
  field: string;      // JSONPath-like: "teams[0].bossHP"
  from: unknown;      // undefined = 新增
  to: unknown;        // undefined = 删除
}
```

**用途**：与 `task_log` 配合，分别承载业务主题（subject）和字段级 diff（changes）。

**lark-bot 处理**：

```typescript
// session-manager handlePiEvent 新增 case
case "task_change": {
  handleTaskChange(pi, event as TaskChangeEvent);
  break;
}
```

### 9.2 新增 auth_decision 事件（决策 4 提议）

PI Agent 拿到 candidates 列表后，输出鉴权决策：

```typescript
// PI Agent → lark-bot
interface AuthDecisionEvent {
  type: "auth_decision";
  openId: string;
  chatId: string | null;   // null = no_match
  reasoning?: string;      // 文本推理过程（审计用）
}
```

**lark-bot 处理**：

- chatId 非空 + members 校验通过 → matched
- chatId 非空 + members 校验失败 → not_member
- chatId 为 null → no_match

### 9.3 协议扩展约束

新增 NDJSON 事件必须：

- 字段命名与现有事件一致（`type` / `promptId` / `id`）
- 在 `shared/types.ts` 中声明接口
- 在 `SKILL.md lark-bot-protocol` 中更新协议说明
- 在 `handlePiEvent` 中新增 case 分支
- 在测试中新增 fixture

## 10. 契约测试覆盖建议

| 测试类型 | 覆盖点 | 状态 |
|---------|--------|------|
| 单元测试 | handlePiEvent 各 case 分支 | 部分覆盖（`session-manager.test.ts` 92 行） |
| 单元测试 | prompt 拒绝重试 vs ERROR 收尾 | 新增（issue 第一阶段第 3 项） |
| 单元测试 | close_session 三处兜底路径互斥 | **当前缺失**（issue 第一阶段第 3 项） |
| 单元测试 | stdout JSON 解析失败告警 | 新增 |
| 单元测试 | restart storm 双层互不干扰 | 新增 |
| 集成测试 | spawn → get_state → ready → prompt → agent_settled → get_last_assistant_text → DONE | `session-manager-integration.test.ts` 347 行（部分覆盖） |
| 集成测试 | close_session 三种路径都能正确清理 session | 新增 |
| 集成测试 | SKILL.md 不存在 / 损坏时 fallback | 新增 |
| Mock 测试 | PI Agent 输出 markdown 代码块包裹的 JSON | **当前缺失**（issue 提到的不稳定点） |
| Mock 测试 | PI Agent 不 emit agent_settled | 新增 |
| 回归测试 | PR #163 发现的边界 bug | 已修复（PR#161 后的 PR#163 修复 close_session 自然语言检测） |

## 11. 与 issue #168 其他节点的关系

| 节点 | 关系 |
|------|------|
| N1 业务流图 | 本节点是 N1 §3 sequenceDiagram 中"PI Agent 决策"节点的契约展开 |
| N3 spawn vs extension 对比 | 本节点 §5 进程生命周期是 N3 评估迁移的输入 |
| N4 渐进迁移路线图 | 本节点 §8 集中化建议 + §9 协议扩展点是 N4 registerTool 契约设计的输入 |
| N5 任务日志 schema | 本节点 §9.1 task_change 事件 schema 与 N5 §3 ChangeEntry 对齐 |
| N6 第一阶段汇总 | 本节点是 N6 的组成部分之一 |

## 12. 引用

- `agent-src/.pi/extensions/lark-bot/index.ts` — PI Agent extension 入口（spawn lark-bot 独立进程）
- `agent-src/.pi/scripts/lark-bot/main.ts` — lark-bot 装配点
- `agent-src/.pi/scripts/lark-bot/interactive/session-manager.ts` — 进程管理 / NDJSON 处理 / 重启风暴
- `agent-src/.pi/scripts/lark-bot/interactive/task-state-machine.ts` — 任务状态机
- `agent-src/.pi/scripts/lark-bot/ingress.ts` — 飞书事件入口 / prompt 装配 / 自然语言关闭检测
- `agent-src/.pi/scripts/lark-bot/shared/types.ts` — CloseSessionEvent / TaskLogEvent / PendingTask / PiSession
- `agent-src/.pi/scripts/lark-bot/process.ts` — 进程级防护 / PID / 重启风暴
- `agent-src/.pi/scripts/lark-bot/config.ts` — 配置常量（含 SKILL.md 路径）
- `agent-src/.pi/skills/lark-bot-protocol/SKILL.md` — PI Agent → lark-bot NDJSON 协议（task_log / close_session）
- `agent-src/.pi/scripts/lark-bot/business/auth.ts` — 鉴权判定（substringMatch + agentMatcher 钩子）
- `docs/lark-bot-business-flow.md`（N1）— 业务流图
- `docs/lark-bot-task-journal-schema.md`（N5）— 任务日志对象 schema
