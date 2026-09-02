# broadcast/ — L4a Broadcast 子系统占位

> 状态：**未实现**。当前所有入站消息仅处理 p2p，群聊消息在 ingress 处丢弃。

## 设计目标（来自重构讨论）

按 SSOT 原则，L4a 与 L4b 应是**两个独立子系统**，不共享可变状态。群聊将被重新定位为：

- **广播目标**：系统 → 群聊（单向、无状态、无任务概念）
- **授权范围**（属于 L4b 内部子模块）：群成员关系 → 私聊业务操作的授权上下文
- **资源配额**（属于 L4b 内部子模块）：活跃群聊最多 N 个并发 p2p session

本目录将承载：

- `subscriptions.ts` — 群订阅表（哪个群订阅哪类广播）
- `dispatcher.ts` — 推送器（订阅匹配 + lark-cli 推送）

## 与当前代码的关系

`scripts/lark-bot/main.ts` 当前未引用本目录任何模块。

`protocol/feishu.ts` 也不再有群聊相关 I/O（poll 兜底、mention 判定、replyInThread 均已剔除）。

群聊的入站路径在 `ingress.ts` 的 `shouldHandle()` 内被丢弃（`chat_type !== "p2p"` 返回 false）。
群聊的出站路径待 broadcast 子系统实现后开放。
