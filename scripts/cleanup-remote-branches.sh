#!/usr/bin/env bash
# scripts/cleanup-remote-branches.sh
# 清理已合并 / 已关闭 / 无对应 PR 的开发工作残留远程分支
#
# 用法：
#   ./scripts/cleanup-remote-branches.sh           # 实际删除
#   ./scripts/cleanup-remote-branches.sh --dry-run # 仅预览
#
# 前提：
#   - 远程名 origin
#   - gh CLI 已认证（PR 状态查询备用；实际删除不依赖 gh）
#
# 行为：
#   - 保留 main、5 个 dependabot OPEN PR 分支、feature/scaffold-sync-script
#   - 其余远程分支全部删除（git push origin --delete）
#   - 删除前打印清单 + 要求输入 YES 二次确认

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

# 保留白名单（远程分支，去掉 origin/ 前缀）
REMOTE_KEEP=(
  "main"
  "dependabot/npm_and_yarn/typescript-7.0.2"
  "dependabot/npm_and_yarn/zod-4.5.4"
  "dependabot/npm_and_yarn/dependency-cruiser-18.2.0"
  "dependabot/npm_and_yarn/tsx-4.23.13"
  "dependabot/npm_and_yarn/types/node-26.4.1"
  "feature/scaffold-sync-script"
)

# 验证白名单分支均存在
for keep in "${REMOTE_KEEP[@]}"; do
  if ! git rev-parse --verify "origin/${keep}" >/dev/null 2>&1; then
    echo "❌ 保留分支不存在: origin/${keep}" >&2
    exit 1
  fi
done

# 收集要删除的远程分支
remote_branches=$(git for-each-ref --format='%(refname:short)' refs/remotes/origin/ \
  | grep -v '^origin/HEAD$' \
  | grep -v '^origin/main$' \
  | sed 's|^origin/||' \
  | sort)

to_delete=()
for rb in $remote_branches; do
  skip=false
  for keep in "${REMOTE_KEEP[@]}"; do
    if [ "$rb" = "$keep" ]; then
      skip=true
      break
    fi
  done
  if [ "$skip" = false ]; then
    to_delete+=("$rb")
  fi
done

echo "===保留分支 (${#REMOTE_KEEP[@]} 个)==="
for keep in "${REMOTE_KEEP[@]}"; do
  echo "  origin/${keep}"
done

echo ""
echo "===待删除远程分支 (${#to_delete[@]} 个)==="
for rb in "${to_delete[@]}"; do
  echo "  origin/${rb}"
done

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "===DRY RUN：未执行删除==="
  exit 0
fi

echo ""
echo "===确认执行？输入 YES 开始删除（其他任意输入取消）==="
read -r answer
if [ "$answer" != "YES" ]; then
  echo "❌ 取消执行"
  exit 1
fi

# 实际删除
success=0
failed=0
for rb in "${to_delete[@]}"; do
  if git push origin --delete "$rb" >/dev/null 2>&1; then
    success=$((success + 1))
  else
    failed=$((failed + 1))
    echo "  ❌ 删除失败: origin/${rb}"
  fi
done

echo ""
echo "===完成==="
echo "  ✅ 成功: ${success}"
echo "  ❌ 失败: ${failed}"
echo "  📊 剩余远程分支数（不含 main）: $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/ | grep -v '^origin/HEAD$' | grep -v '^origin/main$' | wc -l)"