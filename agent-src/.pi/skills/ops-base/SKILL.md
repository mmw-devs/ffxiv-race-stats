---
name: ops-base
description: 运营任务统一入口。当前 MVP 仅用于在可信飞书 task context 中规划和确认单支队伍的 phase、bossHP、isLive 更新。
---

# ops-base

当前只支持 `updateTeam`，且只允许一个 team 的 `phase`、`bossHP`、`isLive`。

## 工作方式

1. 只把用户自然语言转换为 `ops_base_plan_update_team` 的业务字段；不要从文本提取或传入 taskId、operator、chatId、messageId。
2. team id 是权威 target。名称仅可用于辅助查找；工具要求补充 id 或返回歧义时，向用户提问。
3. 工具返回操作单后，展示 target、每一项 from/to、planHash，并等待原用户明确确认。
4. 只有用户明确确认当前 planHash 后，调用 `ops_base_confirm_update_team`。
5. 工具只生成 candidate artifact，不会修改 `public/data.json`，也不得调用旧 `update-team`、`content-pr` Skill。

## 约束

- phase 仅为 `P1`、`P2`、`P3`、`P4`、`CLEAR`，不得后退。
- bossHP 不得增加。
- isLive 只能在用户明确给出布尔值时修改，绝不自动推断。
- rank、name、players、region 及其他字段一律拒绝。
- 不得绕过 ops-base Runtime 直接编辑 `public/data.json`。
