# FFXIV 高难首杀竞速 — 运营仓库

> 同步自 dev 的 `agent-src/`；文中“本仓库”指 ops（`mmw-devs/ffxiv-race-ops`）。
> 结构性文件只在 `agent-src/` 改；ops-only 仅 `public/data.json` 与 `dist/`。
> 规则入口：`COMMANDS.md`（指令）、`schema/*.json` 与 `scripts/validate-data.ts`（数据）、`.pi/skills/ops-submit/SKILL.md`（提交）。

首杀竞速排行平台运营仓库：数据维护、Agent 自动化、构建部署。

## 与开发仓库分工

| | 运营 | 开发 |
|---|---|---|
| GitHub | `mmw-devs/ffxiv-race-ops` | `mmw-devs/ffxiv-race-stats` |
| 高频改动 | `public/data.json` | `src/`、`schema/` |
| 分支前缀 | `content/*` | `feature/*`、`fix/*` |

## 日常流程

操作者 → Agent 按 `COMMANDS.md` 识别域、加载 `ops-*` skill → `ops-submit` 适配器建 `content/*` 分支改 `public/data.json` 并开 PR → CI（schema + 范围 + 操作日志）→ 合并 main → CF Pages 部署。

- L1 只读；L2 确认后由运行环境合并（无能力则人工）；L3 只能人工。
- L3 仅：新建赛事 / 换届、预热上线、开赛（兜底）、结束赛事。

## 部署

dev push → dev CI 构建 `dist/` → 推送到本仓库 main → CF Pages `cp public/data.json dist/data.json` → 发布。

## 本地校验

```bash
npm ci
npm run validate
npm run validate-op-log
```

## 数据契约

`public/data.json` 必须符合 `schema/*.json`；PR 时 CI 自动校验。

## 运营 Agent 工具

`.pi/skills/` 按业务域划分，不绑定渠道或运行时：

`ops-event`（生命周期）、`ops-progress`（战况）、`ops-roster`（名单）、`ops-publish`（发布）、`ops-site`（站点）、`ops-query`（只读）；`ops-submit` 为提交契约，`ops-submit-larkbot` / `ops-submit-dsh` 为适配器。

级别、确认、影响、前置条件以 [`COMMANDS.md`](./COMMANDS.md) 为准。首届骨架见 [`.pi/ops/first-event.md`](./.pi/ops/first-event.md)。

## 相关链接

- 开发仓库：https://github.com/mmw-devs/ffxiv-race-stats
