---
name: lark-bot
description: >
  飞书 Bot 消息收发（基于 @larksuite/cli）。当运营通过飞书给 Bot 发消息、要求启动/停止 Bot、查看 Bot 状态时触发。
  触发词：飞书消息、Bot 状态、启动 Bot、停止 Bot。
---

# lark-bot — 飞书 Bot 交互

## 依赖的 lark-cli 组件

| 组件 | 用途 |
|------|------|
| `event consume im.message.receive_v1 --as bot` | 监听用户消息，stdout 输出 NDJSON 事件流 |
| `im +messages-send --as bot --chat-id <id> --text <msg>` | 向指定会话发消息 |
| `im +messages-reply --as bot --msg-id <id> --text <msg>` | 回复指定消息 |
| `api POST /open-apis/im/v1/messages` | 底层发消息（feishu-bot.sh 内用） |
| `event status` | 查看总线守护进程状态 |
| `skills read lark-im` | IM 操作指南（发消息、搜索、群聊管理） |
| `skills read lark-event` | 事件消费 subprocess 契约 |

## 架构

```
飞书用户 → 发消息 → 飞书服务器 → WebSocket
                                    ↓
                              lark-cli event consume
                                    ↓ stdout NDJSON
                              feishu-bot.sh 守护进程
                                    ↓ handle_message()
                              回复（lark-cli API）
```

## 命令

### 启动 Bot

```bash
nohup bash .pi/scripts/feishu-bot.sh > /tmp/feishu-bot.log 2>&1 &
```

### 停止 Bot

```bash
pkill -f "feishu-bot.sh"
pkill -f "lark-cli.*event consume"
```

### 查看状态

```bash
lark-cli event status
```

### 手动发消息

```bash
lark-cli im +messages-send --as bot --chat-id oc_xxx --text "消息内容"
```

## 自定义回复逻辑

编辑 `feishu-bot.sh` 中的 `handle_message()` 函数。
当前默认回显 `收到: <原文>`。后续对接 PI Agent 管线后可实现智能回复。

## 前置条件

- `@larksuite/cli` 已安装，profile `ffxiv-bot` 已配置
- 飞书应用已订阅 `im.message.receive_v1` 事件
- WSL 需挂代理：`HTTP_PROXY=http://172.28.176.1:7890`
