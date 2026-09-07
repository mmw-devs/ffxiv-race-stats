---
name: lark-bot-protocol
description: >
  lark-bot 任务日志上报协议。通过 lark-bot 私聊处理业务任务时，向 stdout 输出 task_log 事件上报业务主题。涵盖上报时机、JSON 格式、promptId 读取、subject 写法。
compatibility: 依赖 lark-bot 私聊接入；要求 prompt header 含 promptId。
---

# lark-bot-protocol

## 0. 何时加载

当前 prompt 是 lark-bot 通过私聊发来的业务任务，且 prompt header
包含 `promptId=...`，就加载本 skill。

## 1. 任务日志上报（task_log 协议）

### 1.1 上报时机

- 理解任务主题后 → emit一次
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

## 2. 关闭会话（close_session 协议）

### 2.1 适用场景

当用户明确表示“结束”、“done”、“再见”等意图，要求关闭本次会话时。

### 2.2 格式

回复用户结束语后，向 stdout 输出（一行 JSON）：

```json
{"type":"close_session","reason":"user_said_done"}
```

`reason` 可选：业务上下文说明（如 "user_said_done" / "task_completed"）。

### 2.3 lark-bot 收到后的动作

- 销毁当前 session（`closeSession`）
- 若 `authorized=true`，释放已鉴权会话槽位
- 杀 pi 子进程
- emit task journal（state=terminated）

### 2.4 示例

用户发“结束任务” → Agent 回复业务确认语 → Agent stdout 输出：

```json
{"type":"close_session","reason":"user_said_done"}
```

lark-bot 收到后关闭 session，**不发额外回复**（Agent 已回复业务确认）。
