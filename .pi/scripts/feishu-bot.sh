#!/bin/bash
# lark-cli 飞书 Bot 守护进程
# 启动: nohup bash .pi/scripts/feishu-bot.sh > /tmp/feishu-bot.log 2>&1 &
# 停止: pkill -f "feishu-bot.sh" && pkill -f "lark-cli.*event consume"
# 状态: lark-cli event status
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CLI=$(find "$PROJECT_DIR/.pi/npm/node_modules/@larksuite" -name "lark-cli" -type f | head -1)
[ -z "$CLI" ] && { echo "[bot] lark-cli 未找到"; exit 1; }

export HTTP_PROXY="${HTTP_PROXY:-http://172.28.176.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://172.28.176.1:7890}"
"$CLI" profile use ffxiv-bot >/dev/null 2>&1

for p in $(pgrep -f "lark-cli.*event consume" 2>/dev/null); do
  [ "$p" != "$$" ] && kill "$p" 2>/dev/null
done
sleep 1

echo "[bot] 启动..."

"$CLI" event consume im.message.receive_v1 --as bot < <(tail -f /dev/null) 2>/dev/null \
| python3 -c "
import sys, json, subprocess, os

cli = '$CLI'
env = os.environ.copy()
env['HTTP_PROXY'] = 'http://172.28.176.1:7890'
env['HTTPS_PROXY'] = 'http://172.28.176.1:7890'

# ── 扩展点：修改此函数即可自定义回复逻辑 ──
def handle_message(chat_id, content, sender_id, message_id):
    '''返回回复文本。可替换为调用 PI Agent 或其他处理逻辑。'''
    # TODO: 对接 PI Agent 管线，实现智能回复
    return f'收到: {content}'

for line in sys.stdin:
    line = line.strip()
    if not line.startswith('{'): continue
    try:
        evt = json.loads(line)
    except:
        continue
    chat_id = evt.get('chat_id','')
    content = evt.get('content','')
    sender_id = evt.get('sender_id','')
    message_id = evt.get('message_id','')
    if not chat_id or not content:
        continue

    print(f'[bot] [{sender_id}]: {content}', flush=True)
    reply = handle_message(chat_id, content, sender_id, message_id)

    body = json.dumps({
        'receive_id': chat_id,
        'msg_type': 'text',
        'content': json.dumps({'text': reply})
    })
    r = subprocess.run(
        [cli, 'api', 'POST', '/open-apis/im/v1/messages',
         '--params', '{\"receive_id_type\":\"chat_id\"}',
         '--data', body],
        env=env, capture_output=True, text=True
    )
    ok = 'ok' in r.stdout[:50]
    print(f'[bot] reply={\"OK\" if ok else \"FAIL\"}', flush=True)
    if not ok:
        print(f'[bot] err: {r.stderr[:200]}', flush=True)
"
