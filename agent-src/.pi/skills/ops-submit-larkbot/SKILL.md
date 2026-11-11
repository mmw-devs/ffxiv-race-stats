---
name: ops-submit-larkbot
description: >
  lark-bot 运行时的 ops-submit 适配器：飞书私聊 + PI Agent。
  使用 larkbot_* 工具生成审计与 commit message，用 git/gh 创建 content PR、取预览；
  L2 可在运营确认后由 Bot 合并，L3 只能 GitHub 手动合并。
  仅在 lark-bot 运行时使用。
---

# ops-submit-larkbot — lark-bot 适配器

本 skill 实现 `ops-submit` 契约；业务域 skill 不应直接调用这里的工具。

## 前置条件

- 当前运行环境是 lark-bot（私聊业务域）
- operator 来自 lark-bot 注入的飞书 `user_id`；缺失或 `unknown` 时不得提交
- 只修改 `public/data.json`
- `npm run validate` 通过
- 业务域已给出 `changeSet`、`command`（指令 id）、`shortDesc`；`level` 由本适配器查得，不接受业务域自报

## 工作流

### 0. 查级别

按 `command` 在 `COMMANDS.md` 查级别、确认强度与影响标记：

- 查不到该 id → 拒绝提交
- 级别不是 `L2` / `L3` → 拒绝提交
- L3 只允许人工在 GitHub 合并，本适配器不执行合并

### 1. 写审计

1. 对 `changeSet` 的每个字段调用 `larkbot_record_change`（`chatId`、`field`、`from`、`to`）
2. 调 `larkbot_commit_changes` 获取 `commitMessage`
3. **原样使用** `commitMessage`，不得修改任何字符

### 2. 创建 PR

1. 分支名：`content/<操作>-<目标>`，`content/` 后缀 ≤20 个 ASCII 字符
2. `git commit -m "$commitMessage"`
3. push
4. `gh pr create --base main`（`race-ops-bot[bot]` 身份）

### 3. 预览

- 格式：`https://<sanitized-branch>.ffxiv-race-stats.pages.dev`
- 净化：`/` → `-`，其他非字母数字 → `-`，全小写，截断到 28 字符

### 4. 汇报并停止

**L2：**

```
✅ PR 已创建：#N
   预览：https://...
   CI：https://github.com/mmw-devs/ffxiv-race-ops/actions

⚠️ 生产站还没有更新。请确认预览后回复「合并」。
```

**L3：**

```
✅ L3 PR 已创建：#N
   预览：https://...

⚠️ 生命周期操作，Bot 不会合并。
   请核对 PR 后，到 GitHub 手动合并。
```

L3 下即使运营回复「合并」，也不得执行合并。

### 5. 合并循环（仅 L2，即 `agentMerge: true`）

收到「合并」后：

1. `gh pr view <N> --json state,statusCheckRollup`
2. CI 通过 → `gh pr merge <N> --squash --delete-branch`
3. 汇报生产更新中
4. CI 未通过 → 读日志、修复、push；PR 自动更新；再次停止等待「合并」

## 禁止

- 直推 `main`
- 修改或自行构造 `commitMessage`
- L3 由 Bot 合并
- 在临时私聊域未鉴权时提交
- 提交 `public/data.json` 以外的文件
