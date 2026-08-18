---
name: ops-base
description: 运营任务统一入口。当前 MVP 仅用于在可信飞书 task context 中规划和确认单支队伍的 phase、bossHP、isLive 更新。
---

# ops-base

当前只支持 `updateTeam`，且只允许一个 team 的 `phase`、`bossHP`、`isLive`。Runtime 仅授权 `OPS_BASE_ALLOWED_OPEN_IDS`（逗号分隔的完整飞书 open_id）中的 operator；未配置时失败关闭。

## 工作方式

1. 只把用户自然语言转换为 `ops_base_plan_update_team` 的业务字段；不要从文本提取或传入 taskId、operator、chatId、messageId。
2. team id 是权威 target。名称仅可用于辅助查找；工具要求补充 id 或返回歧义时，向用户提问。
3. 工具返回操作单后，展示 target、每一项 from/to、planHash，并等待原用户明确确认。
4. 只有用户明确确认当前 planHash 后，调用 `ops_base_confirm_update_team`，再调用 `ops_base_validate_update_team`。
5. validator 只接受已确认 candidate，只生成 validation report；失败不写 workspace。成功后先展示已校验结果。
6. 只有已校验成功时，才可调用 `ops_base_apply_validated_candidate` 显式将 candidate artifact 应用到共享 workspace，再调用提交工具。
7. 不得调用旧 `update-team`、`content-pr` Skill。

## 约束

- phase 仅为 `P1`、`P2`、`P3`、`P4`、`CLEAR`，不得后退。
- bossHP 不得增加。
- isLive 只能在用户明确给出布尔值时修改，绝不自动推断。
- rank、name、players、region 及其他字段一律拒绝。
- 不得绕过 ops-base Runtime 直接编辑 `public/data.json`。
