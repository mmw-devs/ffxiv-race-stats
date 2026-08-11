#!/bin/bash
# GitHub App Token 获取脚本 — 供 Agent 工作流使用
# 用法: FFXIV_OPS_PEM=/path/to/key.pem bash .pi/scripts/get-app-token.sh
# 输出: GitHub Installation Token (ghs_...)，通过 stdout 或 GITHUB_TOKEN 环境变量使用

set -euo pipefail

APP_ID="4214545"
INSTALLATION_ID="144348445"
BOT_NAME="race-ops-bot"

# PEM 路径：优先从环境变量读取，否则检查默认位置
PEM="${FFXIV_OPS_PEM:-}"
if [ -z "$PEM" ]; then
    echo "错误: 请设置 FFXIV_OPS_PEM 环境变量为 PEM 私钥文件路径" >&2
    exit 1
fi

# 检查 PEM 文件
if [ ! -f "$PEM" ]; then
    echo "错误: PEM 私钥文件不存在: $PEM" >&2
    exit 1
fi

# 生成 JWT（GitHub 对时钟偏移敏感，iat 设 60 秒前）
NOW=$(date +%s)
IAT=$((NOW - 60))
EXP=$((IAT + 540))

HEADER='{"alg":"RS256","typ":"JWT"}'
PAYLOAD="{\"iat\":$IAT,\"exp\":$EXP,\"iss\":\"$APP_ID\"}"

JWT=$(printf '%s' "$HEADER" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT+="."
JWT+=$(printf '%s' "$PAYLOAD" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIGNATURE=$(printf '%s' "$JWT" | openssl dgst -sha256 -sign "$PEM" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
JWT="${JWT}.${SIGNATURE}"

# 换取 Installation Token
RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $JWT" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens")

TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "错误: 无法获取 Installation Token" >&2
    echo "GitHub 返回: $RESPONSE" >&2
    exit 1
fi

# 输出 Token（仅 stdout，便于管道使用）
echo -n "$TOKEN"
