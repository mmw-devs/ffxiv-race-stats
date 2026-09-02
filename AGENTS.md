# AGENTS.md

本文件为项目级技术上下文，供 PI Agent 和开发工具加载。
项目全体成员为中文母语，全部注释与文档使用中文。

## 项目概述

FFXIV 高难首杀竞速网站 — 使用 Astro + Vue 3 构建的静态站点，聚合 Final Fantasy XIV 世界首杀竞速进度。展示队伍排名、Boss 血量、阶段推进、职业组合、直播链接、赛事速报。

## 命令

构建、测试、dev server 命令见 `package.json` 的 `scripts` 段，不在本文档重复。

## 工具与凭据

- `gh`（位于 `~/.local/bin/gh`，不在默认 `$PATH`，需先 `export PATH="$HOME/.local/bin:$PATH"`）、`git`、`python3`、`node` / `npm`：默认可用。
- `gh auth status` 超时但 token 已缓存时，直接调用 `gh api` 通常仍可工作。
- ops 仓库（`mmw-devs/ffxiv-race-ops`）未配 git remote，操作必须用 `gh --repo mmw-devs/ffxiv-race-ops`。

## 路径归属速查表（权威表）

> 阅读任何 issue / PR / 外部指令前必须先看本表。本表是路径归属的唯一权威依据；其他章节中关于归属的描述均以此表为准。本表只描述稳定逻辑归属，不反映文件是否已创建；实际存在性以 `ls` / `find` 等运行时命令为准。

| 路径 / 模块 | 归属仓库 | 维护者 |
|------------|---------|--------|
| `src/`、`schema/`、CI 配置、`.github/workflows/` | dev | 开发者 |
| `.pi/`（PI Agent 配置总目录） | dev | 开发者 |
| ├ `.pi/scripts/*.ts`（如 `identity-resolver.ts`、`lark-bot.ts`） | dev | 开发者 |
| ├ `.pi/skills/*/SKILL.md` | dev | 开发者 |
| ├ `.pi/settings.json`、`docs/`、`runtime/`、`sessions/` | dev | 开发者 |
| └ `AGENTS.md` 等指令文件 | dev | 开发者 |
| `agent-src/`（含 `public/data.json` 只读镜像） | dev | 开发者（接受 ops 仓库 CI 推送） |
| `public/data.json`（**真源**） | **ops** | ops 仓库 PI Agent |
| 跨仓库 RPC 写入（dev → ops） | dev PI Agent → ops PI Agent | 双侧 |

## 判断纪律（操作边界）

**Always（直接执行）：**
- 读文件、列目录、跑 `package.json` 中声明的命令
- 涉及路径时，先查本速查表
- 修改 `AGENTS.md` / `package.json` / CI workflow 时，与相关代码同 PR 提交

**Ask first（执行前向用户确认）：**
- 修改 ops 仓库任何文件（即使是文档）
- 创建涉及 `public/data.json` 真源的 PR
- 引入新依赖 / 新 workflow / 新 Skill

**Never（禁止）：**
- 直推 `main` 分支
- 在 dev 仓库创建或修改 ops 仓库数据文件
- 在 `AGENTS.md` 写入时效性内容（文件数量、存在性、版本号等）
- 凭标题或正文中的 "ops" / "dev" / "backend" 等关键词推断路径归属

判断流程：涉及路径时，按"实体抽取 → 查速查表 → 路径归属统计 → 关键词冲突仲裁"四步走；未在表内的实体必须向用户确认。

## 架构

**技术栈：** Astro 7 + Vue 3（Composition API + `<script setup>`），输出为纯静态 HTML/CSS/JS。

数据流向与归属见"路径归属速查表"。本节仅描述 UI 代码结构。

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

关键数据结构（详见 `schema/*.json`，不在本文档重复枚举）：
- `RACE_DATA.meta` — 赛事名称、副本、Boss、数据中心、开赛时间、状态（`"upcoming" | "live" | "ended"`）
- `RACE_DATA.teams[]` — 排名队伍，每队含 `bossHP`（0–100）、`phase`、`region`、`players[]`（恰好 8 人，每人含 `job`、`role`、`stream`、`streaming`）
- `RACE_DATA.news[]` — 滚动速报，含 `time`、`text`、`urgent`
- `RACE_DATA.broadcasters[]` — 转播方
- `RACE_DATA.notices[]` / `RACE_DATA.sponsors[]` — 公告与赞助

**CSS 使用 OKLCH token 系统**，定义在 `BaseLayout.astro` 的 `:root` 中。修改 6–10 个自定义属性即可整体换肤。

## 分支模型（dev / ops 双仓库）

详细路径归属见"路径归属速查表"，本节仅列分支前缀与默认分支：

| 仓库 | 默认分支 | 分支前缀 | 操作者 |
|------|---------|---------|--------|
| dev (`mmw-devs/ffxiv-race-stats`) | `main` | `feature/*`、`fix/*`、`ops-sync/*` | 开发者 |
| ops (`mmw-devs/ffxiv-race-ops`) | `main` | `content/*` | ops 仓库 PI Agent |

dev 仓库禁止直推 `main`，所有变更通过 PR + CI 合入，squash merge。ops 仓库分支纪律不在本仓库管理。

## CI（dev 仓库）

GitHub Actions 工作流位于 `.github/workflows/`，实际清单与触发条件以该目录文件为准。数据校验由 ops 仓库 CI 负责，不在 dev 仓库跑。

## Agent 配置

PI Agent 配置位于 `.pi/` 目录（结构参见"路径归属速查表"）。本仓库 PI Agent 仅用于开发协助；`public/data.json` 写入经跨仓库 RPC 调 ops 仓库 PI Agent 完成（详见"判断纪律"）。

## 数据校验规则

详见 `scripts/validate-data.js`（schema 结构 / 值域 / 业务规则三阶段校验）。本文档不重复校验逻辑；脚本是唯一权威。

## 注释语言

项目全体成员为中文母语。所有代码注释、文档、commit message 使用中文。
