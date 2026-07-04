---
name: content-pr
description: >
  通用 content PR 提交流程。当其他运营 Skill 修改 data.json 后，调用此 Skill 完成分支创建、推送、PR 创建和合并。
  触发词：提交 PR、合并、merge。
---

# content-pr

## 概述

此 Skill 是所有运营侧 data.json 变更的统一提交通道。三个业务 Skill（update-team、add-news、add-broadcaster）修改 data.json 后，统一通过此 Skill 完成 GitHub 操作。

## 工作流

### 1. 创建 PR

1. 确认分支名：`content/<操作>-<目标>`，后缀 ≤ 20 ASCII 字符
2. 获取 App token，创建 content 分支，修改 data.json，commit
3. Push 到 GitHub，`gh pr create --base main`（以 `race-ops-bot[bot]` 身份）

### 2. ⚠️ 汇报并硬停止（必须执行，不可跳过）

PR 创建后，**只允许输出以下内容**，然后**本轮工作结束**：

```
✅ PR 已创建：#N — https://github.com/ffxiv-race-stats/ffxiv-race-stats/pull/N
   预览链接：https://<净化分支名>.ffxiv-race-stats.pages.dev
   净化规则：/ → -，全小写，取前 28 字符
   CI 校验：https://github.com/ffxiv-race-stats/ffxiv-race-stats/actions

⚠️ 生产站 https://ffxiv-race-stats.pages.dev 还没有更新。
   请打开预览链接确认后，回复"合并"。
```

- 不得在用户回复"合并"前执行 merge
- 不得主动检查 CI 状态
- 不得执行任何其他操作
- 输出上述内容后立即停止

### 3. 合并循环

收到用户"合并"后进入此循环：

```
loop:
    gh pr view <N> --json state,statusCheckRollup   # 检查 CI
    if CI 通过:
        gh pr merge <N> --squash --delete-branch    # 合并
        汇报: "✅ 已合并，生产站更新中: https://ffxiv-race-stats.pages.dev"
        break                                        # 结束
    else:
        读 CI 错误日志 → 诊断 → 修复 data.json → push  # PR 自动更新
        汇报: "修复内容 + 预览链接 + 等待回复'合并'"
        硬停止，等待用户再次回复"合并"后 continue
```

## 预览链接

Cloudflare Pages 自动为每个分支生成预览。URL 格式：

```
https://<sanitized-branch>.ffxiv-race-stats.pages.dev
```

净化规则：分支名中 `/` → `-`，全小写，取前 28 字符。

## 分支命名示例

| 操作 | 分支名 |
|------|--------|
| 更新队伍 1 到 P5 | `content/update-t1-p5` |
| 添加新闻 | `content/add-news-n3` |
| 更新转播方 | `content/update-br-laochen` |
