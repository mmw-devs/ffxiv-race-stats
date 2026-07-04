#!/usr/bin/env node

/**
 * data.json 校验脚本 — CI 在每次 PR 时运行。
 * 零运行时依赖：仅使用 Node.js 内置模块 + CI 环境中的 ajv（devDependency）。
 *
 * 三阶段校验：
 *   阶段 1 — Ajv 结构校验：类型、必填、嵌套、数组长度
 *   阶段 2 — 值域交叉校验：phase/region/role/status 白名单（来自 constants.js）
 *   阶段 3 — 业务规则：rank 连续不跳号、占位符提醒
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Ajv = require("ajv");

// ══════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

let errors = 0;
let warnings = 0;

function fail(msg) {
  console.error(`${RED}  ✗ ${msg}${RESET}`);
  errors++;
}

function warn(msg) {
  console.warn(`${YELLOW}  ⚠ ${msg}${RESET}`);
  warnings++;
}

function ok(msg) {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}

// ══════════════════════════════════════════════════════════════
// 阶段 1：加载 data.json（获取 RACE_DATA）
// ══════════════════════════════════════════════════════════════

console.log(`${BOLD}── 1. 加载 data.json ──${RESET}`);

const dataPath = path.resolve(__dirname, "..", "public", "data.json");

let RACE_DATA;
try {
  const raw = fs.readFileSync(dataPath, "utf-8");
  RACE_DATA = JSON.parse(raw);
  ok("data.json 读取并解析成功");
} catch (e) {
  fail(`无法读取/解析 data.json: ${e.message}`);
  process.exit(1);
}

if (!RACE_DATA || typeof RACE_DATA !== "object") {
  fail("RACE_DATA 不存在或不是对象");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
// 阶段 2：加载 constants.js（获取白名单）
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 2. 加载 constants.js ──${RESET}`);

const constantsPath = path.resolve(__dirname, "..", "constants.js");
let constants;
try {
  const constantsRaw = fs.readFileSync(constantsPath, "utf-8");
  const wrapped =
    constantsRaw +
    "\n;({ PHASE_ORDER, VALID_REGIONS, VALID_ROLES, VALID_STATUSES, " +
    "REQUIRED_TOP_KEYS, TEAM_PLAYER_COUNT, SCHEMA_VERSION });";
  const script = new vm.Script(wrapped, { filename: "constants.js" });
  constants = script.runInNewContext({});
  ok("constants.js 加载成功");
} catch (e) {
  fail(`无法加载 constants.js: ${e.message}`);
  process.exit(1);
}

const {
  PHASE_ORDER,
  VALID_REGIONS,
  VALID_ROLES,
  VALID_STATUSES,
  REQUIRED_TOP_KEYS,
  TEAM_PLAYER_COUNT,
} = constants;

// ══════════════════════════════════════════════════════════════
// 阶段 3：Ajv Schema 结构校验
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 3. Schema 结构校验 ──${RESET}`);

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
const schemaDir = path.resolve(__dirname, "..", "schema");

// 按依赖顺序加载（player 被 team 引用，meta/team/news/broadcaster 被 root 引用）
const schemaFiles = [
  "player.schema.json",
  "meta.schema.json",
  "team.schema.json",
  "news.schema.json",
  "broadcaster.schema.json",
  "root.schema.json",
];

for (const file of schemaFiles) {
  try {
    const schemaRaw = fs.readFileSync(path.join(schemaDir, file), "utf-8");
    const schema = JSON.parse(schemaRaw);
    ajv.addSchema(schema, file);
  } catch (e) {
    fail(`无法加载 schema/${file}: ${e.message}`);
    process.exit(1);
  }
}

const validate = ajv.getSchema("root.schema.json");
if (!validate) {
  fail("无法获取 root.schema.json 的校验器");
  process.exit(1);
}

const schemaValid = validate(RACE_DATA);
if (!schemaValid) {
  for (const err of validate.errors) {
    fail(`[schema] ${err.instancePath || "/"} ${err.message}`);
  }
} else {
  ok("RACE_DATA 通过 schema 结构校验");
}

// ══════════════════════════════════════════════════════════════
// 阶段 4：值域交叉校验 + 业务规则
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 4. 值域与业务规则校验 ──${RESET}`);

// 4a. 顶层 key 完整性
for (const k of REQUIRED_TOP_KEYS) {
  if (!(k in RACE_DATA)) {
    fail(`缺少顶层 key: ${k}`);
  }
}

// 4b. meta.status
if (RACE_DATA.meta) {
  if (!VALID_STATUSES.includes(RACE_DATA.meta.status)) {
    fail(`meta.status = "${RACE_DATA.meta.status}" 不在 [${VALID_STATUSES.join(", ")}] 中`);
  } else {
    ok(`meta.status = "${RACE_DATA.meta.status}"`);
  }
}

// 4c. teams[] 逐队校验
if (!Array.isArray(RACE_DATA.teams)) {
  fail("teams 不是数组");
} else {
  const teams = RACE_DATA.teams;
  ok(`共 ${teams.length} 支队伍`);

  // rank 连续性
  const ranks = teams.map((t) => t.rank).sort((a, b) => a - b);
  const expectedRanks = Array.from({ length: teams.length }, (_, i) => i + 1);
  if (ranks.some((r, i) => r !== expectedRanks[i])) {
    fail("rank 存在重复或跳号");
  } else {
    ok(`rank 1–${teams.length} 连续无跳号`);
  }

  for (const team of teams) {
    const prefix = `[${team.name || team.id}]`;

    // bossHP
    if (typeof team.bossHP !== "number" || team.bossHP < 0 || team.bossHP > 100) {
      fail(`${prefix} bossHP = ${team.bossHP} 不在 [0, 100] 范围内`);
    }

    // phase ← PHASE_ORDER（来自 constants.js）
    if (PHASE_ORDER && Array.isArray(PHASE_ORDER)) {
      if (!PHASE_ORDER.includes(team.phase)) {
        fail(`${prefix} phase = "${team.phase}" 不在 PHASE_ORDER 白名单中`);
      }
    }

    // region ← VALID_REGIONS（来自 constants.js）
    if (!VALID_REGIONS.includes(team.region)) {
      fail(`${prefix} region = "${team.region}" 不在 [${VALID_REGIONS.join(", ")}] 中`);
    }

    // players[] 人数
    if (!Array.isArray(team.players)) {
      fail(`${prefix} players 不是数组`);
    } else {
      if (team.players.length !== TEAM_PLAYER_COUNT) {
        fail(`${prefix} players[] 共 ${team.players.length} 人，应为 ${TEAM_PLAYER_COUNT} 人`);
      }

      for (const p of team.players) {
        if (!VALID_ROLES.includes(p.role)) {
          fail(`${prefix} 玩家 role = "${p.role}" 不在 [${VALID_ROLES.join(", ")}] 中`);
        }
        if (typeof p.streaming !== "boolean") {
          fail(`${prefix} 玩家 streaming 不是 boolean`);
        }
        if (typeof p.isLive !== "undefined" && typeof p.isLive !== "boolean") {
          fail(`${prefix} 玩家 isLive 不是 boolean`);
        }
      }
    }

    // isLive
    if (typeof team.isLive !== "boolean") {
      fail(`${prefix} isLive 不是 boolean`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 阶段 5：news[] / broadcasters[] 基本校验
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 5. news[] / broadcasters[] 基本校验 ──${RESET}`);

if (!Array.isArray(RACE_DATA.news)) {
  fail("news 不是数组");
} else {
  ok(`共 ${RACE_DATA.news.length} 条新闻`);
  let hasId = true;
  for (const item of RACE_DATA.news) {
    if (!item.id) { fail("新闻条目缺少 id"); hasId = false; break; }
  }
  if (hasId) ok("所有新闻条目格式正常");
}

if (!Array.isArray(RACE_DATA.broadcasters)) {
  fail("broadcasters 不是数组");
} else {
  ok(`共 ${RACE_DATA.broadcasters.length} 个转播方`);
}

// ══════════════════════════════════════════════════════════════
// 阶段 6：软提醒（不阻断 CI）
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}── 6. 提醒（不阻断 CI）──${RESET}`);

if (Array.isArray(RACE_DATA.teams)) {
  let placeholderCount = 0;
  let placeholderPlayerCount = 0;
  for (const team of RACE_DATA.teams) {
    if (team.name && (team.name.startsWith("[") || team.name.includes("队伍名"))) {
      placeholderCount++;
    }
    if (Array.isArray(team.players)) {
      for (const p of team.players) {
        if (p.stream === "#") placeholderPlayerCount++;
      }
    }
  }
  if (placeholderCount > 0) {
    warn(`${placeholderCount} 支队伍名称仍为占位符 [队伍名 X]`);
  }
  if (placeholderPlayerCount > 0 && RACE_DATA.meta && RACE_DATA.meta.status === "live") {
    warn(`${placeholderPlayerCount} 个直播链接仍为占位符 "#"，赛事已 LIVE`);
  }
}

// ══════════════════════════════════════════════════════════════
// 结果汇总
// ══════════════════════════════════════════════════════════════

console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
if (errors === 0) {
  console.log(`${GREEN}${BOLD}  校验通过 ✓${RESET}`);
  if (warnings > 0) {
    console.log(`${YELLOW}  ${warnings} 条提醒（不阻断）${RESET}`);
  }
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}  校验失败: ${errors} 条错误${RESET}`);
  if (warnings > 0) {
    console.log(`${YELLOW}  ${warnings} 条提醒${RESET}`);
  }
  process.exit(1);
}
