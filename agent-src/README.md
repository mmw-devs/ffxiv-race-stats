# FFXIV 高难首杀竞速 — 运营仓库

Final Fantasy XIV 世界首杀竞速排行平台的**运营仓库**。负责日常运营全流程：数据维护、Agent 自动化、构建部署。

## 与开发仓库的分工

| | 运营仓库（本仓库） | 开发仓库 |
|---|---|---|
| **GitHub** | `mmw-devs/ffxiv-race-ops` | `mmw-devs/ffxiv-race-stats` |
| **主体** | 数据 + Agent + 工作流 + 部署 | 应用源码 + 构建 |
| **高频改动** | `public/data.json` | `src/`、`schema/` |
| **分支前缀** | `content/*` | `feature/*`、`fix/*` |
| **触发角色** | PI Agent（代表运营人员） | 开发者本人 |

## 日常运营流程

```
操作者（飞书 / DeepSeek Harness 等）
   │
   ▼
运行环境中的 Agent（.pi/）接收指令
   │
   ▼ 按 .pi/commands.md 识别业务域，加载 ops-* skill
   │
   ▼ gh cli 创建 content/* 分支 → 修改 public/data.json → 开 PR（ops-submit）
   │
   ▼ CI 校验（schema + 范围 + 操作日志）
   │
   ▼ Merge main
   │
   ▼ CF Pages 自动部署
```

## 部署架构

```
Dev Repo main（push src/ 改动）
   ↓
Dev CI：npm ci && npm run build → 产出 dist/
   ↓
Dev CI 推送 dist/ 到本仓库 main
   ↓
CF Pages 监听本仓库 main
   ↓ Build command: cp public/data.json dist/data.json
   ↓ Build output: dist/
   ↓
CDN ──→ 用户访问站点
```

## 本地校验

```bash
npm ci
npm run validate          # 校验 public/data.json
npm run validate-op-log   # 校验操作日志
```

## 数据契约

`public/data.json` 必须符合 `schema/*.json` 定义。PR 提交时 CI 自动校验。

详细数据结构见 [schema/](./schema/)。

## 运营 Agent 工具

本仓库的运营 skill（`.pi/`）按业务域划分，**不绑定消息渠道或 Agent 运行时**：

| Skill | 用途 |
|---|---|
| `ops-event` | 赛事生命周期：新建/换届、开赛时间、预热、开赛、结束 |
| `ops-progress` | 战况与名次：进度、批量、通关、进层、修正、调名次 |
| `ops-roster` | 参赛名单与直播：加队、删队、阵容、队名/区服、直播开关 |
| `ops-publish` | 对外发布：速报、公告、赞助、转播台 |
| `ops-site` | 站点内容：首页文案、规则、SEO、媒体、章节标题 |
| `ops-query` | 只读查询：排名、进度、剩余队伍、直播覆盖、待办 |
| `ops-submit` | 运行环境无关的提交契约：校验、审计、content PR、预览、合并策略 |
| `ops-submit-larkbot` | lark-bot / 飞书适配器：`larkbot_*` 审计 + `gh` PR；L2 可由 Bot 合并，L3 人工 |
| `ops-submit-dsh` | DeepSeek Harness + mmw-tools 适配器：`repo_edit` / `pr_create` / `pr_preview`；L2 需明确「合并」后经宿主确认，不自动合并 |

指令的级别、确认强度、影响标记、前置条件和跨域交接，唯一来源是 [`.pi/commands.md`](./.pi/commands.md)；业务域 skill 只做路由，不复述规则。

运行环境必须提供身份、确认、审计、PR、预览；L2 合并能力可选，L3 永远人工。

首届赛事的人工骨架流程与字段清单见 [`.pi/ops/first-event.md`](./.pi/ops/first-event.md)。

详见 [`.pi/skills/`](./.pi/skills/)。

## 相关链接

- 站点：CF Pages 项目 URL（dashboard 查看）
- 开发仓库：https://github.com/mmw-devs/ffxiv-race-stats
