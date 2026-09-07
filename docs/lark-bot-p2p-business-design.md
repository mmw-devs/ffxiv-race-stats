# lark-bot 私聊侧 MVP 设计文档

> L4b 私聊侧 MVP 整体设计。私聊会话按鉴权状态分为临时私聊（`p2p-temp`）和业务私聊（`p2p-business`）。

## 1. 模块定位

L4b 私聊侧 MVP。私聊会话按鉴权状态分为临时私聊（`p2p-temp`）和业务私聊（`p2p-business`），所有新会话创建时默认是临时私聊，通过群组鉴权后升级为业务私聊。

## 2. 职责边界

包含：
- 私聊会话生命周期（创建 / 鉴权 / 升级 / 结束 / 超时）
- 临时私聊 → 业务私聊的鉴权触发与升级
- 业务配额管理（N=10, K=1, 业务 9 个）
- 鉴权窗口管理（5min + 2 轮）
- 关闭清理（统一六步清单）
- /quit 命令解析（ingress 层）

不包含：
- 群组 API 调用（归 L4a 工具层 `GroupTool`）
- 鉴权判定逻辑（归 L4a 业务层 `AuthModule`）
- 飞书协议层（归 L1 `protocol/feishu.ts`）
- 任务状态机（归 `task-state-machine.ts`）
- OPERATOR_REGISTRY 删除工作（不在 MVP 范围）

## 3. 会话生命周期（七阶段）

| 阶段 | 触发 | 动作 |
|----|----|----|
| 创建 | p2p 消息进来 | 检查业务配额；通过则创建 `kind=p2p-temp` |
| 创建失败 | 业务配额已满 | 拒绝消息 + 不入队 |
| 鉴权中 | 用户消息进入鉴权窗口 | `authRoundsUsed++`；超 5min / 2 轮 → 关闭 |
| 鉴权成功 | `AuthModule.authorize()` 返回 `matched` | slot swap + `kind=p2p-business` |
| 鉴权失败 | `no_match` / `not_member` / 超时 / 超轮 | 关闭清理（fail-closed） |
| 业务结束 | /quit / 用户告知 | 关闭清理 |
| 业务超时 | 3 天无活跃 | 60s 周期清理器分支关闭 |

## 4. 分层依赖

- L4b（私聊侧）→ L4a 业务层（`AuthModule`）—— 鉴权判定调用
- L4b → L4a 工具层（`GroupTool`）—— 仅业务层内部使用，私聊侧不直接调
- L4b → L1（`protocol/feishu.ts`）—— 表情 / 回复
- L4b → `task-state-machine` —— 任务状态机
- L4b → `shared/logger` —— 日志门面

## 5. 数据结构扩展

PiSession 新增字段（`shared/types.ts`）：

```typescript
kind: "p2p-temp" | "p2p-business";
createdAt: number;
authDeadline: number; // = createdAt + 5min
authRoundsUsed: number;     // 用户消息计数（上限 2）
```

session-manager 新增 API（`interactive/session-manager.ts`）：

```typescript
countByKind(kind: PiSessionKind): number;
tryReserveSlot(kind: PiSessionKind): boolean;
releaseSlot(kind: PiSessionKind): void;
```

ingress 调用改造（`ingress.ts` 的 `handleLarkEvent`）：`identityResolver.resolveOperator` 调用点**直接替换**为群组鉴权调用链（业务描述从 `event.content` 去命令前缀后的原文取）。

## 6. 配置与常量（`config.ts`）

```typescript
MAX_P2P_SESSIONS = 10;
MAX_P2P_TEMP_SLOTS = 1;
MAX_P2P_BUSINESS_SLOTS = MAX_P2P_SESSIONS - MAX_P2P_TEMP_SLOTS; // 9
P2P_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
P2P_AUTH_MAX_ROUNDS = 2;
P2P_IDLE_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;
```

## 7. 清理机制

关闭清理清单（统一六步）：

- `sessions Map` 删除该 key
- 杀掉关联的 pi 子进程
- 清空 session 级缓存（`seenMessageIds` / `activeTask` / `waitingTasks` / `pendingResultFetch`）
- 写 journal（`emitTaskJournal({ state: "terminated", reason })`）
- 全局计数 `releaseSlot(kind)`
- 表情切换 + 飞书回复

60s 周期清理器扩展：复用现有 `setInterval(cleanupSeenMessageIds, 60_000)` 增加分支——检测所有 `kind === "p2p-temp"` 且超过 `authDeadline` 的 session，以及 `lastActivityAt` 超过 3 天且无活跃任务的 session，走关闭清理清单。