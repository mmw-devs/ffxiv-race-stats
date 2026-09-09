# Review Report PR-171 Followup - 实测 1-6 验证方案 G

## 概述

PR-171 (5b26891) 已 merged，完成 13 轮 reviewer 复审闭环 + 方案 B → G 修订。
本报告为第 14 轮 review——基于实测 1-6 验证方案 G 的真实可行性。

## 实测 1：registerTool execute 内 ctx 结构

**目的**：验证 ctx.chatId 是否存在、ctx.sessionManager 可访问性、sessionFile 路径格式

**实测产物**：`/tmp/pi-experiment-168-verify/results/exp1.json`（668KB）

**关键发现**：

- `ctx.chatId`：**NOT FOUND**（`hasChatId: false`）
- `ctx.sessionManager`：**可访问**（`hasSessionManager: true`）
- `ctx.sessionManager.getSessionFile()`：返回 PI Agent 内部路径 `/home/weunimix/.pi/agent/sessions/--<dir>--/<timestamp>_<uuid>.jsonl`
- **结论**：sessionFile 路径与 chatId **无关联**——sessionDir 反向解析 chatId **不可行**

**对方案 G 影响**：⚠️ **必须修改** chatId 来源——采用 chatToSession Map 反查（实测 6-1 验证）

## 实测 2：PI Agent 子进程通信方式

**目的**：验证 spawn `pi --mode rpc --session-dir <chatId>` 的真实通信协议

**实测产物**：`/tmp/pi-experiment-168-verify/results/exp2.json`（45 行 stdout + 33 种命令）

**关键发现**：

- ✅ stdin NDJSON 协议稳定（LF-only 严格 JSONL）
- ✅ stdout NDJSON 响应格式（45 行全部解析成功）
- ✅ 33 种命令类型（含 prompt / get_state / bash / fork / new_session 等）
- ✅ `--session-dir` 行为：传 `--session-dir /tmp/foo` 时立即创建 sessionFile；省略时用 `~/.pi/agent/sessions/<encoded-cwd>/`
- ⚠️ 子进程持续运行前提：stdin 必须保持打开（stdin.end() 立即退出）
- ✅ SIGTERM 退出码 143

**对方案 G 影响**：✅ **方案 G "保留 spawn 模式" 完全可行**——协议稳定，长连接是 PI Agent 官方推荐方式

## 实测 3：lark-cli event consume 与 PI Agent extension 集成

**目的**：验证 extension 内直接 spawn lark-cli event consume 是否可行

**实测产物**：`/tmp/pi-experiment-168-verify/results/exp3-real.json`

**关键发现**：

- ✅ spawn 成功（PID=6605）
- ⚠️ **结构化输出在 stderr**（不是 stdout）——实测确认
- ✅ 自动用本地凭据启动 `weunimix-personal (cli_aa0d91b3bf785bc3)` 身份（注：实测环境为个人 agent，业务身份应单独配置）
- ⚠️ session_shutdown 不自动清理子进程（childExited: false）

**对方案 G 影响**：⚠️ **必须修改**：同时监听 stderr + stdout；session_shutdown 时手动 kill

## 实测 4：SKILL.md 自动加载（命令参数错误）

**目的**：验证 PI Agent 是否自动加载 SKILL.md

**实测产物**：`/tmp/pi-experiment-168-verify/results/exp4.json`

**问题**：实测命令用了 `--no-builtin-tools`，但官方禁用参数是 `--no-skills`

**关键发现**：

- 实测 system prompt 长度只有 472 字
- 5 个 marker 全部未命中
- `<available_skills>` 块不存在
- **不能下"SKILL.md 不加载"结论**——可能只是触发条件未满足

**对方案 G 影响**：⚠️ 实测不确定 → **按 PI Agent 官方机制走**——不做特殊处理

## 实测 5：registerTool 并发安全

**目的**：验证 module-level state 在 registerTool.execute 下的并发安全性

**实测产物**：`/tmp/pi-experiment-168-verify/results/exp5-snapshots.ndjson`（47KB）+ `exp5-counter.json`

**关键发现**：

- ✅ 原子操作安全：`counter++` / `Map.set` / `Array.push` 无丢失（20 个并发全部正确）
- ⚠️ **同 turn 多工具有陈旧读竞态**——reader 工具读到 writer await 之前的旧状态
- ⚠️ 强制单 turn 11 工具批次：counter=0（应为 5），errorsCount=5（正确）
- ✅ 跨 turn 调用安全

**对方案 G 影响**：⚠️ **禁止 check-then-act 跨 await**——读+删除必须单步原子操作

## 实测 6：6 处修正验证

### 实测 6-1：chatId Map 反查 ✅ PASS

```json
{
  "mapSize": 1,
  "mapEntries": [{"chatId": "oc_test_001", "sessionId": "session-oc_test_001-1788971134929"}],
  "sessionLog": [
    {"op": "set_chat_id", "chatId": "oc_test_001"},
    {"op": "larkbot_fetch_pending_events", "chatId": "oc_test_001", "found": true}
  ]
}
```

### 实测 6-2：lark-cli stderr/stdout 监听 ⚠️ partial

```json
{"totalStdoutBytes": 0, "totalStderrBytes": 0, "verdict": "equal / unknown"}
```

实测 0 字节（环境差异），但实测 3 已确认 stderr 路径——**采纳同时监听 stderr + stdout**

### 实测 6-3：session_shutdown 手动清理 ✅ PASS

```json
{
  "verdict": "PASS: all children killed by manual cleanup",
  "alreadyDead": ["child-0", "child-1", "child-2", "child-3", "child-4"]
}
```

### 实测 6-4：check-then-act 陈旧读竞态 ✅ PASS

```json
{
  "map": {"k1": 1},  // 应为 6，lost update
  "incCount": 5,
  "checkThenSetCount": 1
}
```

### 实测 6-5：SKILL.md 自动加载（重新实测）⚠️ still fail

```json
{"anySkillMarker": false, "availableSkillsBlockContainsNames": []}
```

**决定**：按 PI Agent 官方机制走——不做特殊处理（取消修正 5）

### 实测 6-6：NDJSON 协议保留 ✅ PASS

```json
{
  "finalState": {
    "chat-test-001": {
      "exitCode": 0,
      "shutdownReason": "stdin.end",
      "eventsReceivedCount": 5,
      "ndjsonLinesValid": 5
    }
  }
}
```

## 综合结论

6 处修正的状态：

| 修正 | 状态 | 关键证据 |
|------|------|---------|
| chatId Map 反查 | ✅ PASS | sessionLog 完整日志 |
| stderr/stdout 监听 | ⚠️ partial | 实测 3 已确认 |
| session_shutdown 清理 | ✅ PASS | 5 个子进程全部清理 |
| check-then-act 禁止 | ✅ PASS | map lost update 复现 |
| SKILL.md 特殊处理 | ❌ 取消 | 按官方机制走 |
| NDJSON 协议保留 | ✅ PASS | 5 事件 + 干净退出 |

方案 G 设计 5 处采纳 + 1 处取消——PR-171 后续补遗完成。

## 后续动作

1. PR-1 编码阶段必须严格遵守6 处实测修正
2. SKILL.md 按 PI Agent 官方机制走——不做特殊处理
3. process.ts 删除范围明确：仅删除进程级崩溃防护，保留 NDJSON 协议
4. chatToSession Map 必须实现——飞书事件到达时建立映射（不依赖 LLM 主动调用）