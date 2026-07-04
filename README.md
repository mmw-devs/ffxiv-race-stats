# FFXIV 高难首杀竞速网站

Final Fantasy XIV 世界首杀竞速排行聚合平台。追踪高难副本的首杀争夺战，提供队伍进度、选手直播、赛事速报一站式浏览。

## 本地预览

```bash
npm install        # 仅首次
npm run dev        # Astro 开发服务器 + HMR
```

访问 `http://localhost:4321`。

## 架构

```
运营人员 ──飞书──→ PI Agent ──→ GitHub ──→ Cloudflare Pages ──→ CDN
开发者   ──→ Git / IDE ──→ GitHub ──→ Cloudflare Pages ──→ CDN
```

运营人员通过 **飞书**（群聊或单聊，自然语言或 @ 机器人）指挥 PI Agent ——`pi-feishu` 扩展提供消息通道，Agent 回复与工具执行进度实时回传飞书。Agent 同时经 `feishu-mcp`（MCP server）具备读写飞书云文档的能力。

双轨模型：开发者和运营人员共享同一个 `main` 分支，通过不同的分支前缀和 PR 流程各司其职。

| | 开发轨 | 运营轨 |
|---|--------|--------|
| **分支前缀** | `feature/*`、`fix/*` | `content/*` |
| **变更对象** | `src/`、`schema/`、`constants.js`、CI | `public/data.json` 数据值 |
| **操作者** | 开发者 | Agent（代表运营人员） |
| **质量把关** | Code Review | 预览确认 |
| **频率** | 低（周级别） | 高（每天多次） |
| **文件保护** | CI 硬阻断 `feature/*` 修改 `public/data.json` | CI 硬阻断 `content/*` 修改其他文件 |

## 技术栈

Astro 7 + Vue 3，组件化架构（13 个 SFC，scoped CSS 样式隔离）。OKLCH token 系统定义在 `BaseLayout.astro` 中。

```
src/
├── pages/index.astro         # 入口
├── layouts/BaseLayout.astro  # 全局布局 + tokens
├── App.vue                   # 根组件（数据加载 + 分发）
├── components/               # 13 个 Vue 组件
├── composables/              # useTimer / useExpand
public/
└── data.json                 # 运营数据（纯 JSON）
```

## 设计文档

| 文档 | 内容 |
|------|------|
| [运营系统设计](docs/operations-system-design.md) | 双轨分支模型、权限体系、Agent 能力设计、CI 与质量保障 |

## 部署

Cloudflare Pages 连接 GitHub 仓库。需配置：

| 配置项 | 值 |
|------|------|
| Framework preset | **Astro** |
| Build command | `npm run build` |
| Output directory | `dist` |

push 到 `main` → 自动部署。push 到任意分支 → 自动生成预览链接。
