// FFXIV 高难首杀竞速聚合平台 — 运行时显示常量 + 数据校验白名单
// 开发者维护，feature/* / fix/* 可改。运营侧数据请修改 data.js。
//
// 此文件在 index.html 中先于 data.json 加载，同时被 validate-data.js 引用
// 作为值域校验的单一真相来源。

const PHASE_ORDER = ["P1", "P2", "P3", "P4", "CLEAR"];

const ROLE_COLORS = {
  tank:   "oklch(48% 0.12 255)",   // 蓝
  healer: "oklch(48% 0.12 170)",   // 青绿
  dps:    "oklch(48% 0.14 25)"     // 红
};

// ── 校验白名单 ──────────────────────────────────────────────
// 以下常量供 validate-data.js 使用，作为值域校验的单一真相来源。
// 新增合法值请修改此处，校验逻辑自动同步。

const VALID_REGIONS = ["JP", "NA", "EU", "OC", "CN", "KR"];
const VALID_ROLES = ["tank", "healer", "dps"];
const VALID_STATUSES = ["upcoming", "live", "ended"];
const REQUIRED_TOP_KEYS = ["meta", "teams", "news", "broadcasters", "notices", "sponsors"];
const TEAM_PLAYER_COUNT = 8;
const SCHEMA_VERSION = 1;
