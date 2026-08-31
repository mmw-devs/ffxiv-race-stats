# data.json 数据契约

FFXIV 高难首杀竞速数据由 ops 仓库（`mmw-devs/ffxiv-race-ops`）维护，dev 仓库（`mmw-race-stats`）仅维护 schema 与校验脚本。

## 字段速览

| 顶层字段 | 类型 | 说明 |
|---|---|---|
| `meta` | `Meta` | 赛事元信息（含副本列表） |
| `teams` | `Team[]` | 队伍列表（已按 rank 排序） |
| `news` | `NewsItem[]` | 速报 |
| `broadcasters` | `Broadcaster[]` | 转播方 |
| `notices` | `string[]` | 公告（自由文本） |
| `sponsors` | `Sponsor[]` | 赞助商 `{ name, desc }` |

## 副本 / 阶段绑定（核心）

赛事可能涉及多个副本（数组），阶段（phase）必须绑定到具体副本。

```json
"meta": {
  "dungeons": [
    { "id": "M1S", "name": "欧米茄绝境战 M1S" },
    { "id": "M2S", "name": "欧米茄绝境战 M2S" },
    { "id": "M3S", "name": "欧米茄绝境战 M3S" }
  ]
}
```

- `dungeons[]` 数组顺序即为副本排列顺序（M1S → M2S → M3S）
- 队伍 `phase` 字段为复合 string：`<副本id>-<阶段>`，如 `"M1S-P5"`、`"M2S-CLEAR"`
- 阶段值域（全局共享）：`P1` / `P2` / `P3` / `P4` / `CLEAR`

## 校验规则（validate-data.js 三阶段）

### 阶段 1 — Schema 结构（Ajv）

- `meta` 必须含 `eventName`、`status`、`dungeons`
- `dungeons[]` 最少 1 项，每项 `id`（`^[A-Z0-9]+$`）+ `name`
- `team.phase` 必须匹配 `^[A-Z0-9]+-(P[0-9]+|CLEAR)$`
- 每队 `players[]` 恰好 8 人

### 阶段 2 — 值域与业务规则

| 规则 | 说明 | fail 信息 |
|---|---|---|
| dungeons id 唯一 | `meta.dungeons[].id` 不能重复 | "存在重复 id" |
| phase 副本存在 | phase 中副本 id 必须在 `dungeons[]` 中 | "副本 id 'X' 不在 meta.dungeons[] 中" |
| phase 阶段合法 | phase 中阶段必须在 `PHASE_ORDER` 中 | "阶段 'X' 不在 PHASE_ORDER 中" |
| **status="ended"** | 所有队伍 phase 必须是 `lastDungeon-CLEAR` | "status='ended' 时所有队伍 phase 必须是..." |
| **status="upcoming"** | 所有队伍 phase 必须是 `firstDungeon-P1` | "status='upcoming' 时所有队伍 phase 必须是..." |
| **副本顺序推进**（仅 live）| 副本 N+1 出现非 P1 阶段时，副本 N 必须有队伍 CLEAR | "副本顺序违反：rank X (Y) 在副本 Z，但前一个副本 W 还无队伍 CLEAR" |
| rank 连续 | rank 1..N 无跳号无重复 | "rank 存在重复或跳号" |
| role 白名单 | player.role ∈ {tank, healer, dps} | "玩家 role 不在..." |
| region 白名单 | team.region ∈ {JP, NA, EU, OC, CN, KR} | "region 不在..." |

## 迁移指南（旧 → 新）

| 旧 | 新 |
|---|---|
| `"dungeon": "欧米茄绝境战"` | `"dungeons": [{"id": "M1S", "name": "欧米茄绝境战 M1S"}]`（多副本则数组多元素） |
| `"phase": "P5"` | `"phase": "M1S-P5"` |
| `"phase": "CLEAR"` | `"phase": "M1S-CLEAR"` |

## 文件位置

| 内容 | 路径 |
|---|---|
| Schema 真源 | dev `agent-src/schema/*.schema.json` |
| 值域白名单（PHASE_ORDER 等） | dev `agent-src/constants.js` |
| 校验脚本 | dev `agent-src/scripts/validate-data.js` |
| 单元测试 | dev `agent-src/scripts/__tests__/` |
| 实际数据 | **ops 仓库** `public/data.json`（运营 Agent 改） |
| dev 镜像 | dev `agent-src/public/data.json`（sync-data-to-dev 推过来） |

## 升级步骤

1. dev 仓库 PR 合入（schema + validate 改动）
2. sync-agent-src 把 dev `agent-src/` 推到 ops 仓库
3. ops 仓库 CI（`validate.yml`）跑 validate-data.js 会**对旧 data.json 报错**
4. 运营 Agent 升级 `ops/public/data.json`：
   - 删 `meta.dungeon`，加 `meta.dungeons[]`
   - 所有 `team.phase` 改为 `<副本id>-<阶段>` 格式
5. ops 仓库 CF Pages 部署恢复