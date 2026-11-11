# AGENTS.md — MMW攻略组通用智能体

> 本文同步到 ops 仓库根目录；在 dev 仓库中它是源模板。
> 文中“本仓库”指 ops（`mmw-devs/ffxiv-race-ops`）；dev 不保存 `public/data.json`，`dist/` 由 dev CI 生成。
> 结构性文件只在 dev 的 `agent-src/` 修改；本仓库只额外保存 `public/data.json` 与 `dist/`。
> 文档边界：业务指令见 `COMMANDS.md`（由 `contract/operations.json` 生成），数据规则见 `schema/*.json` 与 `scripts/validate-data.ts`；本文只保留入口、边界与主流程。

## Agent 身份

**MMW攻略组通用智能体**，服务日常运营与技术工作。赛事运营是核心业务场景之一，并非全部。

## 仓库职责与结构

本仓库负责运营全流程：数据维护、运营 Agent 自动化、构建部署。

```
public/data.json          ← 唯一高频改动文件
schema/ scripts/          ← 数据契约与验证脚本（与 dev 同步）
dist/                     ← dev CI 推送的预构建产物
.github/workflows/        ← validate / race-ops-jit-pem
.pi/                      ← 运营 Agent 配置与 skills
COMMANDS.md               ← 运营指令目录（生成物，勿手改）
AGENTS.md README.md       ← 运营语境文档
```

## 相关仓库

- **dev**：`mmw-devs/ffxiv-race-stats`（源码 + 构建 CI）；push 后构建 `dist/` 推送到本仓库 main。

## 指令级别（摘要）

完整表与前置条件见 `COMMANDS.md`；级别以契约 `contract/operations.json` 为准，Agent 不得自行判断。

| 级别 | 含义 | 合并 |
|---|---|---|
| L1 | 只读 | 无 |
| L2 | 常规写 | 确认后由运行环境合并；无能力则人工 |
| L3 | 生命周期 | 只能人工在 PR 平台合并 |

- L3 仅四条：新建赛事 / 换届、预热上线、开赛（兜底）、结束赛事；其他写操作一律 L2。

## 运行环境

业务 skill 与 `COMMANDS.md` 不绑定消息渠道或 Agent 运行时。

| 运行环境 | 提交适配器 |
|---|---|
| PI Agent + lark-bot（飞书） | `ops-submit-larkbot` |
| DeepSeek Harness + mmw-tools | `ops-submit-dsh` |

运行环境必须提供：稳定操作者身份、显式确认、审计、`content` PR、预览。

## 数据修改流程

1. 操作者通过当前渠道发指令（飞书、DeepSeek Harness 等）。
2. Agent（`.pi/`）按 `COMMANDS.md` 识别业务域，加载对应 skill。
3. 读 `public/data.json` → 校验 → 字段级预览 → 操作者确认。
4. 经 `ops-submit`（当前环境适配器）创建 `content/*` 分支并修改 `public/data.json`。
5. PR 触发 `validate.yml`（schema + 文件范围 + 操作日志）。
6. L2 确认后合并（无能力则人工）；L3 只能人工在 PR 平台合并。
7. CF Pages 自动部署。

## 运营 Agent 约束

- **唯一允许修改**：`public/data.json`
- **提交通道**：`content/*` 分支 + PR（绝不直推 main），统一走 `ops-submit`
- **凭证**：lark-bot 用 `race-ops-bot` GitHub App 或开发者 PAT；DSH 用 mmw-tools 仓库授权

详见 `COMMANDS.md`、`.pi/skills/` 与 `.pi/rules/`。

## 数据校验

PR 时跑三阶段（`scripts/validate-data.ts`）：Schema 结构（Ajv）→ 值域交叉（`phase`/`region` 等）→ 业务规则（名次连续、血量、每队 8 人）。

## 部署流程

dev push → dev CI 构建 `dist/` → 推送到本仓库 main → CF Pages 执行 `cp public/data.json dist/data.json` → 发布。

## 文档操作规范

仅 lark-bot / 飞书环境适用；其他环境按宿主能力选择工具。默认用 `lark-cli` 创建飞书云文档（而非本地文件），创建后向所有人开放编辑。

## 注释语言

中文。
