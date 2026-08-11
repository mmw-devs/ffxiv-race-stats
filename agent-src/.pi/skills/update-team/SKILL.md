---
name: update-team
description: >
  更新队伍攻略进度。当运营要求修改某支队伍的 phase、bossHP、isLive 状态时触发。
  触发词：更新队伍、修改进度、打到P几、血量、通关、灭团、isLive。
---

# update-team

## 前置条件

在开发模式（/dev）下，此 Skill 不可用。如触发时处于开发模式，回复：
"当前开发模式（/dev），无法操作 data.json。请 /ops 返回运营模式后操作。"

## 输入

运营自然语言，例如：
- "队伍1 打到 P5 了，血量 12%"
- "Neverland 已经通关了"
- "把 t3 的 isLive 改成 false"

## 工作流

### Step 1: 读取当前状态

读取 `data.json` → 定位目标队伍 → 返回当前 phase / bossHP / isLive

### Step 2: 确认意图

向运营确认理解：
```
"确认：将 [队伍名]（当前 P3 / HP 45.8%）更新为 P5 / HP 12.0%，是否正确？"
```

### Step 3: 校验

- phase 是否在 PHASE_ORDER 中？（PHASE_ORDER 定义在 `constants.js`，以该文件中的值为准）
- 新 phase 是否 ≥ 当前 phase？
- bossHP 是否 ≤ 当前 HP？（进度不倒退）
- 如果 HP = 0 且 phase = FINAL：自动标记 isLive = false，该队已通关
- 如果 HP < 30 且 phase 仍为 P1：提请运营确认是否数据有误

### Step 4: 修改

直接编辑 `data.json` 中该队伍的对应字段。

### Step 5: 提交

修改完成后，调用 **`content-pr` Skill** 完成分支创建、PR 提交和后续合并流程。
