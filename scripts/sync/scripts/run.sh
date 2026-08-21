#!/usr/bin/env bash
# scripts/sync 启动脚本 — 用 tsx 跑 TS 源码
#
# 用法:
#   ./scripts/sync/scripts/run.sh pr 70              # 同步 PR #70
#   ./scripts/sync/scripts/run.sh issue 42           # 同步 Issue #42
#   ./scripts/sync/scripts/run.sh all                # 全量回填
#   ./scripts/sync/scripts/run.sh pr 70 --dry-run    # 演练不写
#
# 环境变量:
#   LARK_PROFILE     — lark-cli profile 名 (默认 ci-bot)
#   LARK_BASE_TOKEN  — 飞书多维表格 base token
#   LARK_PR_TABLE_ID — PR 表 ID
#   LARK_ISSUE_TABLE_ID — Issue 表 ID
#   GH_TOKEN         — GitHub token (gh CLI 用)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_DIR="$(cd "$HERE/.." && pwd)"

# 默认 profile 是 CI 用的 ci-bot; 本地可 override
export LARK_PROFILE="${LARK_PROFILE:-ci-bot}"

# 校验必需变量
: "${LARK_BASE_TOKEN:?未设置 LARK_BASE_TOKEN}"
: "${LARK_PR_TABLE_ID:?未设置 LARK_PR_TABLE_ID}"
: "${LARK_ISSUE_TABLE_ID:?未设置 LARK_ISSUE_TABLE_ID}"

exec npx tsx "$SYNC_DIR/src/index.ts" "$@"
