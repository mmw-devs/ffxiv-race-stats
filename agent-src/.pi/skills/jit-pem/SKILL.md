---
name: jit-pem
description: >
  JIT Installation Token 申请流程。开发者本地无 PEM 时，可申请 1 小时有效的
  installation token 用于功能测试。审计 issue 由开发者本人创建（用其 gh 身份），
  仓库管理员统一 review 所有 jit-audit issues。
  触发词：JIT、临时凭证、申请 token、jit-pem。
---

# jit-pem

## 概述

为开发者提供**自助申请** 1 小时有效 installation token 的流程，用于功能测试。

- **自助**：开发者无需联系 Owner，触发 workflow 即可
- **有时限**：GitHub 原生 1 小时 TTL，API 强制无法缩短
- **简单**：仅依赖开发者已有 `gh` 鉴权，零额外 secrets
- **可审计**：开发者本人创建 audit issue，Admin 统一 review

## 为什么是 installation token 而不是 PEM

最初设计是"创建新 PEM key → 10 min 后 DELETE"。但 GitHub API 实际**不支持**：

| 设计 | API 限制 |
|---|---|
| `POST /app/private_keys` 创建新 PEM key | **404 Not Found**（GitHub 已知 issue）|
| 设置 installation token 短 TTL | `expires_at` 参数被忽略，**强制 1 小时** |

因此改为铸造 installation token：
- 1 小时原生 TTL（无法更短）
- 权限与 App 一致（`contents:write`, `pull_requests:write`）
- 开发者用 `GH_TOKEN` 环境变量使用

## 触发场景

| 场景 | 触发方式 |
|---|---|
| `/dev` 入口检测到本地无 PEM + 用户选 J | 自动调用 `get-jit-pem.ts` |
| 开发者主动申请 | `tsx .pi/scripts/get-jit-pem.ts "purpose"` |

## 架构概览

```
开发者 (本地)              GitHub Actions              GitHub API
    │                            │                          │
    │ gh workflow run            │                          │
    ├───────────────────────────→│                          │
    │                            │ App JWT (生产 PEM 签)     │
    │                            ├─────────────────────────→│
    │                            │                          │
    │                            │ POST /installations/...  │
    │                            │ /access_tokens            │
    │                            │←─────────────────────────┤
    │                            │ {token, expires_at}      │
    │                            │                          │
    │ 等待完成                    │ 上传 artifact            │
    │                            │ (jit-token)              │
    │                            │                          │
    │ 下载 artifact               │                          │
    │←───────────────────────────┤                          │
    │                            │                          │
    │ 解析 token                  │                          │
    │ 写入 /tmp/race-ops-jit-env.sh                          │
    │                            │                          │
    │ 用开发者身份创建审计 issue   │                          │
    │ (label: jit-audit)         │                          │
    │                            │                          │
    │ 用 token 干活 1 小时        │                          │
    │ (GH_TOKEN=<installation>)   │                          │
    ├────────────────────────────────────────────────────→  │
    │                            │                          │
    │ 1 小时后 token 自动失效     │                          │
    ▼                            ▼                          ▼
```

## 工作流

### Step 1: 触发申请

**方式 A — `/dev` 入口自动触发**（推荐）

参见 `.pi/prompts/dev.md` 中的 `[J] 申请 JIT Installation Token` 选项。

**方式 B — 手动触发**

```bash
tsx .pi/scripts/get-jit-pem.ts "测试 PI Agent content-pr Skill"
```

### Step 2: 脚本行为

`get-jit-pem.ts` 自动完成：

1. 预检 `gh auth status`（开发者需已登录）
2. 自动检测当前 git 分支，触发对应 ref 的 workflow（失败则回退 main）
3. 轮询等待 workflow 完成（最长 2 分钟）
4. 下载 `jit-token` artifact
5. 解析 token 写入 `/tmp/race-ops-jit-env.sh`
6. **用开发者身份创建审计 issue**（`jit-audit` label）

### Step 3: 使用 Token

```bash
# source env 文件
source /tmp/race-ops-jit-env.sh

# 此时 $GH_TOKEN 已设置
echo $GH_TOKEN | cut -c1-20   # ghs_xxxxxxxxxx...

# 验证身份（应该是 race-ops-bot）
gh auth status

# 模拟 ops 推 content/*
gh pr create --base main --head content/test-xxx --title "test"
gh pr list
```

