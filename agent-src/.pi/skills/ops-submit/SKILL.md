---
name: ops-submit
description: >
  运营写操作的统一提交通道：本地校验、结构化操作日志、content PR、预览与合并。
  L2 指令在运营回复「合并」后由 Bot 合并；L3 生命周期指令只能由人在 GitHub 手动合并，Bot 永不合并。
  触发词：提交、合并、PR、预览。业务域 skill 完成变更后调用本通道。
---

# ops-submit — 提交通道（平台能力）

本 skill 不解释业务。它只负责把**已经确认的 data.json 变更**安全送上生产。

## 输入

- `level`：`L2` 或 `L3`，由业务域按 `.pi/commands.md` 给出
- `shortDesc`：一句话描述本次变更
- 已应用、且已通过本地校验的 `public/data.json`

## 前置条件

- 只允许修改 `public/data.json`；不得带其他文件
- `npm run validate` 必须通过
- 已用 `larkbot_record_change` 记录所有字段变更
- operator 必须来自 lark-bot 注入的飞书 `user_id`；缺失或 `unknown` 时不得提交

## 工作流

### 1. 校验

```bash
npm run validate
```

不通过则回到业务域修复，不创建 PR。

### 2. 创建分支与提交

1. 分支名：`content/<操作>-<目标>`，`content/` 后缀 ≤20 个 ASCII 字符
2. 调 `larkbot_commit_changes` 获取 `commitMessage`
3. **原样使用** `commitMessage` 提交，不得修改任何字符
4. push 到 GitHub
5. `gh pr create --base main`（`race-ops-bot[bot]` 身份）

### 3. 汇报并硬停止

**L2：**

```
✅ PR 已创建：#N — https://github.com/mmw-devs/ffxiv-race-ops/pull/N
   预览链接：https://<净化分支名>.ffxiv-race-stats.pages.dev
   CI 校验：https://github.com/mmw-devs/ffxiv-race-ops/actions

⚠️ 生产站还没有更新。请确认预览后回复「合并」。
```

**L3：**

```
✅ L3 PR 已创建：#N — https://github.com/mmw-devs/ffxiv-race-ops/pull/N
   预览链接：https://<净化分支名>.ffxiv-race-stats.pages.dev

⚠️ 这是生命周期操作，Bot 不会合并。
   请核对 PR 里的指令、影响与清单后，到 GitHub 手动合并。
```

L3 下即使运营回复「合并」，也不得执行合并；只能提示需要人工在 GitHub 操作。

### 4. 合并循环（仅 L2）

收到「合并」后：

1. `gh pr view <N> --json state,statusCheckRollup`
2. CI 通过 → `gh pr merge <N> --squash --delete-branch`
3. 汇报生产更新中
4. CI 未通过 → 读日志、诊断、修复 data.json、push；PR 自动更新；汇报后再次硬停止，等待「合并」

L3 没有这个循环。

## 预览链接

- 格式：`https://<sanitized-branch>.ffxiv-race-stats.pages.dev`
- 净化：`/` → `-`，其他非字母数字 → `-`，全小写，截断到 28 字符
- 分支名过长会截断，命名时保持短

## 禁止

- 直推 `main`
- 修改或自行构造 `commitMessage`
- L3 由 Bot 合并
- 在临时私聊域未鉴权时提交
- 提交 `public/data.json` 以外的文件
- 在业务域未确认前提交
