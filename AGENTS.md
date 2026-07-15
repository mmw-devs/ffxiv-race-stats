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

# 提交前校验数据
node scripts/validate-data.js
```

## 架构

```
public/data.json ──→  src/App.vue ──→  13 个 Vue 组件
schema/*.json    ──→  scripts/validate-data.js （CI 数据契约）
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
- `public/data.json` — `RACE_DATA` 纯数据值（JSON）。运营侧维护，dev PR 零触碰。
- `schema/*.json` — 6 个 JSON Schema 文件（draft-2020-12），定义 `RACE_DATA` 数据契约。开发者维护。
- `src/` — 所有 UI 代码（Astro + Vue）。开发者维护。

关键数据结构：
- `RACE_DATA.meta` — 赛事名称、副本、Boss、数据中心、开赛时间、状态（`"upcoming" | "live" | "ended"`）
- `RACE_DATA.teams[]` — 排名队伍，每队含 `bossHP`（0–100）、`phase`、`region`、`players[]`（恰好 8 人，每人含 `job`、`role`、`stream`、`streaming`）
- `RACE_DATA.news[]` — 滚动速报，含 `time`、`text`、`urgent`
- `RACE_DATA.broadcasters[]` — 转播方
- `RACE_DATA.notices[]` / `RACE_DATA.sponsors[]` — 公告与赞助

**CSS 使用 OKLCH token 系统**，定义在 `BaseLayout.astro` 的 `:root` 中。修改 6–10 个自定义属性即可整体换肤。

## 分支模型（双轨）

| 轨道 | 分支前缀 | 变更对象 | 操作者 |
|------|---------|---------|--------|
| 开发 | `feature/*`、`fix/*` | `src/`、`schema/`、`scripts/`、`.pi/`、CI、docs | 开发者 |
| 运营 | `content/*` | `public/data.json` 数据值 | PI Agent（代表运营者） |

两条轨统一使用 squash merge 合入 `main`。`content/*` 分支名中 `content/` 后面的部分必须 ≤ 20 字符（Cloudflare Pages 分支别名截断到 28 字符）。

**分支纪律：**
- **禁止直推 `main`** — 所有变更通过 PR + CI 合入
- 开发轨：`feature/<动词>-<描述>`（如 `feature/add-dark-mode`）
- 修复轨：`fix/<描述>`（如 `fix/mobile-overflow`）
- 运营轨：`content/<操作>-<目标>`（如 `content/update-t1-p5`）
- `content/` 后缀 ≤ 20 字符（Cloudflare Pages 分支别名截断到 28 字符）
- CI 双向硬阻断：dev PR 禁含 `public/data.json`，content PR 仅允许 `public/data.json`

## CI

GitHub Actions（`.github/workflows/validate.yml`）在每次 PR 时运行：

1. **所有 PR**：`npm ci` → `node scripts/validate-data.js` — 三阶段校验：
   - **结构**：Ajv 对照 `schema/*.json` 校验类型、必填、嵌套、数组长度
   - **值域**：与白名单交叉校验（phase ∈ `PHASE_ORDER`、region ∈ `VALID_REGIONS` 等）
   - **业务规则**：rank 连续性、`bossHP` ∈ [0,100]、每队恰好 8 人

2. **`feature/*` / `fix/*` PR**：文件范围检查 — diff **不得**含 `public/data.json`。违规 → 直接 FAIL。

3. **`content/*` PR**：文件范围检查 — diff **仅**允许 `public/data.json`。含其他文件 → 直接 FAIL。

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

Agent 支持两种模式，通过 Prompt 模板切换：

| | 运营模式（默认） | 开发模式（`/dev`） |
|---|---|---|
| 允许修改 | `public/data.json` | 除 `public/data.json` 外所有文件 |
| 分支前缀 | `content/*` | `feature/*`、`fix/*` |
| Git 鉴权 | GitHub App | 个人 gh CLI |
| PR 确认方 | 运营人员 | Code Review |

平台级硬约束（GitHub Ruleset + CI）：
- GitHub App 仅可推送 `content/*` 分支
- `feature/*` / `fix/*` PR 含 `public/data.json` → CI 阻断
- `content/*` PR 含非 `public/data.json` 文件 → CI 阻断

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
