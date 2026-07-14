// FFXIV 高难首杀竞速聚合平台 — 共享数据层
// 运营侧（PI Agent）维护，content/* 分支唯一写入目标。
// 开发者修改数据结构请改 schema/ 和 constants.js，勿改此文件。
// 后期切换动态数据源时不改 UI 结构，只需替换此文件。

const RACE_DATA = {
  meta: {
    eventName: "[当届赛事名称]",
    edition: "[第X期]",
    dungeon: "[副本名称]",
    boss: "[Boss 名称]",
    dataCenter: "[数据中心]",
    startTime: "2026-06-10T12:00:00Z",
    status: "live" // "upcoming" | "live" | "ended"
  },

  teams: [
    {
      id: "t1", name: "[队伍名 1]", rank: 1, bossHP: 18.3, phase: "P4", region: "JP", isLive: true,
      players: [
        { job: "PLD", role: "tank", stream: "#", streaming: true },
        { job: "WAR", role: "tank", stream: "#", streaming: true },
        { job: "WHM", role: "healer", stream: "#", streaming: true },
        { job: "SCH", role: "healer", stream: "#", streaming: false },
        { job: "DRG", role: "dps", stream: "#", streaming: true },
        { job: "NIN", role: "dps", stream: "#", streaming: true },
        { job: "BLM", role: "dps", stream: "#", streaming: false },
        { job: "BRD", role: "dps", stream: "#", streaming: true }
      ]
    },
    {
      id: "t2", name: "[队伍名 2]", rank: 2, bossHP: 20.0, phase: "P4", region: "NA", isLive: true,
      players: [
        { job: "DRK", role: "tank", stream: "#", streaming: true },
        { job: "GNB", role: "tank", stream: "#", streaming: false },
        { job: "AST", role: "healer", stream: "#", streaming: true },
        { job: "SGE", role: "healer", stream: "#", streaming: true },
        { job: "SAM", role: "dps", stream: "#", streaming: false },
        { job: "RPR", role: "dps", stream: "#", streaming: true },
        { job: "SMN", role: "dps", stream: "#", streaming: true },
        { job: "DNC", role: "dps", stream: "#", streaming: false }
      ]
    },
    {
      id: "t3", name: "[队伍名 3]", rank: 3, bossHP: 62.0, phase: "P4", region: "JP", isLive: true,
      players: [
        { job: "PLD", role: "tank", stream: "#", streaming: false },
        { job: "DRK", role: "tank", stream: "#", streaming: true },
        { job: "WHM", role: "healer", stream: "#", streaming: true },
        { job: "AST", role: "healer", stream: "#", streaming: true },
        { job: "MNK", role: "dps", stream: "#", streaming: false },
        { job: "DRG", role: "dps", stream: "#", streaming: true },
        { job: "RDM", role: "dps", stream: "#", streaming: false },
        { job: "MCH", role: "dps", stream: "#", streaming: true }
      ]
    },
    {
      id: "t4", name: "[队伍名 4]", rank: 4, bossHP: 90.0, phase: "P4", region: "EU", isLive: true,
      players: [
        { job: "WAR", role: "tank", stream: "#", streaming: true },
        { job: "GNB", role: "tank", stream: "#", streaming: true },
        { job: "SCH", role: "healer", stream: "#", streaming: false },
        { job: "SGE", role: "healer", stream: "#", streaming: true },
        { job: "NIN", role: "dps", stream: "#", streaming: true },
        { job: "SAM", role: "dps", stream: "#", streaming: false },
        { job: "BLM", role: "dps", stream: "#", streaming: true },
        { job: "BRD", role: "dps", stream: "#", streaming: false }
      ]
    },
    {
      id: "t5", name: "[队伍名 5]", rank: 5, bossHP: 52.1, phase: "P3", region: "NA", isLive: false,
      players: [
        { job: "DRK", role: "tank", stream: "#", streaming: true },
        { job: "PLD", role: "tank", stream: "#", streaming: false },
        { job: "AST", role: "healer", stream: "#", streaming: true },
        { job: "WHM", role: "healer", stream: "#", streaming: false },
        { job: "RPR", role: "dps", stream: "#", streaming: true },
        { job: "VPR", role: "dps", stream: "#", streaming: true },
        { job: "SMN", role: "dps", stream: "#", streaming: false },
        { job: "DNC", role: "dps", stream: "#", streaming: true }
      ]
    },
    {
      id: "t6", name: "[队伍名 6]", rank: 6, bossHP: 67.5, phase: "P2", region: "EU", isLive: true,
      players: [
        { job: "GNB", role: "tank", stream: "#", streaming: false },
        { job: "WAR", role: "tank", stream: "#", streaming: true },
        { job: "SGE", role: "healer", stream: "#", streaming: true },
        { job: "SCH", role: "healer", stream: "#", streaming: false },
        { job: "DRG", role: "dps", stream: "#", streaming: true },
        { job: "MNK", role: "dps", stream: "#", streaming: true },
        { job: "RDM", role: "dps", stream: "#", streaming: false },
        { job: "MCH", role: "dps", stream: "#", streaming: true }
      ]
    },
    {
      id: "t7", name: "[队伍名 7]", rank: 7, bossHP: 78.4, phase: "P2", region: "JP", isLive: false,
      players: [
        { job: "PLD", role: "tank", stream: "#", streaming: true },
        { job: "GNB", role: "tank", stream: "#", streaming: false },
        { job: "WHM", role: "healer", stream: "#", streaming: false },
        { job: "SGE", role: "healer", stream: "#", streaming: true },
        { job: "SAM", role: "dps", stream: "#", streaming: false },
        { job: "NIN", role: "dps", stream: "#", streaming: true },
        { job: "BLM", role: "dps", stream: "#", streaming: true },
        { job: "BRD", role: "dps", stream: "#", streaming: false }
      ]
    },
    {
      id: "t8", name: "[队伍名 8]", rank: 8, bossHP: 21.0, phase: "P1", region: "EU", isLive: true,
      players: [
        { job: "DRK", role: "tank", stream: "#", streaming: true },
        { job: "WAR", role: "tank", stream: "#", streaming: true },
        { job: "AST", role: "healer", stream: "#", streaming: false },
        { job: "SCH", role: "healer", stream: "#", streaming: true },
        { job: "VPR", role: "dps", stream: "#", streaming: false },
        { job: "RPR", role: "dps", stream: "#", streaming: true },
        { job: "SMN", role: "dps", stream: "#", streaming: false },
        { job: "DNC", role: "dps", stream: "#", streaming: true }
      ]
    },
    {
      id: "t9", name: "[队伍名 9]", rank: 9, bossHP: 98.6, phase: "P1", region: "OC", isLive: false,
      players: [
        { job: "DRK", role: "tank", stream: "#", streaming: false },
        { job: "GNB", role: "tank", stream: "#", streaming: true },
        { job: "WHM", role: "healer", stream: "#", streaming: false },
        { job: "SGE", role: "healer", stream: "#", streaming: true },
        { job: "MNK", role: "dps", stream: "#", streaming: false },
        { job: "VPR", role: "dps", stream: "#", streaming: true },
        { job: "BLM", role: "dps", stream: "#", streaming: false },
        { job: "MCH", role: "dps", stream: "#", streaming: false }
      ]
    },
    {
      id: "t10", name: "[队伍名 10]", rank: 10, bossHP: 100.0, phase: "P1", region: "NA", isLive: false,
      players: [
        { job: "PLD", role: "tank", stream: "#", streaming: false },
        { job: "WAR", role: "tank", stream: "#", streaming: false },
        { job: "AST", role: "healer", stream: "#", streaming: true },
        { job: "SCH", role: "healer", stream: "#", streaming: false },
        { job: "DRG", role: "dps", stream: "#", streaming: true },
        { job: "NIN", role: "dps", stream: "#", streaming: false },
        { job: "RDM", role: "dps", stream: "#", streaming: false },
        { job: "DNC", role: "dps", stream: "#", streaming: false }
      ]
    },
    { id: "t11", name: "[队伍名 11]", rank: 11, bossHP: 100.0, phase: "P1", region: "EU", isLive: false,
      players: [
        { job: "GNB", role: "tank", stream: "#", streaming: false }, { job: "DRK", role: "tank", stream: "#", streaming: false },
        { job: "SGE", role: "healer", stream: "#", streaming: false }, { job: "AST", role: "healer", stream: "#", streaming: false },
        { job: "RPR", role: "dps", stream: "#", streaming: false }, { job: "VPR", role: "dps", stream: "#", streaming: false },
        { job: "SMN", role: "dps", stream: "#", streaming: false }, { job: "BRD", role: "dps", stream: "#", streaming: false }
      ]
    },
    { id: "t12", name: "[队伍名 12]", rank: 12, bossHP: 100.0, phase: "P1", region: "JP", isLive: false,
      players: [
        { job: "PLD", role: "tank", stream: "#", streaming: false }, { job: "WAR", role: "tank", stream: "#", streaming: false },
        { job: "WHM", role: "healer", stream: "#", streaming: false }, { job: "SCH", role: "healer", stream: "#", streaming: false },
        { job: "MNK", role: "dps", stream: "#", streaming: false }, { job: "DRG", role: "dps", stream: "#", streaming: false },
        { job: "BLM", role: "dps", stream: "#", streaming: false }, { job: "MCH", role: "dps", stream: "#", streaming: false }
      ]
    },
    { id: "t13", name: "[队伍名 13]", rank: 13, bossHP: 100.0, phase: "P1", region: "NA", isLive: false,
      players: [
        { job: "DRK", role: "tank", stream: "#", streaming: false }, { job: "GNB", role: "tank", stream: "#", streaming: false },
        { job: "AST", role: "healer", stream: "#", streaming: false }, { job: "SGE", role: "healer", stream: "#", streaming: false },
        { job: "SAM", role: "dps", stream: "#", streaming: false }, { job: "NIN", role: "dps", stream: "#", streaming: false },
        { job: "RDM", role: "dps", stream: "#", streaming: false }, { job: "DNC", role: "dps", stream: "#", streaming: false }
      ]
    },
    { id: "t14", name: "[队伍名 14]", rank: 14, bossHP: 100.0, phase: "P1", region: "OC", isLive: false,
      players: [
        { job: "WAR", role: "tank", stream: "#", streaming: false }, { job: "PLD", role: "tank", stream: "#", streaming: false },
        { job: "SCH", role: "healer", stream: "#", streaming: false }, { job: "WHM", role: "healer", stream: "#", streaming: false },
        { job: "DRG", role: "dps", stream: "#", streaming: false }, { job: "VPR", role: "dps", stream: "#", streaming: false },
        { job: "SMN", role: "dps", stream: "#", streaming: false }, { job: "BRD", role: "dps", stream: "#", streaming: false }
      ]
    },
    { id: "t15", name: "[队伍名 15]", rank: 15, bossHP: 100.0, phase: "P1", region: "EU", isLive: false,
      players: [
        { job: "GNB", role: "tank", stream: "#", streaming: false }, { job: "DRK", role: "tank", stream: "#", streaming: false },
        { job: "WHM", role: "healer", stream: "#", streaming: false }, { job: "AST", role: "healer", stream: "#", streaming: false },
        { job: "RPR", role: "dps", stream: "#", streaming: false }, { job: "MNK", role: "dps", stream: "#", streaming: false },
        { job: "BLM", role: "dps", stream: "#", streaming: false }, { job: "MCH", role: "dps", stream: "#", streaming: false }
      ]
    }
  ],

  news: [
    { id: "n1", time: "14:32:07", text: "[队伍名 1] 进入 P4，Boss HP 剩余 18%", urgent: true },
    { id: "n2", time: "14:28:15", text: "[队伍名 2] 突破 P3，当前 Boss HP 24%", urgent: false },
    { id: "n3", time: "14:15:42", text: "[队伍名 3] P3 Boss 血量首次压入 35% 以下", urgent: false },
    { id: "n4", time: "13:58:03", text: "[队伍名 4] 率先进入 P3 阶段", urgent: false },
    { id: "n5", time: "13:30:00", text: "赛事第 2 日 — 8 支队伍全部进入副本", urgent: false }
  ],

  broadcasters: [
    { id: "b1", name: "[转播主播 1]", platform: "[平台名]", url: "#", note: "官方合作转播" },
    { id: "b2", name: "[转播主播 2]", platform: "[平台名]", url: "#", note: "特邀解说" },
    { id: "b3", name: "[转播主播 3]", platform: "[平台名]", url: "#", note: "多视角切换" }
  ],

  notices: [],

  sponsors: []
};
