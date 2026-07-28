#!/usr/bin/env tsx
/**
 * get-jit-pem.ts — JIT Installation Token 申请脚本
 *
 * 流程:
 *   1. 预检: 开发者 gh CLI 已登录
 *   2. 触发 race-ops-jit-pem workflow
 *   3. 轮询直到 workflow 完成
 *   4. 下载 jit-token artifact
 *   5. 解析 token 并 source 到环境
 *
 * 注意: GitHub API 不支持自定义短 TTL 的 installation token (强制 1 小时).
 *       也不支持 POST /app/private_keys 创建新 PEM key.
 *       拿到的是 1 小时有效的 installation token, 用 GH_TOKEN 环境变量使用.
 *
 * 用法:
 *   tsx .pi/scripts/get-jit-pem.ts [purpose]
 */

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "mmw-devs/ffxiv-race-stats";
const REF = "feature/jit-pem-workflow";
const ARTIFACT_NAME = "jit-token";
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_SECONDS = 2;
const DOWNLOAD_DIR = "/tmp/race-ops-jit-download";

const PURPOSE = process.argv[2] || "developer JIT test in /dev";

function exec(args: string[]): { stdout: string; status: number; stderr: string } {
  const result = spawnSync("gh", args, {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    stdout: (result.stdout || "").toString(),
    stderr: (result.stderr || "").toString(),
    status: result.status ?? 1,
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n🚀 申请 JIT Installation Token ...\n`);
  console.log(`   仓库:   ${REPO}`);
  console.log(`   用途:   ${PURPOSE}\n`);

  // 1. 预检
  const authCheck = exec(["auth", "status"]);
  if (authCheck.status !== 0) {
    console.error("❌ gh CLI 未登录，请执行 gh auth login");
    process.exit(1);
  }
  const userResult = exec(["api", "user", "-q", ".login"]);
  console.log(`   触发者: ${userResult.stdout.trim() || "unknown"}\n`);

  // 2. 触发 workflow
  console.log("⏳ 触发 workflow ...");
  const trigger = spawnSync("gh", [
    "api", "-X", "POST",
    `/repos/${REPO}/actions/workflows/race-ops-jit-pem.yml/dispatches`,
    "-f", `ref=${REF}`,
    "-f", `inputs[purpose]=${PURPOSE}`,
  ], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });

  if (trigger.status !== 0) {
    console.error("❌ 触发失败:", (trigger.stderr || "").toString());
    process.exit(1);
  }

  // 3. 轮询等待
  console.log("⏳ 等待 token 签发 ...");
  let runId = "";
  let completed = false;
  let attempts = 0;
  while (attempts * POLL_INTERVAL_SECONDS < MAX_WAIT_SECONDS) {
    await sleep(POLL_INTERVAL_SECONDS * 1000);
    const list = exec([
      "run", "list",
      "--repo", REPO,
      "--workflow", "race-ops-jit-pem.yml",
      "--limit", "1",
      "--json", "databaseId,status,conclusion",
      "-q", ".[] | {id: .databaseId, status: .status, conclusion: .conclusion}",
    ]);

    try {
      // gh -q 输出多个对象拼接，加 . 索引取第一个
      const lines = list.stdout.trim().split("\n");
      const m = lines[0]?.match(/"id":\s*(\d+)/);
      const sMatch = lines[0]?.match(/"status":\s*"(\w+)"/);
      if (m) runId = m[1];
      const status = sMatch?.[1];
      if (status === "completed") { completed = true; break; }
      if (status === "failed" || status === "cancelled") {
        console.error(`\n❌ workflow ${status}`);
        console.error(`   https://github.com/${REPO}/actions/runs/${runId}`);
        process.exit(1);
      }
    } catch {}
    process.stdout.write(".");
    attempts++;
  }
  console.log("");
  if (!completed) {
    console.error(`\n❌ 超时`);
    process.exit(1);
  }

  // 4. 下载 artifact
  console.log(`⏳ 下载 artifact (run #${runId}) ...`);
  if (existsSync(DOWNLOAD_DIR)) {
    spawnSync("rm", ["-rf", DOWNLOAD_DIR]);
  }
  mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const dl = spawnSync("gh", [
    "run", "download", runId,
    "--repo", REPO,
    "--name", ARTIFACT_NAME,
    "--dir", DOWNLOAD_DIR,
  ], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });

  if (dl.status !== 0) {
    console.error("❌ artifact 下载失败:", dl.stderr);
    process.exit(1);
  }

  const tokenFile = join(DOWNLOAD_DIR, "jit-token.txt");
  if (!existsSync(tokenFile)) {
    console.error(`❌ 找不到 token 文件: ${tokenFile}`);
    process.exit(1);
  }

  // 5. 解析 token
  const content = readFileSync(tokenFile, "utf-8");
  const tokenMatch = content.match(/^GH_TOKEN=(ghs_[A-Za-z0-9_]+)$/m);
  const expiresMatch = content.match(/^JIT_EXPIRES_AT=(.+)$/m);

  if (!tokenMatch) {
    console.error("❌ token 解析失败");
    console.error("   文件内容:", content);
    process.exit(1);
  }

  const token = tokenMatch[1];
  const expiresAt = expiresMatch?.[1]?.trim() || "1 hour from now";

  // 6. 验证 token
  console.log("⏳ 验证 token ...");
  const verify = spawnSync("gh", [
    "api", "/rate_limit",
    "-H", `Authorization: Bearer ${token}`,
    "-q", ".resources.core.remaining",
  ], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
  const remaining = verify.stdout.toString().trim();

  // 7. 写 env 文件
  const envPath = "/tmp/race-ops-jit-env.sh";
  writeFileSync(envPath,
    `export GH_TOKEN="${token}"\nexport RACE_OPS_GH_TOKEN="${token}"\nexport JIT_EXPIRES_AT="${expiresAt}"\nexport JIT_RUN_ID="${runId}"\n`,
    { mode: 0o600 }
  );

  // 8. 输出
  console.log(`\n✅ JIT Token 已就绪\n`);
  console.log(`   Token 前缀:  ${token.substring(0, 25)}...`);
  console.log(`   API 配额:    ${remaining || "verified"}`);
  console.log(`   到期:        ${expiresAt}`);
  console.log(`   Run:         https://github.com/${REPO}/actions/runs/${runId}\n`);

  console.log(`📋 供 /dev 流程 source:`);
  console.log(`   source ${envPath}\n`);

  console.log(`💡 测试 token:`);
  console.log(`   export GH_TOKEN="${token}"`);
  console.log(`   gh auth status\n`);
}

main().catch((err) => {
  console.error("\n❌ 异常:", (err as Error).message);
  process.exit(1);
});
