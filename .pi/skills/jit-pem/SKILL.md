---
name: jit-pem
description: >
  JIT PEM 申请流程。开发者本地无 PEM 时，可申请 30 分钟临时 PEM 用于功能测试。
  GitHub 端在到期后自动吊销，本地文件即使保留也无法铸造有效 token。
  触发词：JIT、临时 PEM、申请私钥、jit-pem、申请 30 分钟。
---

# jit-pem

## 概述

为开发者提供**自助申请** GitHub App 私钥的 JIT（Just-In-Time）通道。设计目标：

- **自助**：开发者无需联系 Owner，触发 workflow 即可
- **有时限**：30 分钟后 GitHub 端自动吊销对应 Key ID
- **可审计**：每次申请产生 GitHub Issue 记录（含 IP、用途、Run ID）
- **隔离**：本地 PEM 路径**不写入** `.pi/settings.json`，JIT 凭证不持久化

## 触发场景

| 场景 | 触发方式 |
|---|---|
| `/dev` 入口检测到本地无 PEM + 用户选 J | 自动调用 `get-jit-pem.ts` |
| 开发者主动申请 | `tsx .pi/scripts/get-jit-pem.ts 30 "purpose"` |
| CI 临时需要测试凭证 | 触发 workflow `race-ops-jit-pem.yml` |

## 架构概览

```
开发者 (本地)                GitHub Actions                  GitHub API
    │                              │                              │
    │ gh workflow run              │                              │
    ├─────────────────────────────→│                              │
    │                              │ App JWT (生产 PEM 签)         │
    │                              ├─────────────────────────────→│
    │                              │                              │
    │                              │ POST /app/private_keys       │
    │                              │ 创建新 key                    │
    │                              │←─────────────────────────────┤
    │                              │ {key_id, pem}                │
    │                              │                              │
    │ 接收 PEM (base64)            │ 写审计 issue                 │
    │←─────────────────────────────┤  (用 AUDIT_BOT_TOKEN)        │
    │                              │                              │
    │ 写入 /tmp/jit-xxx.pem        │                              │
    │ 设置 $PEM_PATH               │                              │
    │                              │ sleep 1800                   │
    │ 干活 (30 min 内)             │ ...                          │
    │                              │                              │
    │ 30 分钟后                    │ DELETE /app/private_keys/... │
    │ token 失效                   ├─────────────────────────────→│
    │                              │                              │
    ▼                              ▼                              ▼
```

## 工作流

### Step 1: 触发申请

**方式 A — `/dev` 入口自动触发**（推荐）

参见 `.pi/prompts/dev.md` 中的 `[J] 申请 JIT 临时 PEM` 选项。

**方式 B — 手动触发**

```bash
# 标准 30 分钟
tsx .pi/scripts/get-jit-pem.ts 30 "测试 PI Agent content-pr Skill"

# 快速验证 5 分钟
tsx .pi/scripts/get-jit-pem.ts 5 "快速 PEM 签名测试"

# 中等 15 分钟
tsx .pi/scripts/get-jit-pem.ts 15 "中间长度任务"
```

可选 duration: `5` / `15` / `30`（分钟）

### Step 2: 脚本行为

`get-jit-pem.ts` 自动完成：

1. 预检 `gh auth status`（开发者需已登录）
2. 调用 `gh workflow run` 触发 JIT workflow
3. 轮询等待 workflow 完成（最长 2 分钟）
4. 从 workflow 日志提取 PEM（base64 形式）
5. 解码并写入 `/tmp/race-ops-jit-{timestamp}.pem`（mode 600）
6. 写入 `/tmp/race-ops-jit-env.sh`（含 `PEM_PATH` / `PEM_EXPIRES_AT` / `JIT_KEY_ID`）

### Step 3: 使用 PEM

```bash
# source env 文件获取变量
source /tmp/race-ops-jit-env.sh

# 此时 $PEM_PATH 已设置
echo $PEM_PATH    # /tmp/race-ops-jit-2026-07-28T22-31.pem

# 验证 PEM 有效
APP_ID=$RACE_OPS_APP_ID bash .pi/scripts/get-app-token.sh

# 用 token 模拟 ops 流程
export GH_TOKEN=$(bash .pi/scripts/get-app-token.sh)
gh pr create --base main --head content/test-xxx --title "test"
```

### Step 4: 清理

