---
description: 检查当前数据完整性
argument-hint: ""
---

# 数据完整性检查

读取 `data.json` 全量数据，逐项检查结构完整性和逻辑一致性。

## 检查项

- `meta` 字段是否完整（eventName、edition、dungeon、boss、dataCenter、startTime、status）
- `teams[]` 每队：id、name、rank、bossHP、phase、region、isLive、8 名 players 均完整
- rank 无重复、无跳号、无越界
- phase 在 `PHASE_ORDER` 白名单内（PHASE_ORDER 定义在 `constants.js`）
- region 在 `['JP','NA','EU','OC','CN','KR']` 内
- bossHP 在 0-100 区间
- `news[]` 每条：id、time、title 完整，time 格式正确
- `broadcasters[]` 每条：id、name、platform、url 完整

## 输出

列出所有异常项。如果一切正常，报告"数据完整，无异常"。
不需要提交——仅做检查。
