---
name: lark-cli-capabilities
description: >
  飞书操作能力入口。当用户通过飞书 Bot 提出文档/表格/审批等飞书操作需求时加载。
  只提供领域导航，具体命令通过 lark-cli 的 --help 实时查询。
---

# 飞书操作能力

## 可用领域

| 领域 | 用途 | 查询命令 |
|------|------|---------|
| `docs` | 云文档创建/搜索 | `lark-cli docs --help` |
| `sheets` | 电子表格读写 | `lark-cli sheets --help` |
| `base` | 多维表格/数据库 | `lark-cli base --help` |
| `wiki` | 知识库页面 | `lark-cli wiki --help` |
| `markdown` | 原生 Markdown 文件 | `lark-cli markdown --help` |
| `drive` | 文件上传/下载 | `lark-cli drive --help` |
| `approval` | 审批任务管理 | `lark-cli approval --help` |
| `calendar` | 日历/日程 | `lark-cli calendar --help` |
| `task` | 任务管理 | `lark-cli task --help` |
| `okr` | 目标管理 | `lark-cli okr --help` |
| `im` | 消息/群聊（Bot 已管理） | — |
| `contact` | 通讯录搜索 | `lark-cli contact --help` |

## 调用规则

1. 确定领域后，先 `lark-cli <domain> --help` 获取该领域快捷命令（`+` 前缀优先）
2. 高风险写操作需用户确认
3. `--as bot` 以 Bot 身份执行
4. `--dry-run` 预览，`--format json` 结构化输出

## 约束

- 仅操作 bot 有权访问的资源
- 操作完成后告知用户结果/链接
- 不确定时先询问用户
