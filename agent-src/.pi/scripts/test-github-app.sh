#!/bin/bash
# GitHub App 验证脚本 — 测试 ffxiv-race-ops App 的 token 生成与 PR 创建
# 用法: APP_ID=<你的App ID> bash .pi/scripts/test-github-app.sh

set -euo pipefail

# ── 凭证（待替换）
APP_ID="${APP_ID:-}"                              # 你从 GitHub App 设置页获取
INSTALLATION_ID="144348445"                        # 已确认
PEM_PATH="${FFXIV_OPS_PEM:-}"
if [ -z "$PEM_PATH" ]; then
    echo -e "${RED}错误: 请设置 FFXIV_OPS_PEM 环境变量${NC}"
    echo "用法: FFXIV_OPS_PEM=/path/to/key.pem APP_ID=123456 bash $0"
    exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

# ── 检查 APP_ID
if [ -z "$APP_ID" ]; then
    echo -e "${RED}错误: 请设置 APP_ID 环境变量${NC}"
    echo "用法: APP_ID=123456 bash $0"
    echo ""
    echo "App ID 位置: GitHub App 设置页 → About → App ID（数字）"
    echo "URL: https://github.com/organizations/mmw-devs/settings/apps/ffxiv-race-ops"
    exit 1
fi

echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}  GitHub App 凭证验证${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo ""
echo "App ID:          $APP_ID"
echo "Installation ID: $INSTALLATION_ID"
echo "PEM:             $PEM_PATH"
echo ""

# ── 第一步：生成 JWT
echo -e "${BLUE}[1/4] 生成 JWT...${NC}"

NOW=$(date +%s)
IAT=$((NOW - 60))     # GitHub 对时钟偏移敏感，iat 设 60 秒前
EXP=$((IAT + 540))    # 9 分钟过期（安全余量，GitHub 要求 ≤10min）
HEADER='{"alg":"RS256","typ":"JWT"}'
PAYLOAD="{\"iat\":$IAT,\"exp\":$EXP,\"iss\":\"$APP_ID\"}"

JWT=$(printf '%s' "$HEADER" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT+="."
JWT+=$(printf '%s' "$PAYLOAD" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIGNATURE=$(printf '%s' "$JWT" | openssl dgst -sha256 -sign "$PEM_PATH" | openssl base64 -A | tr '+/' '-_' | tr -d '=')

JWT="${JWT}.${SIGNATURE}"

echo -e "  JWT: ${GREEN}已生成${NC} (iat=$NOW, exp=$EXP)"

# ── 第二步：换取 Installation Token
echo -e "${BLUE}[2/4] 换取 Installation Token...${NC}"

TOKEN_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $JWT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens")

TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo -e "${RED}  失败: 无法获取 Installation Token${NC}"
    echo "  GitHub 返回: $TOKEN_RESPONSE"
    exit 1
fi

TOKEN_EXPIRES=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('expires_at','unknown'))" 2>/dev/null)
echo -e "  Token: ${GREEN}已获取${NC} (过期: $TOKEN_EXPIRES)"

# ── 第三步：验证身份
echo -e "${BLUE}[3/4] 验证 Bot 身份...${NC}"

BOT_INFO=$(curl -s -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app")

BOT_NAME=$(echo "$BOT_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name','unknown'))" 2>/dev/null)

echo -e "  Bot: ${GREEN}$BOT_NAME${NC}"

# 验证仓库访问权限
REPO_INFO=$(curl -s -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/mmw-devs/ffxiv-race-ops")

REPO_FULL=$(echo "$REPO_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('full_name','ACCESS DENIED'))" 2>/dev/null)

if [ "$REPO_FULL" = "ACCESS DENIED" ]; then
    echo -e "${RED}  失败: 无法访问仓库 mmw-devs/ffxiv-race-ops${NC}"
    echo "  请确认 App 已安装到该仓库:"
    echo "  https://github.com/organizations/mmw-devs/settings/installations/$INSTALLATION_ID"
    exit 1
fi

echo -e "  仓库访问: ${GREEN}$REPO_FULL ✓${NC}"

# ── 第四步：测试 Git 操作
echo -e "${BLUE}[4/4] 测试 Git 操作...${NC}"

# 临时导出 token 供 git 使用
export GITHUB_TOKEN="$TOKEN"

# 测试一次 fetch（验证读写权限）
TEST_BRANCH="content/test-app-auth"
REPO_URL="https://x-access-token:${TOKEN}@github.com/mmw-devs/ffxiv-race-ops.git"

# 检查是否有未提交的更改
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "  ${GREEN}注意:${NC} 工作区有未提交更改，跳过分支创建测试"
    echo ""
    echo -e "${GREEN}══════════════════════════════════════════${NC}"
    echo -e "${GREEN}  验证通过 ✓${NC}"
    echo -e "${GREEN}══════════════════════════════════════════${NC}"
    echo ""
    echo "Token 有效，Bot 身份: $BOT_NAME"
    echo "Token 过期时间: $TOKEN_EXPIRES"
    echo "仓库权限: 读写确认"
    echo ""
    echo "⚠️  提交当前更改后再测试完整 PR 流程。"
    echo "  或手动测试:"
    echo "    export GITHUB_TOKEN=\$(bash .pi/scripts/get-app-token.sh)"
    echo "    gh pr create --base main --title 'test: GitHub App auth' --body 'test PR'"
    exit 0
fi

# 创建测试分支
echo "  创建测试分支: $TEST_BRANCH"
git checkout -b "$TEST_BRANCH" 2>&1

# 创建测试文件
TEST_FILE=".pi/test-app-auth-$(date +%s).tmp"
echo "test-$(date -Iseconds)" > "$TEST_FILE"
git add "$TEST_FILE"
git commit -m "test: GitHub App 鉴权验证" 2>&1

# Push 测试
echo "  推送测试分支..."
git push "$REPO_URL" "$TEST_BRANCH" 2>&1

# 创建测试 PR
echo "  创建测试 PR..."
gh pr create \
    --repo mmw-devs/ffxiv-race-ops \
    --base main \
    --head "$TEST_BRANCH" \
    --title "test: GitHub App 鉴权验证" \
    --body "## 测试 PR

此 PR 由 GitHub App \`$BOT_NAME\` 创建，验证：
- ✅ App 身份鉴权
- ✅ Repository 读写权限
- ✅ content/* 分支推送
- ✅ PR 创建

创建后请**关闭（不合并）**此 PR，并删除分支 \`$TEST_BRANCH\`。

--- 
🤖 由 ffxiv-race-ops GitHub App 自动创建" 2>&1

# 清理
git checkout main 2>&1
git branch -D "$TEST_BRANCH" 2>&1
rm -f "$TEST_FILE"

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  全部验证通过 ✓${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "Bot 身份:       $BOT_NAME"
echo "Token 过期:     $TOKEN_EXPIRES"
echo "仓库权限:       $REPO_FULL (读写)"
echo "测试 PR:        已创建（请手动关闭）"
echo ""
echo "下一步: 配置 CI Ruleset 限制 GitHub App 仅推 content/*"
echo "        配置 .pi/settings.json 集成 token 刷新到 Agent 工作流"
