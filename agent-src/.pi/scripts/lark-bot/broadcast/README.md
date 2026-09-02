# broadcast/ — L4a Broadcast 子系统占位

> 状态：**未实现**。当前所有群聊消息仍走 L4b Interactive 路径。

## 设计目标（来自重构讨论）

按 SSOT 原则，L4a 与 L4b 应是**两个独立子系统**，不共享可变状态。群聊在未来将被重新定位为：

- **广播目标**：系统 → 群聊（单向、无状态、无任务概念）
- **授权范围**：群成员关系 → 私聊业务操作的授权上下文（属于 L4b 内部）
- **资源配额**：活跃群聊最多 N 个并发 p2p session（属于 L4b 内部）

## 待实现

- `subscriptions.ts` — 群订阅表（哪个群订阅哪类广播）
- `dispatcher.ts` — 推送器（订阅匹配 + lark-cli 推送）
- 集成到 L3 Routing：chat_type=group 但 sender=bot 的入站事件不再返回 ERROR

## 与当前代码的关系

`scripts/lark-bot/main.ts` 当前未引用本目录任何模块。群聊处理逻辑位于 `interactive/session-manager.ts` 的 `startAllPi()` 内的 `group:<chat_id>` session 启动逻辑，待 broadcast 子系统落地后剥离。
