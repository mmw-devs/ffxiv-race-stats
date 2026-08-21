# scripts/sync — GitHub Issue/PR → 飞书多维表格 同步脚本

## 用途

把 GitHub repo `mmw-devs/ffxiv-race-stats` 的 PR/Issue 同步到飞书多维表格（base `UjbNb2GZlaAujvsyIgKcuWq5n4b`）。

## 同步生命周期

```
Observe → Acquire → Reflect → Diff → Plan → Apply → Verify → Audit
```

每个环节单一职责，组合成一个完整的同步生命周期。

## 当前状态

- **阶段 0 骨架**（本 commit）：参数解析 + hello world
- 阶段 1-6 后续实现

## 调用

```bash
# 同步 PR #70
./scripts/sync/scripts/run.sh pr 70

# 同步 Issue #42
./scripts/sync/scripts/run.sh issue 42

# 全量回填
./scripts/sync/scripts/run.sh all

# 演练不写
./scripts/sync/scripts/run.sh pr 70 --dry-run
```

## 环境变量

| 变量 | 用途 |
|---|---|
| `LARK_PROFILE` | lark-cli profile 名（默认 `ci-bot`） |
| `LARK_BASE_TOKEN` | 飞书多维表格 base token |
| `LARK_PR_TABLE_ID` | PR 表 ID |
| `LARK_ISSUE_TABLE_ID` | Issue 表 ID |

## 依赖

- `@larksuite/cli` 1.0.72（CI 锁版本）
- `tsx` 4.23.x（TS 运行）
- `vitest` 4.1.x（测试）
- `zod` 4.4.x（schema 校验）

## 安全约束（P0 决策）

- ❌ 不引入 `execa` / `nock` / `chai`（用 Node 内置）
- ✅ 子进程调用一律 `spawn` + argv 数组
- ✅ 审计日志 redact 凭据字段
- ✅ `lark-cli` 锁精确版本（package.json）

## 架构

```
scripts/sync/
├── tsconfig.json
├── src/
│   ├── index.ts          # CLI 入口
│   ├── cli.ts            # 参数解析
│   ├── domain/           # 阶段 1
│   ├── ports/            # 阶段 1
│   ├── adapters/         # 阶段 2
│   ├── usecases/         # 阶段 3
│   └── lifecycle.ts      # 阶段 3
├── tests/                # 阶段 4
└── scripts/run.sh
```
