#!/usr/bin/env node
"use strict";

/** content/updateTeam PR 的独立 OP_LOG + 真实 before/after 硬校验。 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parseLogFromMessage, validateLogStructure } = require("./op-log-schema.js");
const { validateUpdateTeamOpLog } = require("./update-team-op-log.js");

const root = path.resolve(__dirname, "..");
const baseRef = process.argv[2] || "origin/main";
// updateTeam 走新增严格路径；未迁移的人工 action 保留原有通用校验，避免范围外回归。
const probe = execSync(`git log --no-merges ${baseRef}..HEAD --format=%B%x00`, { cwd: root, encoding: "utf8" })
  .split("\0").filter(Boolean).map(parseLogFromMessage).filter(Boolean);
if (probe.some((log) => log.action !== "updateTeam")) require("./validate-op-log-legacy.js");
function fail(message) { console.error(`::error::${message}`); process.exitCode = 1; }
function readBase() { return JSON.parse(execSync(`git show ${baseRef}:public/data.json`, { cwd: root, encoding: "utf8" })); }

const allowlist = (process.env.OPS_BASE_ALLOWED_OPEN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
if (allowlist.length === 0) fail("OPS_BASE_ALLOWED_OPEN_IDS 未配置；CI 拒绝信任任意 operator");
let raw = "";
try { raw = execSync(`git log --no-merges ${baseRef}..HEAD --format=%B%x00`, { cwd: root, encoding: "utf8" }); }
catch (error) { fail(`无法读取提交日志：${error.message}`); }
const logs = raw.split("\0").filter(Boolean).map(parseLogFromMessage).filter(Boolean);
if (logs.length !== 1) fail(`updateTeam content PR 必须恰有一个结构化 OP_LOG，实际为 ${logs.length}`);
const log = logs[0];
const structure = validateLogStructure(log);
if (!structure.valid) for (const item of structure.errors) fail(`OP_LOG 结构错误：${item}`);
let baseline, candidate;
try { baseline = readBase(); candidate = JSON.parse(fs.readFileSync(path.join(root, "public/data.json"), "utf8")); }
catch (error) { fail(`无法读取 before/after data.json：${error.message}`); }
if (!process.exitCode) {
  const result = validateUpdateTeamOpLog({ log, baseline, candidate, allowlist });
  if (!result.success) for (const item of result.errors) fail(`updateTeam 独立复核失败：${item}`);
  else console.log(`✓ updateTeam OP_LOG 与真实 diff 一致（${result.actualChanges.length} 项）`);
}
process.exitCode ||= 0;
