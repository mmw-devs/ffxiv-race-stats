#!/usr/bin/env tsx
/**
 * get-jit-pem.ts — JIT Installation Token 申请脚本
 *
 * 流程:
 *   1. 预检: 开发者 gh CLI 已登录
 *   2. 触发 race-ops-jit-pem workflow
 *   3. 轮询直到 workflow 完成
 *   4. 从日志中提取 installation token
 *   5. 验证 token 身份（用 token 调 /app API）
 *   6. 写入 env 文件供 /dev 流程 source
 *
 * 注意: GitHub API 不支持自定义短 TTL 的 installation token (强制 1 小时).
 *       也不支持 POST /app/private_keys 创建新 PEM key.
 *       因此本流程铸造的是 installation token, 不是 PEM.
 *       开发者拿到 token 后用 GH_TOKEN 环境变量, 1 小时后自动失效.
 *
 * 用法:
 *   tsx .pi/scripts/get-jit-pem.ts [purpose]
 *
 * 示例:
 *   tsx .pi/scripts/get-jit-pem.ts "测试 PI Agent content-pr Skill"
 */

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = "mmw-devs/ffxiv-race-stats";
const WORKFLOW = "race-ops: JIT PEM Issuance";
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_SECONDS = 2;

// ── 参数解析 ──────────────────────────────────────────────────────
const PURPOSE = process.argv[2] || "developer JIT test in /dev";

// ── 工具函数 ──────────────────────────────────────────────────────
function exec(args: string[]): { stdout: string; status: number } {
  const result = spawnSync("gh", args, {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    stdout: (result.stdout || "").toString(),
    status: result.status ?? 1,
  };
}

// ── 主流程 ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 申请 JIT Installation Token ...\n`);
  console.log(`   仓库:   ${REPO}`);
  console.log(`   用途:   ${PURPOSE}\n`);
  console.log(`   ⚠️  GitHub API 限制: token 强制 1 小时 TTL\n`);

  // 1. 预检: gh CLI 已登录
  const authCheck = exec(["auth", "status"]);
  if (authCheck.status !== 0) {
    console.error("❌ gh CLI 未登录");
    console.error("   请先执行: gh auth login");
    process.exit(1);
  }

  const userResult = exec(["api", "user", "-q", ".login"]);
  const currentUser = userResult.stdout.trim() || "unknown";
  console.log(`   触发者: ${currentUser}\n`);

  // 2. 触发 workflow (通过 API 支持 ref 参数)
  console.log("⏳ 触发 workflow: race-ops-jit-pem.yml ...");
  // 从当前 git 分支推断 ref
  const refResult = exec(["repo", "view", REPO, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]);
  // 实际触发使用 feature 分支 (workflow 在那里)
  const apiResult = spawnSync("gh", [
    "api", "-X", "POST",
    `/repos/${REPO}/actions/workflows/race-ops-jit-pem.yml/dispatches`,
    "-f", "ref=feature/jit-pem-workflow",
    "-f", `inputs[purpose]=${PURPOSE}`,
  ], { stdio: ["inherit", "pipe", "pipe"], encoding: "utf-8" });

  if (apiResult.status !== 0) {
    const err = (apiResult.stderr || "").toString();
    console.error("❌ 触发 workflow 失败");
    console.error(`   ${err}`);
    process.exit(1);
  }

  // 3. 轮询等待完成
  console.log("⏳ 等待 token 签发（最多 2 分钟）...");
  let attempts = 0;
  let completed = false;
  let runId = "";
  while (attempts * POLL_INTERVAL_SECONDS < MAX_WAIT_SECONDS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));

    const status = exec([
      "run", "list",
      "--repo", REPO,
      "--workflow", "race-ops-jit-pem.yml",
      "--limit", "1",
      "--json", "databaseId,status",
      "-q", ".[] | \"\\(.databaseId)|\\(.status)\"",
    ]);

    const line = status.stdout.trim().split("\n")[0];
    if (line && line.includes("|")) {
      const [id, s] = line.split("|");
      runId = id;
      if (s === "completed") {
        completed = true;
        break;
      }
      if (s === "failed" || s === "cancelled") {
        console.error(`\n❌ workflow ${s}`);
        console.error(`   查看: https://github.com/${REPO}/actions/runs/${runId}`);
        process.exit(1);
      }
    }
    process.stdout.write(".");
    attempts++;
  }
  console.log("");

  if (!completed) {
    console.error(`\n❌ 超时`);
    console.error(`   查看: https://github.com/${REPO}/actions/runs/${runId}`);
    process.exit(1);
  }

  // 4. 提取 token
  console.log("⏳ 提取 token ...");
  const logsResult = exec(["run", "view", runId, "--repo", REPO, "--log"]);
  const logs = logsResult.stdout;

  // 匹配 export GH_TOKEN=...  (在 ║ 行之间)
  const tokenMatch = logs.match(/export GH_TOKEN=(ghs_[A-Za-z0-9_]+)/);
  if (!tokenMatch) {
    console.error("❌ 无法从日志中提取 token");
    console.error(`   手动查看: https://github.com/${REPO}/actions/runs/${runId}`);
    process.exit(1);
  }

  const token = tokenMatch[1];
  const expiresMatch = logs.match(/到期时间:\s+([0-9T:\-.Z]+)/);
  const expiresAt = expiresMatch ? expiresMatch[1] : "1 hour from now";

  // 5. 验证 token 身份
  console.log("⏳ 验证 token 身份 ...");
  const verifyResult = spawnSync("gh", [
    "api", "/app",
    "-H", `Authorization: Bearer ${token}`,
  ], { stdio: ["inherit", "pipe", "pipe"], encoding: "utf-8" });

  let appName = "unknown";
  try {
    const d = JSON.parse(verifyResult.stdout.toString());
    appName = d.name || "unknown";
  } catch {}

  // 6. 写 env 文件
  const envPath = "/tmp/race-ops-jit-env.sh";
  writeFileSync(
    envPath,
    `export GH_TOKEN="${token}"\nexport RACE_OPS_GH_TOKEN="${token}"\nexport JIT_EXPIRES_AT="${expiresAt}"\nexport JIT_RUN_ID="${runId}"\nexport JIT_APP_NAME="${appName}"\n`,
    { mode: 0o600 }
  );

  // 7. 输出结果
  console.log(`\n✅ JIT Token 已就绪\n`);
  console.log(`   Token:    ${token.substring(0, 20)}...`);
  console.log(`   App:      ${appName}`);
  console.log(`   到期:     ${expiresAt}`);
  console.log(`   Run:      https://github.com/${REPO}/actions/runs/${runId}\n`);

  console.log(`📋 供 /dev 流程 source:`);
  console.log(`   source ${envPath}\n`);

  console.log(`💡 测试 token:`);
  console.log(`   export GH_TOKEN="${token}"`);
  console.log(`   gh auth status`);
  console.log(`   gh pr list\n`);
}

main().catch((err) => {
  console.error("\n❌ JIT 流程异常:", (err as Error).message);
  process.exit(1);
});
