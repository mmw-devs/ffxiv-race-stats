---
name: ops-submit
description: >
  运营写操作的运行环境无关提交通道契约：校验、审计、content PR、预览与合并策略。
  业务域 skill 完成变更后调用；具体平台工具由当前运行环境的适配器提供。
  触发词：提交、合并、PR、预览。
---

# ops-submit — 提交契约（与运行环境无关）

本 skill 规定“必须发生什么”，不规定“用哪个工具”。

业务层 skill 与 `COMMANDS.md` 不得假设消息渠道、Agent 运行时或具体工具名。

## 适配器

按当前运行环境加载对应适配器：

| 运行环境 | 适配器 |
|---|---|
| PI Agent + lark-bot（飞书） | `ops-submit-larkbot` |
| DeepSeek Harness + mmw-tools | `ops-submit-dsh` |

如果当前环境没有可用适配器，拒绝写操作，不要临时拼平台命令。

## 运行环境必须提供的能力

1. 稳定操作者身份；缺失或 `unknown` → 禁止写
2. 显式确认交互
3. 审计能力：操作人、指令、时间、字段变更、原因/影响
4. `content` 分支 / PR 提交
5. 预览链接
6. 合并能力：按契约 `levels[level].agentMerge` 决定；L2 可代合（操作者看过预览并明确要求后），L3 禁止代合

## 输入

- `command`：指令 id（如 `event.end`，来自 `COMMANDS.md`）
- `level`：不再由调用方声明；按 `command` 查契约得到
- `shortDesc`
- `changeSet`
- `operator`
- `reason` / `impact`（如有）

## 流程

1. 按 `command` 在 `COMMANDS.md` 查得级别、确认强度、前置条件与影响标记，再执行本地校验
2. 生成审计载荷
3. 选择当前运行环境的适配器；不得假设固定平台
   - 无法判断当前运行环境时，不得猜测；先确认可用工具或拒绝写操作
4. 适配器创建 `content` 分支与 PR
5. 获取预览
6. 停止并报告；不要继续自动操作
7. **L2**（`agentMerge: true`）：操作者看过预览、明确要求合并后，才可代合；未确认就只提示人工
8. **L3**（`agentMerge: false`）：一律提示人工在 PR 平台合并；禁止调用合并

## 合并策略

| 级别 | 合并 |
|---|---|
| L2 | `agentMerge: true`；操作者看过预览并明确要求后才可代合；无能力时转人工 |
| L3 | `agentMerge: false`；只能人工在 PR 平台合并；禁止 agent 调用合并 |

## 报告内容

- PR 链接
- 预览链接（如有）
- 审计摘要：指令、操作人、变更、影响标记
- 合并方式：agent 代合 / 人工（按 `agentMerge`）
- CI 链接（如有）

## 禁止

- 假设消费者是飞书、lark-bot、DSH 或任何单一平台
- 在业务 skill 里直接调用平台工具
- 绕过审计
- 对 `agentMerge: false` 的级别调用合并
- 在身份、确认、审计、提交或预览能力缺失时提交
