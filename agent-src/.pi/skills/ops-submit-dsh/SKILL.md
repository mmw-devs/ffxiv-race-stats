---
name: ops-submit-dsh
description: >
  DeepSeek Harness + mmw-tools 运行时的 ops-submit 适配器：
  用 mmw-tools 加载仓库约束、编辑 content 分支、创建 draft PR、获取预览。
  本适配器不自动合并；L2/L3 都提示人工在 GitHub 合并。
  仅在 DSH/mmw-tools 运行时使用。
---

# ops-submit-dsh — DeepSeek Harness 适配器

本 skill 实现 `ops-submit` 契约；业务域 skill 不应直接调用这里的工具。

## 前置条件

- 当前运行环境提供 mmw-tools 仓库工具
- 已通过 `mmw_tools_run` 读取仓库约束（allowlist / denylist / 分支前缀 / preflight）
- 能从宿主获得稳定操作者身份（GitHub 账号或会话用户）；无法确定时禁止写
- 只修改 `public/data.json`
- 本地校验通过
- 业务域已给出 `changeSet`、`command`（指令 id）、`shortDesc`；`level` 由本适配器查得，不接受业务域自报

## 工作流

### 0. 确定级别

按 `command` 在 `COMMANDS.md`（或 `contract/operations.json`）查级别、确认强度与影响标记：

- 查不到该 id → 拒绝提交
- 级别不是 `L2` / `L3` → 拒绝提交
- 以下 `draft` / 合并策略均由查得的级别决定，不得由调用方覆盖

### 1. 读取约束

调用 `mmw_tools_run`，确认：

- 绑定仓库
- `content/*` 分支前缀
- 允许修改 `public/data.json`
- preflight 命令
- 当前授权阶段

### 2. 准备分支

- `mcp__mmw-tools__repo_status` 确认工作副本状态
- 必要时 `repo_clone` / `repo_pull`
- 分支名：`content/<操作>-<目标>`

### 3. 审计载荷

在 commit message 中写入与 CI 兼容的结构化日志：

```
content: <shortDesc>

````json
{
  "operator": "<稳定操作者身份>",
  "timestamp": "<ISO 8601 UTC>",
  "command": "<指令 id>",
  "changes": [
    { "field": "<字段路径>", "from": <旧值>, "to": <新值> }
  ],
  "reason": "<修正类必填>"
}
````
```

- `operator` 必须来自宿主身份，不得编造
- `command` 记录指令 id（如 `progress.update`），便于审计与查级别
- 修正类必须有 `reason`

### 4. 提交

1. 用 `mcp__mmw-tools__repo_edit` 写入 `public/data.json`，提交信息使用上面的审计载荷
2. 用 `mcp__mmw-tools__pr_create` 创建 PR：
   - L2：`draft: false`（可直接合并）
   - L3：`draft: true`（人工 review）
   - 标题包含指令与影响
   - 正文包含：指令、操作人、前置检查、影响标记、预览说明
3. 用 `mcp__mmw-tools__pr_preview` 等待并获取预览链接与检查状态

### 5. 汇报并停止

```
✅ PR 已创建：#N — <url>
   预览：<preview url>
   CI：<checks url>

L2：确认无误后回复「合并」，由宿主二次确认后合并。
L3：生命周期操作，请人工在 GitHub 合并。
```

- **L2**：操作者明确回复「合并」后，先确认 CI 通过，再调用 `mcp__mmw-tools__pr_merge`；宿主会二次确认。不得自动合并。如果 PR 仍是 draft，先标记 Ready for review。
- **L3**：禁止调用 `pr_merge`；只能人工在 GitHub 合并。
- 除上述 L2 的显式请求外，不得主动合并。

### 6. CI 失败

读取 PR 检查结果 → 诊断 → 用 `repo_edit` 修复并 push → 重新获取预览 → 再次停止等待人工合并。

## 与 lark-bot 适配器的差异

| 能力 | lark-bot | DSH/mmw-tools |
|---|---|---|
| 审计 | `larkbot_*` 生成 commit message | 自己写结构化 commit message |
| 预览 | 分支别名 URL | `pr_preview` |
| L2 合并 | Bot 可合并 | 操作者说「合并」后调用 `pr_merge`（宿主确认） |
| L3 合并 | 人工 | 人工 |

## 禁止

- 自动调用 `pr_merge`（仅 L2 且操作者明确要求时可以）
- 直推 main
- 编造 operator
- 修改 `public/data.json` 以外的文件
- 在未读取 mmw-tools 约束前提交
