---
name: lark-bot
description: >
  飞书 Bot — pi RPC 代理。将飞书消息转发给 PI Agent，将 Agent 回复发回飞书。
  触发词：飞书消息、Bot 回复、启动 Bot、停止 Bot。
---

# lark-bot — 飞书 Bot（pi RPC 代理）

## 架构

```
飞书用户 ──消息──→ lark-cli event consume
                        │
                   lark-bot.ts (过滤/清洗/翻译)
                        │
                   pi --mode rpc (PI Agent)
                        │
                   lark-bot.ts (提取回复)
                        │
                   lark-cli im +messages-reply ──→ 飞书用户
```

**lark-bot 不持有一行业务逻辑。** 只做三件事：
1. 接收飞书事件 → 清洗为 agent 可读格式
2. 通过 pi RPC 协议发送 prompt
3. 提取 agent 回复 → 发回飞书

## 命令

```bash
# 启动
tsx .pi/scripts/lark-bot.ts &

# 停止
kill $(cat /tmp/lark-bot.pid)
```

## 行为

| 场景 | 行为 |
|------|------|
| 私聊消息 | 转发给 agent |
| 群聊消息（未 @Bot） | 忽略 |
| 群聊消息（@Bot） | 去除 @提及后转发给 agent |
| 非文本消息 | 忽略 |

## 前置条件

- `@larksuite/cli` 已安装
- `pi` 已安装并可执行（`pi --mode rpc`）
- `tsx` 已安装
- 飞书应用已配置 `im.message.receive_v1` 订阅
