# Preview 部署（CF Pages）

dev 仓库接入 Cloudflare Pages 后，每个 PR 会自动获得 preview 部署。

## 流程

1. 开 PR
2. CF Pages bot 自动跑 build（`npm ci && npm run typegen && npm run typecheck && npm run build && cp agent-src/public/data.json dist/data.json`）
3. PR 评论里 CF Pages bot 贴 preview URL（形如 `https://{commit-hash}.ffxiv-race-stats-dev.pages.dev`）
4. reviewer 在浏览器打开 preview URL 验证页面
5. PR 合并后 main 自动部署到生产（`https://ffxiv-race-stats-dev.pages.dev`）

## 关于 data.json

preview 环境的 `data.json` 来自 dev 仓库的 `agent-src/public/data.json` 镜像（由 ops 仓库 `sync-data-to-dev.yml` 推送）。

镜像可能略滞后于 ops 仓库最新内容，但通常几分钟内同步。

## 注意事项

- preview URL 公开可访问，任何人猜到 PR 编号都能看
- data.json 镜像内容是公开赛事信息，无敏感泄露
- build 时间约 1–2 min / PR