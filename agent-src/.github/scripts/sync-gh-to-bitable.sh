#!/bin/bash
# sync-gh-to-bitable.sh — GitHub Issue/PR 同步到飞书多维表格
#
# === 分层架构 ===
#
#   获取层: fetch_issue / fetch_pr          → gh CLI 拉取，输出 JSON
#   写入层: write_issue / write_pr          → 接收字段 → 写入 Bitable
#          find_by_github_id               → 去重查询
#   编排层: sync_issue / sync_pr / sync_batch → 串起获取+写入
#
# === 两种使用方式 ===
#
# 1. CLI 直接执行（GitHub Actions 用）:
#    sync-gh-to-bitable.sh issue <number>
#    sync-gh-to-bitable.sh pr <number>
#    sync-gh-to-bitable.sh --json issue <number>
#
# 2. 被 source 导入（Agent 用）:
#    source sync-gh-to-bitable.sh
#
#    # 端到端（同 CLI）
#    sync_issue 68
#    sync_batch issue 67 68 69
#
#    # 分层调用（Agent 介入分析/修改）
#    data=$(fetch_issue 68)
#    write_issue "$data"
#
# === 环境变量 ===
#   FEISHU_BITABLE_TOKEN, FEISHU_ISSUE_TABLE_ID, FEISHU_PR_TABLE_ID
#   （lark-cli 鉴权通过 profile 管理，见 workflow 中的 Configure lark-cli 步骤）

# ─── source 守卫 ────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
else
  set -uo pipefail  # source 下不用 -e，由调用方控制
fi

BASE_TOKEN="${FEISHU_BITABLE_TOKEN:-}"
ISSUE_TABLE="${FEISHU_ISSUE_TABLE_ID:-}"
PR_TABLE="${FEISHU_PR_TABLE_ID:-}"

# lark-cli 路径
LARK_CLI=".pi/npm/node_modules/@larksuite/cli/bin/lark-cli"
[ -x "$LARK_CLI" ] || LARK_CLI="./node_modules/.bin/lark-cli"

# ─── 工具函数 ────────────────────────────────

log() { echo "$@" >&2; }

fmt_date() { echo "$1" | sed 's/T/ /; s/Z$//' | cut -c1-19; }

# ─── 去重查询（写入层） ──────────────────────

find_by_github_id() {
  local table_id="$1" github_id="$2"
  local result
  if result=$($LARK_CLI base +record-list \
    --base-token "$BASE_TOKEN" --table-id "$table_id" \
    --filter-json "{\"logic\":\"and\",\"conditions\":[[\"GitHub ID\",\"==\",\"$github_id\"]]}" \
    --format json --as bot 2>&1); then
    echo "$result" | jq -r '.data.record_id_list[0] // ""'
  else
    log "[lark-cli 查询失败，当作新记录处理]"
    echo ""
  fi
}

# ═══════════════════════════════════════════════
#  获取层: 从 GitHub 拉取数据，stdout 输出 JSON
# ═══════════════════════════════════════════════

fetch_issue() {
  local number="$1"
  gh issue view "$number" --json number,title,state,labels,assignees,createdAt,updatedAt,url,id
}

fetch_pr() {
  local number="$1"
  gh pr view "$number" --json number,title,state,labels,assignees,author,headRefName,baseRefName,createdAt,updatedAt,url,id,mergedAt
}

# ═══════════════════════════════════════════════
#  写入层: 接收获取层的 JSON，写入 Bitable
# ═══════════════════════════════════════════════

