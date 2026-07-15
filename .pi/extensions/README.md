# 硬约束层

Agent 约束通过多层机制实现，Prompt 层为第一道防线，平台层为物理防线。

## 约束层次

| 层 | 机制 | 拦截场景 |
|---|------|---------|
| Prompt | SYSTEM.md + dev.md/ops.md + rules/ | Agent 操作前主动拒绝 |
| Skill | `content-pr` 硬停止规则 | PR 创建后必须等用户确认 |
| Ruleset | `content/**` 仅 App + Admin | 个人推 content/* → 物理拒绝 |
| CI | `validate.yml` 文件范围 + 双向阻断 | 越界文件 → FAIL |
| Branch Protection | main: PR + CI required | 无法直推 main |

## 双模 Agent

| | 运营（默认） | 开发（/dev） |
|---|---|---|
| 允许 | 仅 `data.json` | 除 `data.json` 外 |
| 分支 | `content/*` | `feature/*`、`fix/*` |
| 凭证 | PEM | gh CLI |

## 扩展列表

| 文件 | 职责 |
|------|------|
| `lark-bot/` | 飞书 Bot 生命周期 — 随 agent 启动自动运行，退出时自动清理 |
