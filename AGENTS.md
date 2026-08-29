# CLAUDE.md

本文件为项目级技术上下文，供 PI Agent 和开发工具加载。
项目全体成员为中文母语，全部注释与文档使用中文。

## 项目概述

FFXIV 高难首杀竞速网站 — 使用 Astro + Vue 3 构建的静态站点，聚合 Final Fantasy XIV 世界首杀竞速进度。展示队伍排名、Boss 血量、阶段推进、职业组合、直播链接、赛事速报。

## 命令

```bash
# 本地开发
npm run dev          # 启动 Astro dev server → http://localhost:4321

# 生产构建
npm run build        # 输出到 dist/
npm run preview      # 预览构建产物
```

## 工具与凭据

以下 host-level 工具默认在 Agent 环境中可用，无需每次 `which` 验证：

| 工具 | 路径 | 说明 |
|------|------|------|
| `gh` | `~/.local/bin/gh` | GitHub CLI，已登录 `weunimix`，对 `mmw-devs/*` 仓库有读写权限 |
| `git` | 系统默认 | 已配 `origin` = `mmw-devs/ffxiv-race-stats`，可推送到 dev 仓库 |
| `python3` | `/usr/bin/python3` | 解析 GitHub API JSON 的回退方案（环境无 `jq` 时） |
| `node` / `npm` | 系统默认 | 本地 dev / build 用 |

注意：

- `gh` 不在默认 `$PATH` 中，bash 会话需先 `export PATH="$HOME/.local/bin:$PATH"`
- 查询 GitHub 优先用 `gh api` / `gh pr *` / `gh issue *`；网络偶尔抖动可重试
- 若 `gh auth status` 超时但 token 已缓存，直接调用 `gh api` 通常仍可工作
- `ops` 仓库（`mmw-devs/ffxiv-race-ops`）未配 git remote，操作 ops 仓库的 PR / issue 必须通过 `gh --repo mmw-devs/ffxiv-race-ops` 完成

## 架构

```
public/data.json ──→  src/App.vue ──→  13 个 Vue 组件
                          ↑
                  （dev runtime 实际读 agent-src/public/data.json；
                   数据真源在 ops 仓库 mmw-devs/ffxiv-race-ops）

schema/*.json    ──→  ops 仓库 CI 数据契约（dev 不再校验）
```

**技术栈：** Astro 7 + Vue 3（Composition API + `<script setup>`），输出为纯静态 HTML/CSS/JS。

**源文件结构：**
```
src/
├── pages/index.astro          # 入口页面
├── layouts/BaseLayout.astro   # 全局布局 + OKLCH token 系统
├── App.vue                    # 根组件，加载 data.json 并分发 props
├── components/                # 13 个 Vue 组件
│   ├── HeroSection.vue        #   英雄区（赛事标题 + 公告 + 按钮）
│   ├── NoticeCard.vue         #   公告卡片
│   ├── BroadcastModule.vue    #   转播方模块
│   ├── RankingTable.vue       #   排名表格
│   ├── RankingRow.vue         #   排名行
│   ├── Sidebar.vue            #   侧边栏
│   ├── StatusBar.vue          #   状态栏
│   ├── NewsTicker.vue         #   滚动速报
│   ├── LiveTimer.vue          #   计时器
│   ├── StreamCover.vue        #   直播封面
│   ├── SponsorsCard.vue       #   赞助商
│   └── AppFooter.vue          #   页脚
└── composables/               # 2 个共享逻辑
    ├── useExpand.js           #   行展开/收起
    └── useTimer.js            #   倒计时
```

**三分职责：**
- `public/data.json` — `RACE_DATA` 纯数据值（JSON）。由 ops 仓库 `race-ops-bot` GitHub App 维护；dev 仓库的 `sync-agent-src` workflow 把变更同步成 `agent-src/public/data.json` 只读镜像
- `schema/*.json` — 6 个 JSON Schema 文件（draft-2020-12），定义 `RACE_DATA` 数据契约。开发者维护。
- `src/` — 所有 UI 代码（Astro + Vue）。开发者维护。

关键数据结构：
- `RACE_DATA.meta` — 赛事名称、副本、Boss、数据中心、开赛时间、状态（`"upcoming" | "live" | "ended"`）
- `RACE_DATA.teams[]` — 排名队伍，每队含 `bossHP`（0–100）、`phase`、`region`、`players[]`（恰好 8 人，每人含 `job`、`role`、`stream`、`streaming`）
- `RACE_DATA.news[]` — 滚动速报，含 `time`、`text`、`urgent`
- `RACE_DATA.broadcasters[]` — 转播方
- `RACE_DATA.notices[]` / `RACE_DATA.sponsors[]` — 公告与赞助