write_issue() {
  local data="$1"

  local id title num state assignees labels created updated url existing
  id=$(echo "$data"   | jq -r '.id')
  title=$(echo "$data" | jq -r '.title')
  num=$(echo "$data"   | jq -r '.number')
  state=$(echo "$data" | jq -r '.state' | tr '[:upper:]' '[:lower:]')
  assignees=$(echo "$data" | jq -r '[.assignees[].login] | join(", ")')
  labels="null"
  created=$(fmt_date "$(echo "$data" | jq -r '.createdAt')")
  updated=$(fmt_date "$(echo "$data" | jq -r '.updatedAt')")
  url=$(echo "$data"     | jq -r '.url')

  existing=$(find_by_github_id "$ISSUE_TABLE" "$id")

  if [ -n "$existing" ]; then
    log "  更新 record_id=$existing"
    $LARK_CLI base +record-upsert \
      --base-token "$BASE_TOKEN" --table-id "$ISSUE_TABLE" --record-id "$existing" \
      --json "{\"标题\":$(echo "$title" | jq -R .),\"编号\":$num,\"状态\":$(echo "$state" | jq -R .),\"负责人\":$(echo "$assignees" | jq -R .),\"标签\":$labels,\"更新时间\":$(echo "$updated" | jq -R .),\"URL\":$(echo "$url" | jq -R .)}" \
      --as bot --format json >/dev/null 2>&1 || { log "  ✗ 更新失败"; return 1; }
    echo "updated"
  else
    log "  创建新记录"
    $LARK_CLI base +record-batch-create \
      --base-token "$BASE_TOKEN" --table-id "$ISSUE_TABLE" \
      --json "{\"fields\":[\"标题\",\"编号\",\"状态\",\"负责人\",\"标签\",\"创建时间\",\"更新时间\",\"URL\",\"GitHub ID\"],\"rows\":[[$(echo "$title" | jq -R .),$num,$(echo "$state" | jq -R .),$(echo "$assignees" | jq -R .),$labels,$(echo "$created" | jq -R .),$(echo "$updated" | jq -R .),$(echo "$url" | jq -R .),$(echo "$id" | jq -R .)]]}" \
      --as bot --format json >/dev/null 2>&1 || { log "  ✗ 创建失败"; return 1; }
    echo "created"
  fi
}

write_pr() {
  local data="$1"

  local id title num state author assignees labels head_ref base_ref created updated url existing merged
  id=$(echo "$data"       | jq -r '.id')
  title=$(echo "$data"     | jq -r '.title')
  num=$(echo "$data"       | jq -r '.number')
  merged=$(echo "$data"    | jq -r '.mergedAt // empty')
  if [ -n "$merged" ]; then
    state="merged"
  else
    state=$(echo "$data"   | jq -r '.state' | tr '[:upper:]' '[:lower:]')
  fi
  author=$(echo "$data"    | jq -r '.author.login')
  assignees=$(echo "$data" | jq -r '[.assignees[].login] | join(", ")')
  labels="null"
  head_ref=$(echo "$data"  | jq -r '.headRefName')
  base_ref=$(echo "$data"  | jq -r '.baseRefName')
  created=$(fmt_date "$(echo "$data" | jq -r '.createdAt')")
  updated=$(fmt_date "$(echo "$data" | jq -r '.updatedAt')")
  url=$(echo "$data"       | jq -r '.url')

  existing=$(find_by_github_id "$PR_TABLE" "$id")

  if [ -n "$existing" ]; then
    log "  更新 record_id=$existing"
    $LARK_CLI base +record-upsert \
      --base-token "$BASE_TOKEN" --table-id "$PR_TABLE" --record-id "$existing" \
      --json "{\"标题\":$(echo "$title" | jq -R .),\"编号\":$num,\"状态\":$(echo "$state" | jq -R .),\"作者\":$(echo "$author" | jq -R .),\"负责人\":$(echo "$assignees" | jq -R .),\"标签\":$labels,\"源分支\":$(echo "$head_ref" | jq -R .),\"目标分支\":$(echo "$base_ref" | jq -R .),\"更新时间\":$(echo "$updated" | jq -R .),\"URL\":$(echo "$url" | jq -R .)}" \
      --as bot --format json >/dev/null 2>&1 || { log "  ✗ 更新失败"; return 1; }
    echo "updated"
  else
    log "  创建新记录"
    $LARK_CLI base +record-batch-create \
      --base-token "$BASE_TOKEN" --table-id "$PR_TABLE" \
      --json "{\"fields\":[\"标题\",\"编号\",\"状态\",\"作者\",\"负责人\",\"标签\",\"源分支\",\"目标分支\",\"创建时间\",\"更新时间\",\"URL\",\"GitHub ID\"],\"rows\":[[$(echo "$title" | jq -R .),$num,$(echo "$state" | jq -R .),$(echo "$author" | jq -R .),$(echo "$assignees" | jq -R .),$labels,$(echo "$head_ref" | jq -R .),$(echo "$base_ref" | jq -R .),$(echo "$created" | jq -R .),$(echo "$updated" | jq -R .),$(echo "$url" | jq -R .),$(echo "$id" | jq -R .)]]}" \
      --as bot --format json >/dev/null 2>&1 || { log "  ✗ 创建失败"; return 1; }
    echo "created"
  fi
}

