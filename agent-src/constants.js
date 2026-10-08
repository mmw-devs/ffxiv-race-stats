// FFXIV 高难首杀竞速 — 运营仓库数据校验白名单
// 运营 agent 维护，content/* 分支可改。运营数据请修改 public/data.json。
//
// 此文件被 scripts/validate-data.ts 引用，作为值域校验的单一真相来源。
// 新增合法值请修改此处，校验逻辑自动同步。

const PHASE_ORDER = ["P1", "P2", "P3", "P4", "CLEAR"];

const VALID_REGIONS = ["JP", "NA", "EU", "OC", "CN", "KR"];
const VALID_ROLES = ["tank", "healer", "dps"];
const VALID_STATUSES = ["upcoming", "live", "ended"];
const REQUIRED_TOP_KEYS = ["meta", "teams", "news", "broadcasters", "notices", "sponsors"];
const TEAM_PLAYER_COUNT = 8;
const SCHEMA_VERSION = 1;

// 职业（job）与角色构成
const JOB_ROLES = {
  tank: ["PLD", "WAR", "DRK", "GNB"],
  healer: ["WHM", "SCH", "AST", "SGE"],
  dps: ["MNK", "DRG", "NIN", "SAM", "RPR", "BRD", "MCH", "DNC", "BLM", "SMN", "RDM", "VPR", "PCT"],
};

// 直播平台域名
const PLATFORM_DOMAINS = {
  bilibili: ["bilibili.com", "b23.tv"],
  douyin: ["douyin.com", "iesdouyin.com"],
  douyu: ["douyu.com", "douyu.tv"],
  huya: ["huya.com"],
  twitch: ["twitch.tv"],
  youtube: ["youtube.com", "youtu.be"],
};
