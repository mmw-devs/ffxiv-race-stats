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
npm run test:unit  # 前端纯函数 / 状态单测（Vitest）
```

访问 `http://localhost:4321`。

`npm run dev` 会把 `/data.json` 转发到真源（`astro.config.mjs` → `scripts/data-source.mjs`），
本地直接看到当前真实数据；仓库里不保存数据副本。

## 技术栈

Astro 7 + Vue 3，组件化架构（16 个页面组件 + `App.vue` 根组件；全局样式与 OKLCH token 集中在 `src/styles/`）。

```
src/
├── pages/index.astro         # 入口
├── layouts/BaseLayout.astro  # 全局布局 + head
├── styles/                   # tokens / base / 区块 CSS（global.css 入口）
├── App.vue                   # 根组件（loading / error / ready 状态机）
├── components/               # 16 个 Vue 组件（PageView 承载 ready 后的页面主体）
├── composables/              # useRaceData / usePageMotion / useNow / useScroll / useExpandableList / useReveal / useTimer / usePageSeo
├── utils/                    # 纯函数（排名排序、阶段解析、时间格式化、数据校验/解析）
├── selectors.ts              # 派生值（coverage / live / folio / phase）
├── sections.ts               # 章节 id / 顺序 / 导航标签（站点结构）
└── types.ts                  # 前端共享类型（schema 生成 + Coverage）
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
| `build-verify.yml` | dev PR | `npm ci` → typegen → typecheck → data-path:check → test:unit → lint → build → size |
| `build-dist.yml` | dev main push | 构建 dist/ 推送到 ops 仓库 |
| `sync-agent-src.yml` | dev main push + agent-src/** | 同步 agent-src/ 到 ops 仓库 |
| `sync-issue.yml` | dev issues 事件 | dev issues → 飞书多维表格 |
| `sync-pr.yml` | dev PR 事件 | dev PRs → 飞书多维表格 |

**dev → ops 推送规则**：
- `build-dist.yml` 和 `sync-agent-src.yml` 共享 `sync-ops` concurrency group，串行推送
- `sync-agent-src.yml` 使用 rsync + exclude，排除 `dist/`、`public/data.json`、`*:Zone.Identifier`、`.git/`
  （`public/data.json` 只存在于 ops；dev 不持有副本，该排除项同时防止 `rsync --delete` 误删它）

## 数据（单一事实源，SSOT）

`data.json` **只有一份**，位于 ops 仓库 `mmw-devs/ffxiv-race-ops` 的 `public/data.json`，
由运营人员通过 `content/*` PR 维护。dev 仓库**不保存副本**——副本会漂移，一旦漂移，
消费它的预览站/构建就会静默拿到过期数据（2026-10 线上报的「meta.dungeons 应为数组」正是如此）。

需要数据的场景一律「读真源」，而不是「存副本」：

| 场景 | 取数方式 | 入口 |
|---|---|---|
| 本地开发 `npm run dev` | Vite 代理 `/data.json` → 真源 | `astro.config.mjs` |
| lighthouse / `build:preview` | 构建前下载到 `.astro-data/data.json`，构建后复制到 `dist/data.json` | `scripts/fetch-build-data.mjs` / `scripts/copy-build-data.mjs` |
| dev 预览站（CF Pages） | **同 `build:preview`**：构建时先取数、再构建、复制数据 | `npm run build:dev-preview` |
| 生产站（CF Pages，ops 仓库） | dev `build-dist` 构建前取数生成 head；ops 构建时 `cp public/data.json dist/data.json` | `build-dist.yml` |

`build:preview` 先取数并跑完整 schema 校验，再构建（让 `content.seo` 进入首屏 head），最后把同一份数据复制到 `dist/data.json`；坏数据直接阻断构建。顶层 required 直接来自 `root.schema.json`，不在脚本里维护第二份。

SEO head 是**构建时快照**：ops 只改 `data.json` 不会自动重跑 dev 构建，因此 head 可能滞后于 runtime 数据；runtime 内容仍由客户端 fetch 更新。若要求 head 与数据严格同步，应改 SSR 或在 ops 部署期改写 head。

dev 预览站与生产站**产物同构**：两者都把自己的 `dist/data.json` 作为同源静态文件提供，
不使用任何边缘 rewrite/代理。曾尝试用 `_redirects` 把 `/data.json` 200 重写到生产站，
但「直接访问能拿到 JSON、页面内 fetch 却失败」——边缘 rewrite 与静态文件不是同一条路径，
不该让预览站依赖它。

真源 URL 统一定义在 `scripts/data-source.mjs`（可用 `DATA_SOURCE_URL` 覆盖），
换仓库/换地址只改这一个文件。浏览器运行路径 `/data.json` 与构建产物路径
`dist/data.json` 统一定义在 `shared/data-path.mjs`；`public/_redirects` 由
`scripts/generate-redirects.mjs` 生成，CI 用 `npm run data-path:check` 防漂移。

运营文案放在 `data.json` 的 `content` 块（`hero` / `rules` / `seo` / `media` / `sections`），
契约见 `agent-src/schema/content.schema.json`。`content` 是 required，前端不再保留代码兜底；
ops 数据由 `content/*` PR 维护。

内容归属补充：导航标签、排名列头、展开/加载/关闭等交互文案、Footer 品牌与版权、Guides 占位文案
属于代码 chrome；`meta.boss` / `meta.dataCenter` 是预留字段，当前 UI 不渲染。

运行时刷新：`useRaceData` 目前只在首次加载 / 手动重试时取数，不做轮询；live 赛事若需要自动刷新，
应另加 visibility-aware polling + ETag，避免打断滚动、视频和弹窗。

`build-verify` 带守卫：任何 PR 引入 `data.json` 副本都会失败。

> 历史：dev 曾保留一份副本，靠「ops CI 同步 + PR 合并」维持一致。那条链路需要跨仓库
> token、同步 workflow、`ops-sync/*` 分支约定和人工合并，任何一环坏掉副本就腐化
> （实际失效两个多月）。去掉副本后这些机制全部不再需要。

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

dev 仓库自身的 CF Pages 预览项目用 **`npm run build:dev-preview`**（等价于 `build:preview`）：
构建时从真源下载数据写入 `dist/data.json`，产物与生产站同构——都是同源静态文件。

为什么不用边缘反代：曾把 `/data.json` 用 `_redirects` 200 重写到生产站，结果「直接访问该路径
能拿到 JSON，页面内 fetch 却报数据加载失败」。边缘 rewrite 与静态文件不是同一条投递路径
（响应头/重编码/rewrite 语义都不同），而生产站用的是静态文件。让预览站走同一条路，
两侧行为才可比、可复现。

代价：预览数据是**上次构建时**的快照（每次 push 重新构建刷新），不是每次请求实时。

## 相关链接

- 站点：CF Pages URL（dashboard 查看）
- dev 仓库：https://github.com/mmw-devs/ffxiv-race-stats
- ops 仓库：https://github.com/mmw-devs/ffxiv-race-ops