# ═══════════════════════════════════════════════
#  编排层: 串起获取+写入（GitHub Actions 用）
# ═══════════════════════════════════════════════

sync_issue() {
  local number="$1"
  log "→ 同步 Issue #$number"

  local data
  data=$(fetch_issue "$number") || { log "  ✗ gh 拉取失败"; return 1; }

  local action
  action=$(write_issue "$data") || return 1

  log "  ✓ 完成 ($action)"
  return 0
}

sync_pr() {
  local number="$1"
  log "→ 同步 PR #$number"

  local data
  data=$(fetch_pr "$number") || { log "  ✗ gh 拉取失败"; return 1; }

  local action
  action=$(write_pr "$data") || return 1

  log "  ✓ 完成 ($action)"
  return 0
}

sync_batch() {
  local type="$1"; shift
  local total=0 ok=0 fail=0
  local sync_fn

  case "$type" in
    issue) sync_fn="sync_issue" ;;
    pr)    sync_fn="sync_pr" ;;
    *)     log "用法: sync_batch issue|pr <numbers...>"; return 1 ;;
  esac

  log "═══ 批量同步 $type 开始（共 $# 条）═══"

  for num in "$@"; do
    total=$((total + 1))
    if $sync_fn "$num"; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
  done

  log "═══ 批量完成: $type × $total, 成功 $ok, 失败 $fail ═══"
  printf '{"summary":{"type":"%s","total":%d,"ok":%d,"fail":%d}}\n' "$type" "$total" "$ok" "$fail"

  [ "$fail" -eq 0 ] && return 0 || return 1
}

# ═══════════════════════════════════════════════
#  CLI 入口（仅直接执行时生效）
# ═══════════════════════════════════════════════

if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0  # 被 source 导入，到这里为止
fi

# 环境变量校验（CLI 模式强制要求）
: "${FEISHU_BITABLE_TOKEN:?未设置 FEISHU_BITABLE_TOKEN}"
: "${FEISHU_ISSUE_TABLE_ID:?未设置 FEISHU_ISSUE_TABLE_ID}"
: "${FEISHU_PR_TABLE_ID:?未设置 FEISHU_PR_TABLE_ID}"

case "${1:-}" in
  issue)  sync_issue "${2:?缺少 Issue 编号}" ;;
  pr)     sync_pr "${2:?缺少 PR 编号}" ;;
  batch)  shift; sync_batch "$@" ;;
  *)
    echo "用法: $0 issue <number> | pr <number> | batch issue|pr <numbers...>"
    echo ""
    echo "  被 source 导入后可分层调用:"
    echo "    source $0"
    echo "    data=\$(fetch_issue 68)    # 获取层"
    echo "    write_issue \"\$data\"       # 写入层"
    echo "    sync_issue 68              # 编排层"
    exit 1
    ;;
esac
