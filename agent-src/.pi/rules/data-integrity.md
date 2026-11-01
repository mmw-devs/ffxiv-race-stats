---
description: >
  数据写入前后的完整性要求。本文件不复述字段规则，只规定写入流程与单一来源。
---
# 数据完整性规则

## 唯一规则来源

以下文件是数据规则的唯一来源，本文件与任何 skill 都不得复述或改写：

- `schema/*.json` — 结构、必填、值域
- `scripts/validate-data.ts` — 跨字段与业务规则
- `shared/stage.mjs` — 阶段 `P<n>` / `CLEAR` 语法与排序

如果本文件、`commands.md` 或 skill 与上述来源冲突，以代码为准，并修正文档。

## 写入流程

1. 读取当前 `public/data.json`
2. 只修改目标字段，保留其他字段与 JSON 结构
3. 运行 `npm run validate`
4. 通过 `ops-submit` 提交；不得直推 main
5. 审计由当前运行环境提供（通过 `ops-submit` 适配器），不得手工构造或修改其格式

校验不通过时修复后重跑，不通过不提交。

## 时区约定

- **存储**：`meta.startTime`、`news[].time` 一律为 UTC 的 ISO 8601 瞬时（`Z` 结尾）
- **运营交互**：展示与确认使用北京时间（UTC+8）；运营给出的时间默认按北京时间理解
- **换算**：写入时 UTC = 北京时间 − 8 小时；由 Agent 内部完成

## CI 失败处理

1. 读取 CI 错误日志
2. 定位是结构、值域还是业务规则问题
3. 修复 `public/data.json`
4. push 到同一 `content/*` 分支，PR 自动更新
5. 重新请求运营确认

## 禁止

- 在文档或 skill 里复制字段清单、长度限制、排序规则
- 修改 `schema/`、`scripts/`、`shared/stage.mjs` 来迁就某次操作
- 绕过 `ops-submit` 直接提交
