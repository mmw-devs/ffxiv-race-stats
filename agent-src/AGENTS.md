# CLAUDE.md — MMW攻略组通用智能体

## Agent 身份

**MMW攻略组通用智能体**，服务于 MMW攻略组的日常运营与技术工作。赛事运营是本 Agent 的核心业务场景之一，但并非全部。

## 仓库职责

本仓库负责**运营全流程**：运营数据维护、运营 Agent 自动化、构建部署。

## 仓库结构

```
public/data.json                ← 唯一高频改动文件
public/scripts/                 ← 运行时公共脚本
public/inspect-*.html           ← Agent 调试用
dist/                           ← 由 dev CI 推送的预构建产物
schema/                         ← 数据契约（与 dev 同步）
scripts/                        ← 验证脚本（与 dev 同步）
.github/workflows/              ← 2 个 workflow（validate / race-ops-jit-pem）
.pi/                            ← 运营 Agent 配置
.githooks/                      ← 运营工作流
constants.js                    ← 数据校验白名单（单一真相来源）
AGENTS.md (本文件)              ← 运营语境文档
README.md                       ← 运营 README
LICENSE
```

## 相关仓库

- **dev 仓库**：`mmw-devs/ffxiv-race-stats`（应用源码 + 构建 dev CI）
  - dev main push → dev CI 构建 → 推送 `dist/` 到本仓库 main
  - 本仓库的 dist/ 来自 dev，不在本仓库构建

## 数据修改流程

```
1. 运营人员通过飞书发送指令
2. 运营 Agent (.pi/) 接收并解析
3. Agent 调用 .pi/skills/* 工具（update-team / add-news / add-broadcaster）
4. Agent 通过 gh cli 创建 content/* 分支并修改 public/data.json
5. PR 触发 .github/workflows/validate.yml 校验（schema + 文件范围 + 操作日志）
6. Review/合并 → main
7. CF Pages 自动部署
```

## 运营 Agent 约束

PI Agent 在本仓库启动时进入**运营模式**，约束：

- **唯一允许修改**：`public/data.json`
- **提交通道**：`content/*` 分支 + PR（绝不可直推 main）
- **凭证**：`race-ops-bot` GitHub App（生产 PEM）或开发者本人 PAT（开发测试）

详见 `.pi/SKILL.md`。

## 数据校验

CI 在 PR 时跑三阶段校验（`scripts/validate-data.js`）：

- **Schema 结构**：对照 `schema/*.json` 用 Ajv 校验
- **值域交叉**：`phase` ∈ `PHASE_ORDER`、`region` ∈ `VALID_REGIONS` 等
- **业务规则**：`rank` 连续无跳号、`bossHP` ∈ [0, 100]、每队 `players[]` 恰好 8 人

## 部署流程

```
Dev Repo (push src/)
   ↓
Dev CI (npm ci && npm run build) → 产出 dist/
   ↓
Dev CI 推送 dist/ 到本仓库 main（用 OPS_PUSH_TOKEN）
   ↓
CF Pages 监听本仓库 main
   ↓
CF 跑 Build command: cp public/data.json dist/data.json
   ↓
CF publish dist/ 到 CDN
```

## 文档操作规范

创建文档时，**默认使用 `lark-cli` 在飞书云文档中进行**，而非本地文件：

1. 使用 `lark-cli docs +create --title "文档标题"` 创建飞书文档
2. 使用 `lark-cli docs +update --doc <doc-id> --command append --content @file.md --doc-format markdown` 写入内容
3. 仅在本地需要临时文件时，才写入 `docs/` 目录（如用于 lark-cli 读取）

> 飞书文档 URL 格式：`https://mmw-ffxiv.feishu.cn/docx/<document_id>`

## 注释语言

中文。
