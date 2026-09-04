#!/usr/bin/env node

/**
 * validate-data.ts — data.json 校验脚本
 *
 * CI 在每次 PR 时运行。零运行时依赖：仅使用 Node.js 内置模块 + CI 环境中的 ajv（devDependency）。
 *
 * 三阶段校验：
 *   阶段 1 — Ajv 结构校验：类型、必填、嵌套、数组长度
 *   阶段 2 — 值域交叉校验：phase/region/role/status 白名单（来自 constants.js）
 *   阶段 3 — 业务规则：rank 连续不跳号、占位符提醒
 *
 * 副本阶段绑定（feature/dungeon-phase-binding）：
 *   - team.phase 必须形如 `<副本id>-<阶段>`（如 M1S-P5、M2S-CLEAR）
 *   - 副本 id 必须在 meta.dungeons[] 中存在
 *   - 阶段必须在 PHASE_ORDER 中
 *   - status="ended" → 所有队伍 phase 必须是 lastDungeon-CLEAR
 *   - status="upcoming" → 所有队伍 phase 必须是 firstDungeon-P1
 *   - 跨队伍 phase 单调（按 rank 升序：(dungeonIndex, stageIndex) 非严格递增）
 *
 * 演进：
 *   - PR #1（scripts TS 化）：保持与 .js 完全等价；将 CLI 主体封装到 main() 便于测试
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import Ajv from "ajv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ══════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

export interface CliState {
  errors: number;
  warnings: number;
}

function fail(state: CliState, msg: string): void {
  console.error(`${RED}  ✗ ${msg}${RESET}`);
  state.errors++;
}

function warn(state: CliState, msg: string): void {
  console.warn(`${YELLOW}  ⚠ ${msg}${RESET}`);
  state.warnings++;
}

function ok(msg: string): void {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}

// ══════════════════════════════════════════════════════════════
// main(): CLI 主体（仅在直接调用时执行）
// ══════════════════════════════════════════════════════════════

interface RaceDataRoot {
  meta?: {
    status?: string;
    dungeons?: Array<{ id?: string }>;
  };
  teams?: Array<{
    name?: string;
    id?: string;
    rank: number;
    bossHP: number;
    phase: string;
    region: string;
    isLive: boolean;
    players: Array<{
      role: string;
      streaming: boolean;
      isLive?: boolean;
      stream?: string;
    }>;
}>;
  news?: Array<{ id?: string }>;
  broadcasters?: unknown[];
}

interface ConstantsExport {
  PHASE_ORDER?: string[];
  VALID_REGIONS?: string[];
  VALID_ROLES?: string[];
  VALID_STATUSES?: string[];
  REQUIRED_TOP_KEYS?: string[];
  TEAM_PLAYER_COUNT?: number;
}

/**
 * CLI 主体函数。返回 exit code（0 / 1），便于测试与直接调用分离。
 * @param dataPath data.json 路径（可选，默认 agent-src/public/data.json）
 */
