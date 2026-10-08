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

/** 取 http(s) URL 的 hostname（小写）；非法或非 http(s) 返回 null。 */
function hostnameOf(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** hostname 是否命中域名白名单（精确或子域）。 */
function domainAllowed(hostname: string, allow: string[]): boolean {
  return allow.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

/** 文本显示宽度：CJK 按 2，其余按 1（用于「40 英文字符 / 20 中文字符」上限）。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60]/.test(ch) ? 2 : 1;
  return w;
}

// ══════════════════════════════════════════════════════════════
// main(): CLI 主体（仅在直接调用时执行）
// ══════════════════════════════════════════════════════════════

interface RaceDataRoot {
  meta?: {
    eventName?: string;
    edition?: string;
    status?: string;
    startTime?: string;
    dungeons?: Array<{ id?: string; name?: string }>;
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
      job?: string;
      role: string;
      streaming: boolean;
      isLive?: boolean;
      stream?: string;
    }>;
}>;
  news?: Array<{ id?: string; time?: string; text?: string; urgent?: boolean }>;
  broadcasters?: Array<{
    id?: string;
    name?: string;
    platform?: string;
    url?: string;
    note?: string;
  }>;
  notices?: unknown;
  sponsors?: unknown;
}

interface ConstantsExport {
  PHASE_ORDER?: string[];
  VALID_REGIONS?: string[];
  VALID_ROLES?: string[];
  VALID_STATUSES?: string[];
  REQUIRED_TOP_KEYS?: string[];
  TEAM_PLAYER_COUNT?: number;
  JOB_ROLES?: Record<string, string[]>;
  PLATFORM_DOMAINS?: Record<string, string[]>;
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
      "REQUIRED_TOP_KEYS, TEAM_PLAYER_COUNT, SCHEMA_VERSION, " +
      "JOB_ROLES, PLATFORM_DOMAINS });";
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
    JOB_ROLES = {},
    PLATFORM_DOMAINS = {},
  } = constants;

  // 由 constants.js 派生（不额外定义常量）：职业白名单、平台枚举、域名白名单
  const VALID_JOBS = Object.values(JOB_ROLES).flat();
  const VALID_PLATFORMS = Object.keys(PLATFORM_DOMAINS);
  const STREAM_DOMAINS = Object.values(PLATFORM_DOMAINS).flat();

  // ISO 8601 瞬时（必须含时区 Z 或 ±HH:MM）——用于 news.time / meta.startTime
  const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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
  // 阶段 4：值域交叉校验 + 业务规则（meta / teams）
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 4. 值域与业务规则校验 ──${RESET}`);

  const meta = RACE_DATA.meta;

  // 4a. 顶层 key 完整性
  for (const k of REQUIRED_TOP_KEYS) {
    if (!(k in RACE_DATA)) {
      fail(state, `缺少顶层 key: ${k}`);
    }
  }

  // 4b. meta.eventName：1–16 字符，不得含标点/占位符/控制字符
  if (meta) {
    const ev = typeof meta.eventName === "string" ? meta.eventName : "";
    if (ev.length < 1 || ev.length > 16) {
      fail(state, `meta.eventName 长度应为 1–16，实际 ${ev.length}`);
    }
    if (/[，。！？；：、""''（）《》〈〉【】〔〕…—～·,.!?;:"'()<>[\]{}\\/|@#$%^&*+=~`]/.test(ev)) {
      fail(state, `meta.eventName = "${ev}" 不得含有标点或占位符`);
    }
    if (/[\u0000-\u001f\u007f]/.test(ev)) {
      fail(state, `meta.eventName 不得含有控制字符`);
    }
  }

  // 4c. meta.edition：补零整数（≥2 位）或 "-"
  if (meta && !/^(\d{2,}|-)$/.test(String(meta.edition ?? ""))) {
    fail(state, `meta.edition = "${meta.edition}" 应为补零整数（≥2 位）或 "-"`);
  }

  // 4d. meta.dungeons[] 解析 + id 唯一 + 长度 1/4 + id/name 规则
  const dungeons = meta && Array.isArray(meta.dungeons) ? meta.dungeons : null;
  const dungeonIds = dungeons ? dungeons.map((d) => d && d.id).filter((id): id is string => Boolean(id)) : [];
  const dungeonIdSet = new Set(dungeonIds);

  if (dungeons && dungeons.length > 0) {
    // 副本 id 唯一性
    if (dungeonIds.length !== dungeonIdSet.size) {
      fail(state, `meta.dungeons[] 存在重复 id: [${dungeonIds.join(", ")}]`);
    } else {
      ok(`meta.dungeons[] 含 ${dungeons.length} 个副本：${dungeonIds.join(", ")}`);
    }

    // 数组长度只能为 1（绝境）或 4（零式）
    if (dungeons.length !== 1 && dungeons.length !== 4) {
      fail(state, `meta.dungeons 数组长度只能为 1 或 4，实际 ${dungeons.length}`);
    }

    // 单副本（绝境）：id 以 U 开头，name 含「绝境」或 "Ultimate"
    if (dungeons.length === 1) {
      const d = dungeons[0];
      const id = d?.id ?? "";
      const name = d?.name ?? "";
      if (!/^U[A-Z0-9]*$/.test(id)) {
        fail(state, `meta.dungeons[0].id = "${id}" 单副本事件应以 "U" 开头`);
      }
      if (!name.includes("绝境") && !/ultimate/i.test(name)) {
        fail(state, `meta.dungeons[0].name = "${name}" 应包含「绝境」或 "Ultimate"`);
      }
    } else if (dungeons.length === 4) {
      // 四副本（零式）：<A-Z><n>S、同首字母、数字属 [1-4]/[5-8]/[9-12] 且正序、name 含「零式」或 "Savage"
      const SAVAGE_GROUPS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];
      const parsed: Array<{ letter: string; num: number }> = [];
      for (const d of dungeons) {
        const id = d?.id ?? "";
        const name = d?.name ?? "";
        const m = /^([A-Z])(\d+)S$/.exec(id);
        if (!m) {
          fail(state, `meta.dungeons id = "${id}" 应形如 <A-Z><数字>S（如 M1S）`);
          continue;
        }
        parsed.push({ letter: m[1]!, num: Number(m[2]) });
        if (!name.includes("零式") && !/savage/i.test(name)) {
          fail(state, `meta.dungeons name = "${name}" 应包含「零式」或 "Savage"`);
        }
      }
      if (parsed.length === 4) {
        if (new Set(parsed.map((p) => p.letter)).size !== 1) {
          fail(state, `meta.dungeons 四条 id 首字母必须相同`);
        }
        const nums = parsed.map((p) => p.num);
        const sorted = [...nums].sort((a, b) => a - b);
        if (nums.join(",") !== sorted.join(",")) {
          fail(state, `meta.dungeons 应按中间数字正序排列`);
        }
        if (!SAVAGE_GROUPS.some((g) => g.join(",") === sorted.join(","))) {
          fail(state, `meta.dungeons 中间数字应为 [1,2,3,4]/[5,6,7,8]/[9,10,11,12] 之一`);
        }
      }
    }
  }

  // 4e. meta.status
  if (meta) {
    if (!VALID_STATUSES.includes(meta.status ?? "")) {
      fail(state, `meta.status = "${meta.status}" not in [${VALID_STATUSES.join(", ")}]`);
    } else {
      ok(`meta.status = "${meta.status}"`);
    }
  }

  // 4f. meta.startTime：允许 "-" 占位（upcoming 未知）；否则必须是含时区的 ISO 8601
  if (meta) {
    const startTime = meta.startTime;
    if (typeof startTime === "string" && startTime !== "-" && !ISO_INSTANT.test(startTime)) {
      fail(state, `meta.startTime = "${startTime}" 应为 ISO 8601 且含时区（Z 或 ±HH:MM），未知时用 "-"`);
    }
  }

  // 4g. teams[] 逐队校验（id/name/bossHP/phase/region/players/isLive）
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

    const seenTeamIds = new Set<string>();

    // 用于跨队伍单调性校验
    const phaseIndexByRank = new Map<number, { dungeonId: string; stage: string; dungeonIndex: number; stageIndex: number }>();

    // players[] 位置顺序：2T / 2H / 4DPS
    const ROLE_ORDER = ["tank", "tank", "healer", "healer", "dps", "dps", "dps", "dps"];

    for (const team of teams) {
      const teamPrefix = `[${team.name || team.id}]`;

      // team.id：^t\d{1,3}$ + 唯一
      if (!/^t\d{1,3}$/.test(String(team.id ?? ""))) {
        fail(state, `${teamPrefix} id = "${team.id}" 应为小写 t + 数字（≤999）`);
      } else if (seenTeamIds.has(team.id!)) {
        fail(state, `${teamPrefix} id 重复：${team.id}`);
      } else {
        seenTeamIds.add(team.id!);
      }

      // team.name：必填非空 + 显示宽度 ≤40（中文按 2）
      if (typeof team.name !== "string" || team.name.trim() === "") {
        fail(state, `${teamPrefix} name 必填非空`);
      } else if (displayWidth(team.name) > 40) {
        fail(state, `${teamPrefix} name 显示宽度 ${displayWidth(team.name)} 超过 40（中文按 2 计）`);
      }

      // bossHP：范围 + 小数位 ≤1
      if (typeof team.bossHP !== "number" || team.bossHP < 0 || team.bossHP > 100) {
        fail(state, `${teamPrefix} bossHP = ${team.bossHP} 不在 [0, 100] 范围内`);
      } else if (Math.abs(team.bossHP * 10 - Math.round(team.bossHP * 10)) > 1e-9) {
        fail(state, `${teamPrefix} bossHP = ${team.bossHP} 小数位应 ≤ 1 位`);
      }

      // phase：多副本为 <副本id>-<阶段>；单副本（绝境）为 <阶段>（无副本前缀）
      const phaseRaw = team.phase;
      const phaseText =
        dungeons && dungeons.length === 1 && typeof phaseRaw === "string" && !phaseRaw.includes("-")
          ? `${dungeonIds[0]}-${phaseRaw}`
          : phaseRaw;
      let phaseParsed: { dungeonId: string; stage: string; dungeonIndex: number; stageIndex: number } | null = null;
      if (typeof phaseText !== "string" || !phaseText.includes("-")) {
        fail(state, `${teamPrefix} phase = "${phaseRaw}" 格式非法，应为 <副本id>-<阶段>（如 M1S-P5）`);
      } else {
        const dashIdx = phaseText.indexOf("-");
        const dungeonId = phaseText.slice(0, dashIdx);
        const stage = phaseText.slice(dashIdx + 1);
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

      // bossHP ↔ phase CLEAR 一致
      if (typeof team.phase === "string" && typeof team.bossHP === "number") {
        const isClear = /(^|-)CLEAR$/.test(team.phase);
        if (team.bossHP === 0 && !isClear) {
          fail(state, `${teamPrefix} bossHP=0 时 phase 应为 CLEAR，实际 "${team.phase}"`);
        }
        if (team.bossHP > 0 && isClear) {
          fail(state, `${teamPrefix} phase=CLEAR 时 bossHP 应为 0，实际 ${team.bossHP}`);
        }
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

        for (const [idx, p] of team.players.entries()) {
          // role 白名单
          if (!VALID_ROLES.includes(p.role)) {
            fail(state, `${teamPrefix} 玩家 role = "${p.role}" 不在 [${VALID_ROLES.join(", ")}] 中`);
          } else if (ROLE_ORDER[idx] && p.role !== ROLE_ORDER[idx]) {
            // 位置顺序：2T / 2H / 4DPS
            fail(state, `${teamPrefix} players[${idx}].role = "${p.role}"，按 2T/2H/4DPS 顺序应为 "${ROLE_ORDER[idx]}"`);
          }

          // job 白名单（21 职业）+ 与 role 对应
          if (!p.job || !VALID_JOBS.includes(p.job)) {
            fail(state, `${teamPrefix} 玩家 job = "${p.job}" 不在 21 职业白名单中`);
          } else if (VALID_ROLES.includes(p.role) && !(JOB_ROLES[p.role] ?? []).includes(p.job)) {
            fail(state, `${teamPrefix} 玩家 job = "${p.job}" 与 role = "${p.role}" 不对应`);
          }

          // stream：http(s) + 域名白名单 + 与 streaming 一致
          if (typeof p.stream === "string" && p.stream !== "#") {
            const hostname = hostnameOf(p.stream);
            if (hostname === null) {
              fail(state, `${teamPrefix} 玩家 stream = "${p.stream}" 不是合法的 http(s) URL`);
            } else if (!domainAllowed(hostname, STREAM_DOMAINS)) {
              fail(state, `${teamPrefix} 玩家 stream 域名 "${hostname}" 不在白名单 [${STREAM_DOMAINS.join(", ")}] 中`);
            }
          }
          if (p.streaming === true && p.stream === "#") {
            fail(state, `${teamPrefix} 玩家 streaming=true 但 stream 仍为 "#"`);
          }

          if (typeof p.streaming !== "boolean") {
            fail(state, `${teamPrefix} 玩家 streaming 不是 boolean`);
          }
          if (typeof p.isLive !== "undefined" && typeof p.isLive !== "boolean") {
            fail(state, `${teamPrefix} 玩家 isLive 不是 boolean`);
          }
        }
      }

      // team.isLive：boolean + == players[] 任一 streaming
      if (typeof team.isLive !== "boolean") {
        fail(state, `${teamPrefix} isLive 不是 boolean`);
      } else if (Array.isArray(team.players)) {
        const anyStreaming = team.players.some((p) => p.streaming === true);
        if (team.isLive !== anyStreaming) {
          fail(state, `${teamPrefix} isLive=${team.isLive} 与 players[].streaming 不一致（应=${anyStreaming}）`);
        }
      }
    }

    // 4h. status ↔ phase 关联性
    if (meta && dungeons && dungeons.length > 0) {
      const status = meta.status;
      if (status === "ended") {
        const lastDungeonId = dungeonIds[dungeonIds.length - 1]!;
        const expectedPhase = dungeons.length === 1 ? "CLEAR" : `${lastDungeonId}-CLEAR`;
        for (const team of teams) {
          if (team.phase !== expectedPhase) {
            fail(state, `[${team.name || team.id}] meta.status="ended" 时所有队伍 phase 必须是 "${expectedPhase}"，但 rank ${team.rank} 是 "${team.phase}"`);
          }
        }
        ok(`status="ended" 校验通过：所有队伍 phase = "${expectedPhase}"`);
      } else if (status === "upcoming") {
        const firstDungeonId = dungeonIds[0]!;
        const expectedPhase = dungeons.length === 1 ? PHASE_ORDER[0]! : `${firstDungeonId}-${PHASE_ORDER[0]}`;
        for (const team of teams) {
          if (team.phase !== expectedPhase) {
            fail(state, `[${team.name || team.id}] meta.status="upcoming" 时所有队伍 phase 必须是 "${expectedPhase}"，但 rank ${team.rank} 是 "${team.phase}"`);
          }
        }
        ok(`status="upcoming" 校验通过：所有队伍 phase = "${expectedPhase}"`);
      }
    }

    // 4i. 副本顺序推进：副本 N+1 出现 → 副本 N 必须全 CLEAR
    if (
      phaseIndexByRank.size > 0 &&
      dungeons &&
      dungeons.length > 1 &&
      meta &&
      meta.status === "live"
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

    // 4j. rank 与 phase 进度一致：rank 升序 → (副本序号, 阶段序号) 非递增
    if (dungeons && dungeons.length > 0) {
      const progress = teams
        .filter((t) => typeof t.phase === "string")
        .map((t) => {
          const phase = dungeons.length === 1 && !t.phase.includes("-") ? `${dungeonIds[0]}-${t.phase}` : t.phase;
          const dashIdx = phase.indexOf("-");
          const did = phase.slice(0, dashIdx);
          const stage = phase.slice(dashIdx + 1);
          return { rank: t.rank, d: dungeonIds.indexOf(did), s: PHASE_ORDER.indexOf(stage) };
        })
        .filter((p) => p.d >= 0 && p.s >= 0)
        .sort((a, b) => a.rank - b.rank);
      for (let i = 1; i < progress.length; i++) {
        const prev = progress[i - 1]!;
        const cur = progress[i]!;
        if (cur.d > prev.d || (cur.d === prev.d && cur.s > prev.s)) {
          fail(state, `rank 与 phase 进度不一致：rank ${prev.rank} 进度落后于 rank ${cur.rank}`);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 阶段 5：news[] / broadcasters[] / notices[] / sponsors[] 校验
  // ══════════════════════════════════════════════════════════════

  console.log(`\n${BOLD}── 5. news[] / broadcasters[] / notices[] / sponsors[] 校验 ──${RESET}`);

  // 5a. news[]：time 格式/降序 + id 格式/唯一 + text 规则
  if (!Array.isArray(RACE_DATA.news)) {
    fail(state, "news 不是数组");
  } else {
    ok(`共 ${RACE_DATA.news.length} 条新闻`);
    const seenNewsIds = new Set<string>();
    // 开赛时间（用于校验 news.time 不得早于它）；缺失/占位 "-" 时跳过
    const startTs =
      meta && typeof meta.startTime === "string" && meta.startTime !== "-" ? Date.parse(meta.startTime) : NaN;
    let prevTs: number | null = null;
    let timesOk = true;
    for (const item of RACE_DATA.news) {
      const np = `[news ${item.id ?? "?"}]`;

      // id：^n\d+$ + 唯一
      if (!/^n\d+$/.test(String(item.id ?? ""))) {
        fail(state, `${np} id 应为 ^n\\d+$`);
      } else if (seenNewsIds.has(item.id!)) {
        fail(state, `${np} id 重复：${item.id}`);
      } else {
        seenNewsIds.add(item.id!);
      }

      // time：ISO 8601 含时区 + 降序
      if (typeof item.time !== "string" || !ISO_INSTANT.test(item.time)) {
        fail(state, `${np} time = "${item.time}" 应为 ISO 8601 且含时区（Z 或 ±HH:MM）`);
        timesOk = false;
        continue;
      }
      // 按解析后的瞬时降序（time 可能混用 Z / 偏移，不能直接字符串比较）
      const ts = Date.parse(item.time);
      if (prevTs !== null && ts > prevTs) {
        fail(state, `${np} 未按 time 降序：${new Date(prevTs).toISOString()} → ${item.time}`);
        timesOk = false;
      }
      // time 不得早于 meta.startTime
      if (!Number.isNaN(startTs) && ts < startTs) {
        fail(state, `${np} time = "${item.time}" 早于 meta.startTime = "${meta?.startTime}"`);
        timesOk = false;
      }
      prevTs = ts;

      // text：必填、≤50 字、禁换行/占位符、中文标点结尾
      const text = typeof item.text === "string" ? item.text : "";
      if (text === "") {
        fail(state, `${np} text 必填非空`);
      } else {
        if ([...text].length > 50) fail(state, `${np} text 长度 ${[...text].length} 超过 50`);
        if (text.includes("\n") || text.includes("\r")) fail(state, `${np} text 禁止换行`);
        if (/[[\]]/.test(text)) fail(state, `${np} text 禁止占位符 [ ]`);
        if (!/[。！？…]$/.test(text)) fail(state, `${np} text 应以中文标点结尾`);
      }
    }
    if (timesOk) ok("news[] time 格式合法且按时间降序");
  }

  // 5b. broadcasters[]：platform/url + id 格式/唯一 + name 必填/长度/唯一 + note 长度
  if (!Array.isArray(RACE_DATA.broadcasters)) {
    fail(state, "broadcasters 不是数组");
  } else {
    ok(`共 ${RACE_DATA.broadcasters.length} 个转播方`);
    const seenBIds = new Set<string>();
    const seenBNames = new Set<string>();
    for (const b of RACE_DATA.broadcasters) {
      const bp = `[broadcaster ${b.id || b.name || "?"}]`;

      // id：^b\d+$ + 唯一
      if (!/^b\d+$/.test(String(b.id ?? ""))) {
        fail(state, `${bp} id 应为 ^b\\d+$`);
      } else if (seenBIds.has(b.id!)) {
        fail(state, `${bp} id 重复：${b.id}`);
      } else {
        seenBIds.add(b.id!);
      }

      // name：必填非空 + ≤20 + 唯一
      if (typeof b.name !== "string" || b.name === "") {
        fail(state, `${bp} name 必填非空`);
      } else if ([...b.name].length > 20) {
        fail(state, `${bp} name 长度 ${[...b.name].length} 超过 20`);
      } else if (seenBNames.has(b.name)) {
        fail(state, `${bp} name 重复：${b.name}`);
      } else {
        seenBNames.add(b.name);
      }

      // platform 枚举（由 PLATFORM_DOMAINS 的 key 派生）
      if (!VALID_PLATFORMS.includes(b.platform ?? "")) {
        fail(state, `${bp} platform = "${b.platform}" 不在 [${VALID_PLATFORMS.join(", ")}] 中`);
      }

      // url：允许 "#" 占位；否则 http(s) 且域名与 platform 一致
      if (typeof b.url === "string" && b.url !== "#") {
        const hostname = hostnameOf(b.url);
        if (hostname === null) {
          fail(state, `${bp} url = "${b.url}" 不是合法的 http(s) URL`);
        } else if (VALID_PLATFORMS.includes(b.platform ?? "")) {
          const allow = PLATFORM_DOMAINS[b.platform!] ?? [];
          if (!domainAllowed(hostname, allow)) {
            fail(state, `${bp} url 域名 "${hostname}" 与 platform "${b.platform}" 不匹配（允许：${allow.join(", ")}）`);
          }
        }
      }

      // note：非必填；填写时 ≤60
      if (typeof b.note === "string" && b.note !== "" && [...b.note].length > 60) {
        fail(state, `${bp} note 长度 ${[...b.note].length} 超过 60`);
      }
    }
  }

  // 5c. notices[]：字符串数组，非空、≥1 条、每条 ≤100 字、去重
  if (!Array.isArray(RACE_DATA.notices)) {
    fail(state, "notices 不是数组");
  } else {
    if (RACE_DATA.notices.length < 1) {
      fail(state, "notices 至少需要 1 条");
    }
    const seenNotices = new Set<string>();
    for (const n of RACE_DATA.notices) {
      if (typeof n !== "string" || n === "") {
        fail(state, "notices 每项应为非空字符串");
        continue;
      }
      if ([...n].length > 100) fail(state, `notices 条目长度 ${[...n].length} 超过 100 字：${n.slice(0, 12)}…`);
      if (seenNotices.has(n)) fail(state, `notices 存在重复条目：${n.slice(0, 12)}…`);
      seenNotices.add(n);
    }
  }

  // 5d. sponsors[]：name ≤20、desc ≤100
  if (!Array.isArray(RACE_DATA.sponsors)) {
    fail(state, "sponsors 不是数组");
  } else {
    for (const s of RACE_DATA.sponsors as Array<{ name?: string; desc?: string }>) {
      if (typeof s.name === "string" && [...s.name].length > 20) {
        fail(state, `sponsors name 长度 ${[...s.name].length} 超过 20：${s.name}`);
      }
      if (typeof s.desc === "string" && [...s.desc].length > 100) {
        fail(state, `sponsors desc 长度 ${[...s.desc].length} 超过 100：${s.name ?? ""}`);
      }
    }
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
    if (placeholderPlayerCount > 0 && meta && meta.status === "live") {
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
