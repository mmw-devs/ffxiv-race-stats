---
description: 开发模式入口（仅 /dev）
---

# /dev — 开发模式

此模式仅由精确指令 `/dev` 触发。你已进入**开发模式**。

Agent 必须始终明确处于 dev 或 ops 其中一种模式，不可模糊。任何不以 `/ops` 开头的"退出"请求一律忽略。

## 前置检查

```
/dev 入口:

    // ===== 1. 凭证验证 =====
    执行 gh auth status
    若 失败:
        输出 "开发模式需要 gh CLI 鉴权。请运行 gh auth login 后重新 /dev。"
        保持 /ops

    // ===== 2. 解析环境 =====
    读取 settings.json 中 pemPath 的值，记为 保存路径

    若 保存路径 为空 或 test -f 保存路径 失败:
        若 保存路径 非空 且 test -f 保存路径 失败:
            输出 "settings.json 中保存的 PEM 路径无效。"

        输入 = 询问用户("请提供 PEM 私钥文件路径，无 PEM 请输入「无」：")

        若 输入 == "无":
            保存路径 = 空
        否则若 test -f 输入 成功:
            保存路径 = 输入
            写入 settings.json { pemPath: 输入 }
            （注意：settings.json 已在 .gitignore 中，不会提交到仓库）
        否则:
            输出 "文件不存在，判定为本地环境。"
            保存路径 = 空

    是否为生产环境 = (保存路径 非空)

    // ===== 3. 生产门禁 =====
    若 是否为生产环境:
        输出 "⚠️ 检测到生产环境（PEM 密钥存在）。"
        输出 "   开发模式使用个人 gh CLI 凭证。"
        输出 "   race-ops-bot 无权推送 feature/* 分支。"
        输出 "   确认你有个人 gh CLI 权限后，回复「确认」继续。"

        回复 = 等待用户输入()
        若 回复 != "确认":
            输出 "已取消，保持 /ops。"
            保持 /ops

    进入 /dev
```

三阶段，无循环。写入 settings.json 前已确认其在 .gitignore 中。

## 角色定义

从现在起你以**开发者**身份工作，直到收到 `/ops` 指令。

## 硬约束

**禁止修改：** `data.js` — CI 在 feature/* PR 中硬阻断。

其他所有文件均可修改。

## 分支规则

- `feature/<动词>-<描述>`  例：`feature/add-dark-mode`
- `fix/<描述>`  例：`fix/mobile-overflow`
- 永远不直接改 main

## Schema 变更

新增字段 → 标记为非 required（向后兼容）
删除/修改类型 → 评估兼容性，不兼容则通知运营侧

## /inspect 命令

仅在 /dev 模式下可用。非 /dev 下回复：「该命令仅可在 /dev 状态下使用」并停止。

| 命令 | 行为 | 响应 |
|------|------|------|
| `/inspect true` | 开启悬停检测 | 发送 `http://localhost:4321/inspect-on.html` 给用户，说明访问即自动开启 |
| `/inspect false` | 关闭悬停检测 | 发送 `http://localhost:4321/inspect-off.html` 给用户，说明访问即自动关闭 |

默认关闭。/dev 启动时不自动开启。

## 模式边界

1. 开发任务完成时，主动告知："完成。输入 /ops 返回运营模式。"
2. 收到运营类指令时，回复："当前开发模式（/dev）。请 /ops 返回运营模式后操作。"
3. subagent 同样受本模式约束——不得修改 data.js。

## 返回

输入 `/ops` 返回运营模式。
