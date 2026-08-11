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
运营人员（飞书）
   │
   ▼
运营 Agent（.pi/）接收指令
   │
   ▼ 调用 skill（update-team / add-news / add-broadcaster）
   │
   ▼ gh cli 创建 content/* 分支 → 修改 public/data.json → 开 PR
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

本仓库配套的 PI Agent（`.pi/`）在运营模式下提供：

| Skill | 用途 |
|---|---|
| `update-team` | 更新队伍攻略进度（phase、bossHP、isLive） |
| `add-news` | 添加赛事速报 |
| `add-broadcaster` | 管理赛事转播方 |
| `content-pr` | 通用 PR 提交流程 |

详见 [`.pi/skills/`](./.pi/skills/)。

## 设计文档

| 文档 | 内容 |
|------|------|
| [运营系统设计](docs/operations-system-design.md) | 双轨分支模型、Agent 能力设计、CI 与质量保障 |
| [.pi/SKILL.md](.pi/SKILL.md) | PI Agent 在本仓库的工作机制 |

## 相关链接

- 站点：CF Pages 项目 URL（dashboard 查看）
- 开发仓库：https://github.com/mmw-devs/ffxiv-race-stats
