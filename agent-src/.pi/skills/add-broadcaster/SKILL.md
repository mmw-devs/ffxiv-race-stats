---
name: add-broadcaster
description: >
  管理赛事转播方。当运营要求添加、更新、删除转播方时触发。
  触发词：转播方、添加转播、删除转播、更新直播间、broadcaster。
---

# add-broadcaster

## 前置条件

在开发模式（/dev）下，此 Skill 不可用。如触发时处于开发模式，回复：
"当前开发模式（/dev），无法操作 data.json。请 /ops 返回运营模式后操作。"

## 输入

运营自然语言，例如：
- "添加转播方：老陈 bilibili https://live.bilibili.com/12345"
- "删除转播方 青豆"
- "更新转播方 老陈 的直播间地址"

## 工作流

### Step 1: 读取当前广播列表

从 `data.json` 获取 `broadcasters[]` 当前内容。

### Step 2: 确认操作

向运营确认：
```
"确认 [添加/删除/更新] 转播方：
  名称：[name]
  平台：[platform]
  链接：[url]
是否执行？"
```

### Step 3: 校验

- `platform` ∈ `{ bilibili, douyu, huya, twitch, youtube }`
- `url` 格式正确（以 `https://` 开头）
- 添加时：`id` 基于最大已有 id + 1
- 无重复名称

### Step 4: 提交

修改完成后，调用 **`content-pr` Skill** 完成分支创建、PR 提交和后续合并流程。