### Step 4: 清理

Token 会在 1 小时后**自动**失效：

```bash
unset GH_TOKEN
rm -f /tmp/race-ops-jit-env.sh /tmp/race-ops-jit-download
```

## 审计机制

### 谁创建 issue

- **开发者本人**（用其个人 `gh` 鉴权创建）
- 优点：无需额外 `AUDIT_BOT_TOKEN` secret
- 优点：天然透明（"我申请了"有据可查）

### 谁审查 issue

- **仓库管理员**（`@weunimix` 等有 admin 权限者）
- 通过查看所有 `jit-audit` label 的 issues 即可

```bash
# 列出所有 JIT 申请
gh issue list --repo mmw-devs/ffxiv-race-ops --label jit-audit --state all

# 查某人的申请历史
gh issue list --repo mmw-devs/ffxiv-race-ops --label jit-audit --search "@username"
```

### issue 包含的信息

- 申请时间、持有者、到期时间
- 用途（开发者输入）
- Run ID + Run URL
- 撤销方式说明

## 安全特性

| 维度 | 实现 |
|---|---|
| **凭证隔离** | 生产 PEM 永不出 GitHub Org Secret；开发者拿到的是 1h 派生 token |
| **审计** | 每次申请产生一个公开 issue，Admin 可见 |
| **并发控制** | `concurrency: jit-pem-{actor}` 防止同一成员同时持多 token |
| **自动失效** | 1 小时后 GitHub 端 token 失效 |
| **撤销方式** | 通知 Owner 手动 rotate App keys（紧急） |
| **Issue 防伪** | Issue 由开发者本人创建，作者身份天然可信 |

## 安全权衡

| 攻击场景 | 损害 | 缓解 |
|---|---|---|
| 开发者把 token 发给外部人 | 1 小时内可推 content/* | 时限 + 限定 scope |
| Actions 日志泄漏 token | 日志被 mask，artifact 仅开发者可下载 | token 不出现在日志明文 |
| 同一开发者疯狂申请 | DoS / 配额消耗 | `concurrency` 阻塞并发 |
| 开发者删除自己的审计 issue | 失去审计记录 | Admin 可设置 webhook 监听删除事件（待 P1）|

## 文件清单

| 文件 | 状态 | 用途 |
|---|---|---|
| `.github/workflows/race-ops-jit-pem.yml` | 新增 | Actions workflow：铸 JWT + 铸造 token + 上传 artifact |
| `.pi/scripts/get-jit-pem.ts` | 新增 | 本地脚本：触发 + 下载 + 写 env + 创建审计 issue |
| `.pi/prompts/dev.md` | 修改 | `/dev` 入口新增 [J] 选项 |
| `.pi/skills/jit-pem/SKILL.md` | 新增 | 本文档 |

## 必需的 Secrets（已配置）

```
RACE_OPS_APP_ID            = 4214545
RACE_OPS_PEM               = (生产 PEM 内容)
RACE_OPS_INSTALLATION_ID   = 144348445
```

**不需要** `AUDIT_BOT_TOKEN`（审计 issue 由开发者本人创建）。

## 紧急情况

**立即撤销某个 token**：

由于 installation token 无法提前撤销，1 小时内仍有效。如需立即失效：
- 通知 Owner 在 `race-ops-bot` App 设置页 rotate keys
- 这会让**所有**该 App 的 tokens 失效，影响其他正常 ops

**审计查询**：

```bash
gh issue list --repo mmw-devs/ffxiv-race-ops --label jit-audit --state all
```

## 测试场景

实施后应验证：
- [x] `/dev` 入口选 [J]，1 小时内能用 token 跑 `gh pr list`
- [x] token 能成功推 `content/*` 分支
- [x] 审计 issue 被开发者本人创建，含 `jit-audit` label
- [x] 1 小时后 token 失效（仅理论验证，未实际等待 1 小时）
- [x] 同成员并发申请被 `concurrency` 阻塞
- [x] 非 write 权限成员触发 → 失败

## 不适用场景

- ❌ **正式运营**（用 `.pi/scripts/get-app-token.sh` + 长期 PEM）
- ❌ **CI 长期凭证**（用 GitHub Actions secrets 直接注入）
- ❌ **跨仓库使用**（token 绑当前 App）
- ❌ **短于 1 小时的 TTL**（GitHub API 限制）
