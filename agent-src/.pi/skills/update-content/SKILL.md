---
name: update-content
description: >
  修改站点运营文案与媒体（hero / rules / SEO / media / sections）。
  当运营要求改首页导语/眉题/按钮、赛事规则、SEO 标题描述、首页视频/海报、章节标题时触发。
  触发词：改文案、首页文案、导语、眉题、按钮、规则、SEO、标题、描述、视频、海报、章节标题。
---

# update-content

## 前置条件

在开发模式（/dev）下，此 Skill 不可用。如触发时处于开发模式，回复：
"当前开发模式（/dev），无法操作 data.json。请 /ops 返回运营模式后操作。"

## 可修改范围

只允许修改 `public/data.json` 的 `content` 块：

| 字段 | 类型 / 约束 |
|---|---|
| `content.hero.kicker` | 字符串，非空 |
| `content.hero.lead` | 字符串，非空 |
| `content.hero.primaryCta.label` | 字符串，非空 |
| `content.hero.primaryCta.href` | `#...`、`/...` 或 `https?://...` |
| `content.hero.secondaryCta.label` | 字符串，非空 |
| `content.hero.secondaryCta.href` | 同上 |
| `content.rules.title` | 字符串，非空 |
| `content.rules.kicker` | 字符串，非空 |
| `content.rules.items` | 非空字符串数组（至少 1 项） |
| `content.seo.title` | 字符串，非空；独立文案，不强制等于 `meta.eventName` |
| `content.seo.description` | 字符串，非空 |
| `content.seo.ogImage` | 可选；`/...` 或 `https?://...` |
| `content.media.heroVideo` | `/...` 或 `https?://...`；换片使用带版本的文件名 |
| `content.media.heroPoster` | 同上 |
| `content.sections.{ranking,news,sponsors,guides}.kicker` | 字符串，非空 |
| `content.sections.{ranking,news,sponsors,guides}.title` | 字符串，非空 |

不在本 Skill 范围：

- `meta.eventName` / `edition` / `startTime` / `status` / `dungeons`；
- 导航标签、排名表列头、展开/加载/关闭等交互文案（属于代码）；
- 章节 id / 顺序（属于代码 `sections.ts`）；
- teams / news / broadcasters / notices / sponsors（各自有独立 Skill）。

## 工作流

### Step 1: 读取现状

读取 `data.json` 的 `content` 块，定位目标字段。`content` 是 required；缺失时直接报错，不要自行补默认文案。

### Step 2: 映射请求

把运营自然语言映射到**完整字段路径**，例如：

- "首页导语改成 xxx" → `content.hero.lead`
- "报名按钮改成 xxx 链接 yyy" → `content.hero.primaryCta.label` / `.href`
- "规则第 2 条改成 xxx" → `content.rules.items[1]`
- "速报章节标题改成 xxx" → `content.sections.news.title`
- "换首页视频" → `content.media.heroVideo`（同时确认 `heroPoster`）

向运营展示 `旧值 → 新值`，不要只展示自然语言摘要。

### Step 3: 校验

按 `schema/content.schema.json` 校验：

- 字符串非空；
- CTA / SEO 图片 / 媒体的路径或 URL 格式合法；
- `rules.items` 至少 1 项，且不能有空字符串；
- `content.sections` 只能改已有四个 key 的 `kicker/title`，不得新增/删除 key；
- 中文文案遵循 `.pi/rules/content-style.md`（简体中文、全角标点；URL/路径/技术标识除外）。

媒体路径额外检查：

- 站内路径必须在 `public/` 下存在；换片/换海报必须使用带版本的文件名，避免 CDN 缓存旧素材；
- 若运营只提供新视频没有海报，先询问海报是否需要同步更新。

### Step 4: 确认

向运营确认，例如：

```
确认修改：
  content.hero.lead
    "旧导语" → "新导语"
  content.hero.primaryCta.href
    "#register" → "https://.../register"
```

确认后再写入。

### Step 5: 修改并记录

- 只修改目标字段，保留其他字段和 JSON 结构；
- 每修改一个字段，调用 `larkbot_record_change` 追加 ChangeEntry（`chatId`、`field`、`from`、`to`）；
- 数组/规则条目使用祖先字段路径（如 `content.rules.items`）记录即可；
- 修改后运行 `npm run validate`，不通过则不提交。

### Step 6: 提交

调用 `larkbot_commit_changes` 获取 commit message，再按 **`content-pr` Skill** 完成分支、PR、预览和合并流程。

分支名示例：

| 操作 | 分支名 |
|---|---|
| 改首页导语/按钮 | `content/update-hero-copy` |
| 改规则 | `content/update-rules` |
| 改 SEO | `content/update-seo` |
| 换媒体 | `content/update-hero-media` |
| 改章节标题 | `content/update-section-titles` |

## 禁止

- 不得修改 `content` 之外的任何字段；
- 不得修改导航/列头/交互文案；
- 不得编造运营未提供的文案；
- 不得自行构造或修改 `larkbot_commit_changes` 返回的 commit message；
- 不得直推 `main`，不得自行 merge。