JIT PEM 会在 30 分钟后**自动**吊销（无需用户操作）。本地清理：

```bash
# 手动清理（可选）
shred -u /tmp/race-ops-jit-*.pem
rm -f /tmp/race-ops-jit-env.sh
unset PEM_PATH JIT_KEY_ID JIT_RUN_ID
```

## 安全特性

| 维度 | 实现 |
|---|---|
| **JIT 时限** | Workflow `sleep 1800` 后主动 DELETE key（GitHub 端） |
| **PEM 隔离** | 生产 PEM 永不出 GitHub Org Secret；JIT PEM 写 `/tmp` 不入 git |
| **审计** | 每次申请创建 GitHub Issue（`jit-audit` label），含 IP、用途、Run ID |
| **并发控制** | `concurrency: jit-pem-{actor}` 防止同一成员同时持多 key |
| **全局上限** | workflow 检查 ≤ 25 keys；满了就报错让 Owner 清理 |
| **鉴权** | 触发者需 repo write 权限（`github.actor` 即真实身份） |
| **审批（可选）** | 配置 `environment: production` + required reviewers |

## 安全权衡

| 攻击场景 | 损害 | 缓解 |
|---|---|---|
| 开发者把 PEM 发给外部人 | 30 分钟内可推 content/* | 时限 + 限定 scope（仅 ffxiv-race-stats） |
| Actions 日志泄漏 PEM | log 公开 | 30 分钟 TTL + workflow read 权限控制 |
| 同一开发者疯狂申请 | DoS / key 耗尽 | `concurrency` 阻塞并发 + 25 key 全局上限 |
| Workflow 被中断未吊销 | key 永久存活 | 待 P1: 兜底 workflow 每小时扫描 30min+ 未吊销的 key |

## 文件清单

| 文件 | 状态 | 用途 |
|---|---|---|
| `.github/workflows/race-ops-jit-pem.yml` | 新增 | Actions workflow：签发 + 吊销 + 审计 |
| `.pi/scripts/get-jit-pem.ts` | 新增 | 本地脚本：触发 + 接收 + 解析 |
| `.pi/prompts/dev.md` | 修改 | `/dev` 入口新增 [J] 选项 |
| `.pi/skills/jit-pem/SKILL.md` | 新增 | 本文档 |

## 前置配置（Owner 操作）

实施前需手动完成：

```
1. 在 GitHub 创建 race-ops-auditor 账号
2. 邀请 race-ops-auditor 为 ffxiv-race-stats 仓库协作者
   - Role: Triage（足够写 issue）
3. 用 race-ops-auditor 账号生成 PAT
   - Scopes: repo (单 repo) 或 public_repo (公开 repo)
   - 存为 Org Secret: AUDIT_BOT_TOKEN
4. 确保以下 secrets 已存在（生产 PEM 已配置）:
   - RACE_OPS_APP_ID
   - RACE_OPS_PEM
   - AUDIT_BOT_TOKEN   ← 新增
```

## 紧急情况

**立即吊销某个 JIT PEM**：

1. 登录 GitHub → Settings → Developer settings → GitHub Apps → `race-ops-ops`
2. Private keys 列表 → 找到对应 Key ID → Delete
3. 可选：在对应审计 issue 加评论说明

**审计查询**：

```bash
# 列出所有 JIT 审计 issue
gh issue list --repo mmw-devs/ffxiv-race-stats --label jit-audit --state all

# 查某人的申请历史
gh issue list --repo mmw-devs/ffxiv-race-stats --label jit-audit --search "author:weunimix"
```

## 测试场景

实施后应验证：

- [ ] `/dev` 入口选 [J]，30 分钟内能用 `get-app-token.sh` 铸造 token
- [ ] 30 分钟后用同一 PEM 铸造 token → 失败
- [ ] 审计 issue 被 race-ops-auditor 创建
- [ ] 30 分钟后审计 issue 收到 "已自动吊销" 评论
- [ ] 同成员并发申请被 `concurrency` 阻塞
- [ ] App 已有 25 keys 时申请 → 报错
- [ ] 非 write 权限成员触发 → 失败

## 不适用场景

- ❌ **正式运营**（用 `.pi/scripts/get-app-token.sh` + 长期 PEM）
- ❌ **CI 长期凭证**（用 GitHub Actions secrets 直接注入）
- ❌ **跨仓库使用**（JIT key 与生产 PEM 等价，绑当前 App）
