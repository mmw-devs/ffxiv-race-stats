// FFXIV 高难首杀竞速 — 运营仓库数据校验白名单
// 运营 agent 维护，content/* 分支可改。运营数据请修改 public/data.json。
//
// 此文件被 scripts/validate-data.js 引用，作为值域校验的单一真相来源。
// 新增合法值请修改此处，校验逻辑自动同步。

const PHASE_ORDER = ["P1", "P2", "P3", "P4", "CLEAR"];

const VALID_REGIONS = ["JP", "NA", "EU", "OC", "CN", "KR"];
const VALID_ROLES = ["tank", "healer", "dps"];
const VALID_STATUSES = ["upcoming", "live", "ended"];
const REQUIRED_TOP_KEYS = ["meta", "teams", "news", "broadcasters", "notices", "sponsors"];
const TEAM_PLAYER_COUNT = 8;
const SCHEMA_VERSION = 1;

// 供 Runtime 复用同一份值域定义；validate-data.js 的 VM 加载环境没有 module，故须兼容。
if (typeof module !== "undefined") {
  module.exports = {
    PHASE_ORDER,
    VALID_REGIONS,
    VALID_ROLES,
    VALID_STATUSES,
    REQUIRED_TOP_KEYS,
    TEAM_PLAYER_COUNT,
    SCHEMA_VERSION,
  };
}