export function main(dataPath?: string): number {
  const state: CliState = { errors: 0, warnings: 0 };

  // ══════════════════════════════════════════════════════════════
  // 阶段 1：加载 data.json（获取 RACE_DATA）
  // ══════════════════════════════════════════════════════════════

  console.log(`${BOLD}── 1. 加载 data.json ──${RESET}`);

  const resolvedDataPath = dataPath
    ? path.resolve(dataPath)
    : path.resolve(__dirname, "..", "public", "data.json");

  let RACE_DATA: RaceDataRoot;
  try {
    const raw = readFileSync(resolvedDataPath, "utf-8");
    RACE_DATA = JSON.parse(raw) as RaceDataRoot;
    ok("data.json 读取并解析成功");
  } catch (e) {
    fail(state, `无法读取/解析 data.json: ${(e as Error).message}`);
    return 1;
  }

  if (!RACE_DATA || typeof RACE_DATA !== "object") {
    fail(state, "RACE_DATA 不存在或不是对象");
    return 1;
  }

  // ══════════════════════════════════════════════════════════════
  // 阶段 2：加载 constants.js（获取白名单）
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 2. 加载 constants.js ──${RESET}`);

  const constantsPath = path.resolve(__dirname, "..", "constants.js");
  let constants: ConstantsExport;
  try {
    const constantsRaw = readFileSync(constantsPath, "utf-8");
    const wrapped =
      constantsRaw +
      "\n;({ PHASE_ORDER, VALID_REGIONS, VALID_ROLES, VALID_STATUSES, " +
      "REQUIRED_TOP_KEYS, TEAM_PLAYER_COUNT, SCHEMA_VERSION });";
    const script = new vm.Script(wrapped, { filename: "constants.js" });
    constants = script.runInNewContext({}) as ConstantsExport;
    ok("constants.js 加载成功");
  } catch (e) {
    fail(state, `无法加载 constants.js: ${(e as Error).message}`);
    return 1;
  }

  const {
    PHASE_ORDER = [],
    VALID_REGIONS = [],
    VALID_ROLES = [],
    VALID_STATUSES = [],
    REQUIRED_TOP_KEYS = [],
    TEAM_PLAYER_COUNT = 8,
  } = constants;

  // ══════════════════════════════════════════════════════════════
  // 阶段 3：Ajv Schema 结构校验
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 3. Schema 结构校验 ──${RESET}`);

  const ajv = new Ajv({ allErrors: true, validateSchema: false });
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
      const schemaRaw = readFileSync(path.join(schemaDir, file), "utf-8");
      const schema = JSON.parse(schemaRaw);
      ajv.addSchema(schema, file);
    } catch (e) {
      fail(state, `无法加载 schema/${file}: ${(e as Error).message}`);
      return 1;
    }
  }

  const validate = ajv.getSchema("root.schema.json");
  if (!validate) {
    fail(state, "无法获取 root.schema.json 的校验器");
    return 1;
  }

  const schemaValid = validate(RACE_DATA);
  if (!schemaValid) {
    for (const err of validate.errors ?? []) {
      const errObj = err as { instancePath?: string; message?: string };
      fail(state, `[schema] ${errObj.instancePath ?? "/"} ${errObj.message ?? ""}`);
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
      fail(state, `缺少顶层 key: ${k}`);
    }
  }

  // 4a-bis. meta.dungeons[] 解析
  const dungeons = RACE_DATA.meta && Array.isArray(RACE_DATA.meta.dungeons) ? RACE_DATA.meta.dungeons : null;
  const dungeonIds = dungeons ? dungeons.map((d) => d && d.id).filter((id): id is string => Boolean(id)) : [];
  const dungeonIdSet = new Set(dungeonIds);

  if (dungeons && dungeons.length > 0) {
    // 副本 id 唯一性
    if (dungeonIds.length !== dungeonIdSet.size) {
      fail(state, `meta.dungeons[] 存在重复 id: [${dungeonIds.join(", ")}]`);
    } else {
      ok(`meta.dungeons[] 含 ${dungeons.length} 个副本：${dungeonIds.join(", ")}`);
    }
  }

  // 4b. meta.status
  if (RACE_DATA.meta) {
    if (!VALID_STATUSES.includes(RACE_DATA.meta.status ?? "")) {
      fail(state, `meta.status = "${RACE_DATA.meta.status}" not in [${VALID_STATUSES.join(", ")}]`);
    } else {
      ok(`meta.status = "${RACE_DATA.meta.status}"`);
    }
  }

  // 4c. teams[] 逐队校验（phase 复合格式 + 关联性）
  if (!Array.isArray(RACE_DATA.teams)) {
    fail(state, "teams 不是数组");
  } else {
    const teams = RACE_DATA.teams;
    ok(`共 ${teams.length} 支队伍`);

    // rank 连续性
    const ranks = teams.map((t) => t.rank).sort((a, b) => a - b);
    const expectedRanks = Array.from({ length: teams.length }, (_, i) => i + 1);
    if (ranks.some((r, i) => r !== expectedRanks[i])) {
      fail(state, "rank 存在重复或跳号");
    } else {
      ok(`rank 1–${teams.length} 连续无跳号`);
    }

    // 用于跨队伍单调性校验
    const phaseIndexByRank = new Map<number, { dungeonId: string; stage: string; dungeonIndex: number; stageIndex: number }>();

    for (const team of teams) {
      const teamPrefix = `[${team.name || team.id}]`;

      // bossHP
      if (typeof team.bossHP !== "number" || team.bossHP < 0 || team.bossHP > 100) {
        fail(state, `${teamPrefix} bossHP = ${team.bossHP} 不在 [0, 100] 范围内`);
      }

      // phase 复合格式：<副本id>-<阶段>
      const phaseRaw = team.phase;
      let phaseParsed: { dungeonId: string; stage: string; dungeonIndex: number; stageIndex: number } | null = null;
      if (typeof phaseRaw !== "string" || !phaseRaw.includes("-")) {
        fail(state, `${teamPrefix} phase = "${phaseRaw}" 格式非法，应为 <副本id>-<阶段>（如 M1S-P5）`);
      } else {
        const dashIdx = phaseRaw.indexOf("-");
        const dungeonId = phaseRaw.slice(0, dashIdx);
        const stage = phaseRaw.slice(dashIdx + 1);
        const dungeonIndex = dungeonIds.indexOf(dungeonId);
        const stageIndex = PHASE_ORDER ? PHASE_ORDER.indexOf(stage) : -1;

        if (dungeonIndex === -1) {
          fail(state, `${teamPrefix} phase 副本 id "${dungeonId}" 不在 meta.dungeons[] 中`);
        } else if (stageIndex === -1) {
          fail(state, `${teamPrefix} phase 阶段 "${stage}" 不在 PHASE_ORDER [${PHASE_ORDER.join(", ")}] 中`);
        } else {
          phaseParsed = { dungeonId, stage, dungeonIndex, stageIndex };
        }
      }

      if (phaseParsed) {
        phaseIndexByRank.set(team.rank, phaseParsed);
      }

      // region ← VALID_REGIONS（来自 constants.js）
      if (!VALID_REGIONS.includes(team.region)) {
        fail(state, `${teamPrefix} region = "${team.region}" 不在 [${VALID_REGIONS.join(", ")} 中]`);
      }

      // players[] 人数
      if (!Array.isArray(team.players)) {
        fail(state, `${teamPrefix} players 不是数组`);
      } else {
        if (team.players.length !== TEAM_PLAYER_COUNT) {
          fail(state, `${teamPrefix} players[] 共 ${team.players.length} 人，应为 ${TEAM_PLAYER_COUNT} 人`);
        }

        for (const p of team.players) {
          if (!VALID_ROLES.includes(p.role)) {
            fail(state, `${teamPrefix} 玩家 role = "${p.role}" 不在 [${VALID_ROLES.join(", ")}] 中`);
          }
          if (typeof p.streaming !== "boolean") {
            fail(state, `${teamPrefix} 玩家 streaming 不是 boolean`);
          }
          if (typeof p.isLive !== "undefined" && typeof p.isLive !== "boolean") {
            fail(state, `${teamPrefix} 玩家 isLive 不是 boolean`);
          }
        }
      }

      // isLive
      if (typeof team.isLive !== "boolean") {
        fail(state, `${teamPrefix} isLive 不是 boolean`);
      }
    }

    // 4d. status ↔ phase 关联性
    if (RACE_DATA.meta && dungeons && dungeons.length > 0) {
      const status = RACE_DATA.meta.status;
      if (status === "ended") {
        const lastDungeonId = dungeonIds[dungeonIds.length - 1]!;
        const expectedPhase = `${lastDungeonId}-CLEAR`;
        for (const team of teams) {
          if (team.phase !== expectedPhase) {
            fail(state, `[${team.name || team.id}] meta.status="ended" 时所有队伍 phase 必须是 "${expectedPhase}"，但 rank ${team.rank} 是 "${team.phase}"`);
          }
        }
        ok(`status="ended" 校验通过：所有队伍 phase = "${expectedPhase}"`);
      } else if (status === "upcoming") {
        const firstDungeonId = dungeonIds[0]!;
        const expectedPhase = `${firstDungeonId}-${PHASE_ORDER[0]}`;
        for (const team of teams) {
          if (team.phase !== expectedPhase) {
            fail(state, `[${team.name || team.id}] meta.status="upcoming" 时所有队伍 phase 必须是 "${expectedPhase}"，但 rank ${team.rank} 是 "${team.phase}"`);
          }
        }
        ok(`status="upcoming" 校验通过：所有队伍 phase = "${expectedPhase}"`);
      }
    }

    // 4e. 副本顺序推进：副本 N+1 出现 → 副本 N 必须全 CLEAR
    if (
      phaseIndexByRank.size > 0 &&
      dungeons &&
      dungeons.length > 1 &&
      RACE_DATA.meta &&
      RACE_DATA.meta.status === "live"
    ) {
      const clearStageIdx = PHASE_ORDER ? PHASE_ORDER.indexOf("CLEAR") : -1;
      const firstStageIdx = 0; // P1 = index 0
      let orderOk = true;
      for (const team of teams) {
        const parsed = phaseIndexByRank.get(team.rank);
        if (!parsed || parsed.dungeonIndex === 0) continue;
        // 非 P1 阶段出现在副本 N+1（N >= 1）时，检查副本 N 是否有队伍 CLEAR
        if (parsed.stageIndex > firstStageIdx) {
          let prevHasClear = false;
          for (const other of teams) {
            const otherParsed = phaseIndexByRank.get(other.rank);
            if (
              otherParsed &&
              otherParsed.dungeonIndex === parsed.dungeonIndex - 1 &&
              otherParsed.stageIndex === clearStageIdx
            ) {
              prevHasClear = true;
              break;
            }
          }
          if (!prevHasClear) {
            fail(state, `副本顺序违反：rank ${team.rank} (${team.phase}) 在副本 ${dungeonIds[parsed.dungeonIndex]}，但前一个副本 ${dungeonIds[parsed.dungeonIndex - 1]} 还无队伍 CLEAR`);
            orderOk = false;
          }
        }
      }
      if (orderOk) {
        ok("副本顺序推进校验通过：副本 N+1 进入时 N 已全 CLEAR");
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 阶段 5：news[] / broadcasters[] 基本校验
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 5. news[] / broadcasters[] 基本校验 ──${RESET}`);

  if (!Array.isArray(RACE_DATA.news)) {
    fail(state, "news 不是数组");
  } else {
    ok(`共 ${RACE_DATA.news.length} 条新闻`);
    let hasId = true;
    for (const item of RACE_DATA.news) {
      if (!item.id) { fail(state, "新闻条目缺少 id"); hasId = false; break; }
    }
    if (hasId) ok("所有新闻条目格式正常");
  }

  if (!Array.isArray(RACE_DATA.broadcasters)) {
    fail(state, "broadcasters 不是数组");
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
      warn(state, `${placeholderCount} 支队伍名称仍为占位符 [队伍名 X]`);
    }
    if (placeholderPlayerCount > 0 && RACE_DATA.meta && RACE_DATA.meta.status === "live") {
      warn(state, `${placeholderPlayerCount} 个直播链接仍为占位符 "#"，赛事已 LIVE`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 结果汇总
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
  if (state.errors === 0) {
    console.log(`${GREEN}${BOLD}  校验通过 ✓${RESET}`);
    if (state.warnings > 0) {
      console.log(`${YELLOW}  ${state.warnings} 条提醒（不阻断）${RESET}`);
    }
    return 0;
  } else {
    console.log(`${RED}${BOLD}  校验失败: ${state.errors} 条错误${RESET}`);
    if (state.warnings > 0) {
      console.log(`${YELLOW}  ${state.warnings} 条提醒${RESET}`);
    }
    return 1;
  }
}

// ══════════════════════════════════════════════════════════════
// CLI 入口守卫：仅在直接调用本脚本时执行 main()
// vitest 等工具 import 本模块不会触发 main()
// ══════════════════════════════════════════════════════════════

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const arg = process.argv[2];
  process.exit(main(arg));
}