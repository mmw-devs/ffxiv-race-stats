---
description: >
  数据完整性规则。在每次 data.js 写入操作前后自动生效。
  检查范围：结构完整性、逻辑一致性、边界值、写入后自检。
---
# 数据完整性规则

此规则在每次 `data.js` 写入操作前后自动生效。

## 写入前自检

每次修改 `data.js` 后，在 push 前完成以下检查：

### 结构完整性

- `RACE_DATA` 对象包含全部六个顶层 key：`meta`、`teams`、`news`、`broadcasters`、`notices`、`sponsors`
- `meta.status` ∈ `{ "upcoming", "live", "ended" }`
- 每支队伍的 `players[]` 恰好 8 人
- 每个 player 的 `job` 为合法三字母缩写
- 每个 player 的 `role` ∈ `{ "tank", "healer", "dps" }`

### 逻辑一致性

- `rank` 从 1 开始连续，无重复，无跳号
- `bossHP` ∈ [0, 100]，且只能随更新减少（进度不可倒退）
- `phase` 只能前进不能后退（按 `PHASE_ORDER` 顺序）
- 如果 `bossHP === 0` 且 `phase === PHASE_ORDER` 最后一个阶段，则该队已通关
- `news[]` 按 `time` 降序排列
- 每条 news 的 `id` 唯一
- `broadcasters[]` 每条 `id` 唯一

### 边界值

| 字段 | 约束 |
|------|------|
| `bossHP` | 0–100，允许 1 位小数 |
| `rank` | ≥1，≤ teams 数组长度 |
| `phase` | 必须在 `PHASE_ORDER` 数组中出现 |
| `region` | 必须 ∈ `{JP, NA, EU, OC, CN, KR}` |
| `streaming` | boolean |
| `isLive` | boolean |

## 写入后自检

- 重新读取 `data.js`，确认写入内容与意图一致
- 运行 `node scripts/validate-data.js` 自检（确保通过 schema + 值域 + 业务规则三阶段校验）
- 如有任一检查不通过，修复后重新自检，不通过不 push
- push 后 CI（GitHub Actions）会再次运行相同检查作为独立防线

**PHASE_ORDER 来源：** `PHASE_ORDER` 等白名单常量定义在 `constants.js`（开发者维护），Agent 不可修改。校验时以 `constants.js` 中的值为准。

## CI 失败处理

如果 PR 的 CI 检查不通过：
1. 读取 CI 错误日志：`gh run view <run_id> --log`
2. 诊断问题（语法错误？值越界？文件范围违规？）
3. 修复 `data.js`
4. Commit + push 到同一 `content/*` 分支（PR 自动更新，CI 自动重跑）
5. 重新请求运营确认
