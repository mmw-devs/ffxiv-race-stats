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
| `lark-bot/` | 飞书 Bot — 默认手动启动，退出时自动清理。`settings.json` 中 `larkBot.autoStart = true` 可开启自动启动 |

### lark-bot 自动启动说明

`autoStart` 开关通过读取**本地** `settings.json` 生效，该文件在 `.gitignore` 中，每人维护自己的一份。

```
扩展代码（所有人共享）      settings.json（本地，各有各的）
        │                          │
        ▼                          ▼
  读取 larkBot.autoStart  ←──  开发者：无此 key → 不启动
                               生产端：autoStart: true → 启动
```

- **开发者**：无需任何配置，克隆后 bot 默认不启动
- **生产端**：在本地的 `settings.json` 中设置 `"larkBot": { "autoStart": true }` 即可
