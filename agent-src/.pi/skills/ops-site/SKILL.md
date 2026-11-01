---
name: ops-site
description: >
  站点内容：首页文案/CTA、赛事规则、SEO、首页媒体、章节标题。
  触发词：文案、导语、眉题、按钮、规则、SEO、标题、描述、视频、海报、章节标题。
  只改运营文案，不改导航、列头、交互文案和章节结构。
---

# ops-site — 站点内容

先加载 `.pi/commands.md` 的「站点域」；本 skill 只负责流程与话术。

## 职责边界

负责：

- `content.hero`：眉题、导语、主/次按钮
- `content.rules`：规则标题、眉题、条目
- `content.seo`：title、description、ogImage
- `content.media`：首页视频、海报的路径
- `content.sections`：四个已有章节的 kicker/title

不负责：

- `meta`（赛事名/时间/状态/副本）
- 队伍、速报、公告、赞助、转播台
- 导航标签、排名列头、展开/加载/关闭等交互文案
- 章节 id / 顺序

## 工作流

### 1. 映射字段

把自然语言映射到完整字段路径，例如：

- “首页导语改成 xxx” → `content.hero.lead`
- “规则第 2 条改成 xxx” → `content.rules.items[1]`
- “速报章节标题改成 xxx” → `content.sections.news.title`
- “换首页视频” → `content.media.heroVideo`（同时确认海报）

### 2. 校验

按 `.pi/commands.md` 与 validator：

- 文案非空、中文全角标点
- 链接/路径合法
- 规则至少 1 条
- 只改已有四个章节
- 媒体路径指向 dev 仓库已存在的素材；换素材使用带版本文件名

### 3. 预览

展示字段路径 + 旧值 → 新值；不要只给自然语言摘要。

### 4. 确认并提交

- 普通确认「确认」
- 记录变更，调 `ops-submit`，级别 **L2**

## 注意

- `content.seo` 是构建期 head 快照；修改后需要等 dev 重新构建，首屏 HTML 才会更新
- 媒体素材必须先在 dev 仓库 `public/` 提交；ops 这里只改路径
- 不得编造运营未提供的文案
