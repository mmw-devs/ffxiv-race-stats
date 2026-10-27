# mmw 攻略组智能体（dev 仓库）

**mmw 攻略组通用智能体**的开发仓库（`mmw-devs/ffxiv-race-stats`）。承担大量重 CI/CD，开发者在此维护 Agent 的运营侧定义（subagent、skill、prompt、actions 配置）。

当前承载的具体应用：**FFXIV 高难首杀竞速网站** —— 世界首杀竞速排行聚合平台，追踪高难副本的首杀争夺战，提供队伍进度、选手直播、赛事速报一站式浏览。

## 项目仓库

本项目采用**双仓库架构**：

| 仓库 | 角色 |
|---|---|
| **`mmw-devs/ffxiv-race-stats`**（本仓库，dev） | 站点源码 + ops 仓库镜像管理 |
| **`mmw-devs/ffxiv-race-ops`**（ops 仓库） | Agent 运行时 + 生产 CI + 数据 + CF Pages 部署 |

- **ops 仓库完全独立**：不引用、不 checkout、不包含 dev 仓库的任何内容
- **单向同步**：dev 通过 `sync-agent-src.yml` 把 `agent-src/` 内容推送到 ops 仓库

## 本地预览

Node 版本以 `.nvmrc` 为唯一事实源（当前 `24.11.0`，CI 也从该文件读取）。

```bash
npm install        # 仅首次
npm run dev        # Astro 开发服务器 + HMR
```

访问 `http://localhost:4321`。

`npm run dev` 会把 `/data.json` 代理到生产站（`astro.config.mjs` 的 `vite.server.proxy`），
本地直接看到线上最新数据，不必等 ops→dev 的副本同步。

## 技术栈

Astro 7 + Vue 3，组件化架构（13 个 SFC，scoped CSS 样式隔离）。OKLCH token 系统定义在 `BaseLayout.astro` 中。

```
src/
├── pages/index.astro         # 入口
├── layouts/BaseLayout.astro  # 全局布局 + tokens
├── App.vue                   # 根组件（数据加载 + 分发）
├── components/               # 13 个 Vue 组件
└── composables/              # useTimer / useExpand
```

## 仓库结构

```
dev 仓库（本仓库）
├── src/                    站点源码（dev 独有）
├── astro.config.mjs        Astro 配置
├── package.json            构建依赖
├── .github/workflows/
│   ├── build-verify.yml    PR 构建验证（必需 check）
│   ├── build-dist.yml      src → dist → ops 仓库
│   ├── sync-agent-src.yml  agent-src → ops 仓库
│   ├── sync-issue.yml      dev issues → 飞书
│   └── sync-pr.yml         dev PRs → 飞书
├── .githooks/              本地 git hook 脚手架
├── .pi/                    dev 侧 agent 配置
│   ├── skills/             开发者工具（jit-pem）
│   ├── scripts/            开发者工具（get-jit-pem.ts）
│   └── npm/                agent runtime npm 依赖
├── agent-src/              ops 仓库镜像（dev → ops 推送源）
```

## 分支规范

| 前缀 | 用途 | 谁 |
|---|---|---|
| `feature/<动词>-<描述>` | 新功能 | 开发者 |
| `fix/<描述>` | Bug 修复 | 开发者 |
| ~~`content/*`~~ | ~~数据值变更~~（已废弃，ops 改动走 ops 仓库） | — |

`content/*` 已被废弃：双仓库架构下，ops 数据变更走 ops 仓库的 `content/*` 分支。

## CI 工作流

| Workflow | 触发 | 职责 |
|---|---|---|
| `build-verify.yml` | dev PR | `npm ci` → `npm run build` 验证 |
| `build-dist.yml` | dev main push | 构建 dist/ 推送到 ops 仓库 |
| `sync-agent-src.yml` | dev main push + agent-src/** | 同步 agent-src/ 到 ops 仓库 |
| `sync-issue.yml` | dev issues 事件 | dev issues → 飞书多维表格 |
| `sync-pr.yml` | dev PR 事件 | dev PRs → 飞书多维表格 |

**dev → ops 推送规则**：
- `build-dist.yml` 和 `sync-agent-src.yml` 共享 `sync-ops` concurrency group，串行推送
- `sync-agent-src.yml` 使用 rsync + exclude，排除 `dist/`、`public/data.json`、`*:Zone.Identifier`、`.git/`
- `public/data.json` 的真源在 ops 仓库（运营人员通过 `content/*` PR 提交），由 ops 的
  `sync-data-to-dev.yml` **单向同步**到 dev 的 `agent-src/public/data.json`；dev → ops 的 rsync 始终排除它

### data.json 副本同步（ops → dev）

```
运营人员在 ops 仓库改 public/data.json → content/* PR → 合并进 ops main
        ↓
ops 的 sync-data-to-dev.yml 触发（push: public/data.json）
        ↓
在 dev 仓库建 ops-sync/data 分支，复制 data.json，开 PR
        ↓
dev 的 build-verify 只允许 ops-sync/* 分支改动该文件，并校验结构完整性
        ↓
合入 dev main → 副本与真源一致
```

⚠️ **已知问题**：`sync-data-to-dev.yml` 的 `--body` 多行文本顶格写在 YAML 里，把 `run: |`
块标量截断，GitHub 判定为 workflow file issue —— 该 workflow **从未成功创建过 PR**，
因此 dev 的副本停在 2026-08-11。修复该 YAML 后链路即可恢复。

## dev → ops 数据流

```
开发者编辑 agent-src/
        ↓
commit 到 dev 仓库
        ↓
PR merge → dev main
        ↓
sync-agent-src.yml 触发
        ↓
rsync 到 ops 仓库（排除 dist/、data.json）
        ↓
ops 仓库 main 更新
        ↓
ops 仓库 CI 触发（validate.yml、race-ops-jit-pem.yml）
        ↓
Cloudflare Pages 自动部署
```

## 部署

Cloudflare Pages 监听 **ops 仓库** main 分支 → 自动构建（`npm run build` + `cp public/data.json dist/data.json`）→ CDN。

dev 仓库的 `build-dist.yml` 把 dist/ 推送到 ops 仓库后，ops 仓库重新部署。

### dev 预览站

dev 仓库自身的 CF Pages 预览项目用 **`npm run build:dev-preview`**：不落盘数据，
而是把 `/data.json` 反代到生产站，所以预览永远是线上真实数据。
（`build:preview` 仍是给 lighthouse 用的——它复制的是 ops 同步来的副本 `agent-src/public/data.json`。）

`build:dev-preview` 在构建后执行 `scripts/patch-preview-redirects.mjs`，把 `dist/_redirects`
里的 `/data.json` 改写为反代生产站 `https://ffxiv-race-stats.pages.dev/data.json`，
预览永远显示真实数据。目标可用 `PREVIEW_DATA_URL` 覆盖。

⚠️ 反代规则**只能在预览构建时注入**：`dist/_redirects` 与生产站共用（`build-dist.yml`
会把整个 dist/ 推到 ops 仓库），若在 `public/_redirects` 里写死目标，生产站会自己代理自己。

## 相关链接

- 站点：CF Pages URL（dashboard 查看）
- dev 仓库：https://github.com/mmw-devs/ffxiv-race-stats
- ops 仓库：https://github.com/mmw-devs/ffxiv-race-ops
