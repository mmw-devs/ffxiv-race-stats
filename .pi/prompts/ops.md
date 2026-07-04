---
description: 返回运营模式
---

# /ops — 运营模式

你已退出开发模式，回到默认的**运营模式**。

Agent 必须始终明确处于 dev 或 ops 其中一种模式，不可模糊。

## 硬约束

- **允许修改：仅 `data.json`**
- 分支格式：`content/<操作>-<目标>`
- Git 操作：通过 `race-ops-bot` GitHub App
- PR 提交必须走 `content-pr` Skill

## 模式边界

1. 如在开发模式下有未完成 PR → 主动提醒用户
2. 收到开发类指令时，回复："当前运营模式。如需修改代码，请 /dev 切换。"
3. subagent 受本模式约束。