**CSS 使用 OKLCH token 系统**，定义在 `BaseLayout.astro` 的 `:root` 中。修改 6–10 个自定义属性即可整体换肤。

## 分支模型（dev / ops 双仓库）

项目分两个仓库：

| 仓库 | 用途 | 默认分支 | 分支前缀 | 变更对象 | 操作者 |
|------|------|---------|---------|---------|--------|
| `mmw-devs/ffxiv-race-stats` | dev：源码 + 构建 | `main` | `feature/*`、`fix/*`、`ops-sync/*` | `src/`、`schema/`、`scripts/`、`.pi/`、`.github/`、`agent-src/`、`docs/`、CI 配置 | 开发者 |
| `mmw-devs/ffxiv-race-ops` | ops：data.json + Cloudflare Pages 部署 | `main` | `content/*` | `public/data.json` 数据值 | PI Agent（运营） |

**Dev 仓库分支纪律：**
- **禁止直推 `main`** — 所有变更通过 PR + CI 合入
- 开发轨：`feature/<动词>-<描述>`（如 `feature/add-dark-mode`）
- 修复轨：`fix/<描述>`（如 `fix/mobile-overflow`）
- 自动同步：`ops-sync/*` 由 ops 仓库 CI 触发（用于同步 `public/data.json` 变更）
- 两条轨统一使用 squash merge 合入 `main`

**Ops 仓库分支纪律（不在本仓库管理，仅供参考）：**
- 运营轨：`content/<操作>-<目标>`（如 `content/update-t1-p5`）
- `content/` 后缀 ≤ 20 字符（Cloudflare Pages 分支别名截断到 28 字符）
- `content/*` PR 由 `race-ops-bot` GitHub App 创建 + CI 校验通过后自动合并

## CI（dev 仓库）

Dev 仓库的 GitHub Actions 位于 `.github/workflows/`，当前 6 个 workflow：

| Workflow | 触发 | 作用 |
|---|---|---|
| `build-verify` | PR | **branch protection 唯一必需 check**。`npm ci` + `npm run build` 验证 src/ 可成功构建；阻断 `agent-src/public/data.json` 改动 |
| `build-dist-push` | push main | 把 dev 的 `dist/` 产物推到 ops 仓库 |
| `sync-agent-src` | push main（paths: `agent-src/**`） | rsync `agent-src/` 到 ops 仓库（用 `agent-src-sync` GitHub App） |
| `Sync Issue to Feishu` | issue 事件 | 同步 issue 到飞书 bitable |
| `Sync PR to Feishu` | PR 事件 | 同步 PR 到飞书 bitable |
| `actionlint` | PR / push（paths: `.github/workflows/**`） | 静态检查 workflow YAML（`rhysd/actionlint`） |

**数据校验**：`scripts/validate-data.js` 三阶段校验（schema 结构 + 值域 + 业务规则）由 ops 仓库 CI 负责，不在 dev 仓库跑。

## Agent 配置

PI Agent 配置位于 `.pi/` 目录，按职责分层：

| 文件/目录 | 职责 | 维护者 |
|-----------|------|--------|
| `.pi/SYSTEM.md` | Agent 角色定义 + 模式约束 | 开发者 |
| `.pi/prompts/*.md` | 操作入口 Prompt 模板 | 开发者 |
| `.pi/skills/*/SKILL.md` | 操作工作流 SOP | 开发者 |
| `.pi/rules/*.md` | 自动生效的内容/数据约束 | 开发者 |
| `.pi/settings.json` | 扩展包 + 凭证配置 | 开发者 |
| `.pi/mcp.json` | MCP Server 连接配置 | 开发者 |

### 双模工作

Dev 仓库不再有 PI Agent 运营模式 —— 所有 data.json 改动由 ops 仓库的 PI Agent 通过 `race-ops-bot` GitHub App 直接处理。Dev 仓库内的 PI Agent 仅用于开发协助（读代码、写代码、跑测试），分支策略统一走 `feature/*` / `fix/*`。

## 数据校验规则

`scripts/validate-data.js` 三阶段校验（CI 环境依赖 `ajv` devDependency，本地需先 `npm ci`）：

**阶段 1 — Schema 结构**：对照 `schema/*.json` 用 Ajv 校验类型、必填、嵌套、数组长度
**阶段 2 — 值域交叉**：从白名单校验 `phase` ∈ `PHASE_ORDER`、`region` ∈ `VALID_REGIONS` 等
**阶段 3 — 业务规则**：
- `rank` 值从 1 起始、连续、无重复无跳号
- `bossHP` ∈ [0, 100]
- 每队 `players[]` 恰好 8 人
- 占位符直播链接（`"#"`）和队伍名（`[队伍名 X]`）触发提醒（不阻断）

## 注释语言

项目全体成员为中文母语。所有代码注释、文档、commit message 使用中文。
