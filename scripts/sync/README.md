# scripts/sync — GitHub Issue/PR → 飞书多维表格 同步脚本

## 用途

把 GitHub repo `mmw-devs/ffxiv-race-stats` 的 PR/Issue 同步到飞书多维表格（base `UjbNb2GZlaAujvsyIgKcuWq5n4b`）。

## 同步生命周期

```
Observe → Acquire → Reflect → Diff → Plan → Apply → Verify → Audit
```

每个环节单一职责，组合成一个完整的同步生命周期。

## 当前状态

- **阶段 0 骨架** (commit b647bc1)：参数解析 + hello world
- **阶段 1 端口** (commit d5df6c8)：domain types + port interfaces + errors
- **阶段 2 适配器** (commit 476522c)：gh-cli / lark-cli-feishu / audit-stdout
- **阶段 3 生命周期** (commit 53a2448)：field-mapping + 8 步 lifecycle + wiring
- **阶段 4 测试** (本 commit)：31 tests pass (unit + integration)
- 阶段 5-6 待办

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
├── vitest.config.ts
├── src/
│   ├── index.ts          # CLI 入口
│   ├── cli.ts            # 参数解析
│   ├── field-mapping.ts  # GitHub → Feishu 字段映射
│   ├── errors.ts         # 错误类型
│   ├── domain/           # 阶段 1: 领域类型 + zod schemas
│   │   ├── types.ts
│   │   └── schemas.ts
│   ├── ports/            # 阶段 1: 接口边界
│   │   ├── github-source.ts
│   │   ├── feishu-target.ts
│   │   └── audit-log.ts
│   ├── adapters/         # 阶段 2: 端口实现 (子进程 spawn)
│   │   ├── gh-cli.ts
│   │   ├── lark-cli-feishu.ts
│   │   └── audit-stdout.ts
│   ├── usecases/         # 阶段 3: 8 步生命周期
│   │   ├── acquire.ts
│   │   ├── reflect.ts
│   │   ├── diff.ts
│   │   ├── plan.ts
│   │   ├── apply.ts
│   │   ├── verify.ts
│   │   └── audit.ts
│   └── lifecycle.ts      # 阶段 3: 编排
├── tests/
│   ├── fixtures/         # JSON fixture
│   ├── helpers/          # 测试工具
│   ├── unit/             # 纯函数测试
│   └── integration/      # 注入 mock 端口跳 lifecycle
└── scripts/run.sh
```

## 测试

```bash
npm test              # 一次跑所有 31 个测试
npm run test:watch    # 监听模式
```

带详细输出:
```bash
cd scripts/sync && npx vitest run --reporter=verbose
```

测试覆盖:
- 13 unit tests (field-mapping)
- 6 unit tests (diff)
- 5 unit tests (plan)
- 7 integration tests (lifecycle, 注入 fake 端口)
