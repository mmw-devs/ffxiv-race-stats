#!/usr/bin/env tsx
/**
 * get-jit-pem.ts — JIT Installation Token 申请脚本
 *
 * 流程:
 *   1. 预检: 开发者 gh CLI 已登录
 *   2. 触发 race-ops-jit-pem workflow (使用当前分支, 失败则回退 main)
 *   3. 轮询直到 workflow 完成
 *   4. 下载 jit-token artifact
 *   5. 解析 token 写入 env 文件
 *   6. 用开发者自己的 gh 身份创建审计 issue (label: jit-audit)
 *
 * 用法:
 *   tsx .pi/scripts/get-jit-pem.ts [purpose]
 *
 * 注意:
 *   - GitHub API 不支持 < 1 小时 TTL (强制 1 小时)
 *   - POST /app/private_keys 也不支持, 只能铸造 installation token
 *   - 审计 issue 由开发者本人创建, 仓库管理员 review 所有 jit-audit issues
 */

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "mmw-devs/ffxiv-race-stats";
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

function getCurrentBranch(): string {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  });
  const branch = r.stdout?.toString().trim() || "";
  // 排除 detached HEAD (返回 "HEAD")
  if (branch && branch !== "HEAD") return branch;
  return "main";
}

function triggerWorkflow(ref: string, purpose: string): number {
  const r = spawnSync("gh", [
    "api", "-X", "POST",
    `/repos/${REPO}/actions/workflows/race-ops-jit-pem.yml/dispatches`,
    "-f", `ref=${ref}`,
    "-f", `inputs[purpose]=${purpose}`,
  ], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
  return r.status ?? 1;
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
  const currentUser = userResult.stdout.trim() || "unknown";
  console.log(`   触发者: ${currentUser}\n`);

  // 2. 触发 workflow (先当前分支, 失败回退 main)
  const currentBranch = getCurrentBranch();
  console.log(`⏳ 触发 workflow (ref: ${currentBranch}) ...`);
  let triggerStatus = triggerWorkflow(currentBranch, PURPOSE);
  if (triggerStatus !== 0 && currentBranch !== "main") {
    console.log(`   当前分支无 workflow, 回退 main ...`);
    triggerStatus = triggerWorkflow("main", PURPOSE);
  }
  if (triggerStatus !== 0) {
    console.error("❌ 触发失败");
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
      "--json", "databaseId,status",
      "-q", ".[] | \"\\(.databaseId)|\\(.status)\"",
    ]);

    const line = list.stdout.trim().split("\n")[0];
    if (line && line.includes("|")) {
      const [id, status] = line.split("|");
      runId = id;
      if (status === "completed") { completed = true; break; }
      if (status === "failed" || status === "cancelled") {
        console.error(`\n❌ workflow ${status}`);
        console.error(`   https://github.com/${REPO}/actions/runs/${runId}`);
        process.exit(1);
      }
    }
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
  const purposeFromArtifact = content.match(/^JIT_PURPOSE=(.+)$/m)?.[1]?.trim();

  if (!tokenMatch) {
    console.error("❌ token 解析失败");
    console.error("   文件内容:", content);
    process.exit(1);
  }

  const token = tokenMatch[1];
  const expiresAt = expiresMatch?.[1]?.trim() || "1 hour from now";
  const purposeFinal = purposeFromArtifact || PURPOSE;

  // 6. 写 env 文件
  const envPath = "/tmp/race-ops-jit-env.sh";
  writeFileSync(envPath,
    `export GH_TOKEN="${token}"\nexport RACE_OPS_GH_TOKEN="${token}"\nexport JIT_EXPIRES_AT="${expiresAt}"\nexport JIT_RUN_ID="${runId}"\n`,
    { mode: 0o600 }
  );

  // 7. 用开发者身份创建审计 issue (label: jit-audit)
  console.log("⏳ 创建审计 issue (用你的身份) ...");
  const nowIso = new Date().toISOString();
  const title = `🔑 [JIT] token issued to ${currentUser}`;
  const body = `## JIT Installation Token 申请审计

| 字段 | 值 |
|------|-----|
| **申请时间** | \`${nowIso}\` |
| **持有者** | @${currentUser} |
| **Token 类型** | installation (1h TTL) |
| **到期时间** | \`${expiresAt}\` |
| **用途** | ${purposeFinal} |
| **Run ID** | \`${runId}\` |
| **Run URL** | https://github.com/${REPO}/actions/runs/${runId} |
| **状态** | 🟢 活跃 |

---

*本 issue 由 ${currentUser} 通过 \`.pi/scripts/get-jit-pem.ts\` 自动创建。仓库管理员可审查所有 \`jit-audit\` issues。*

### 撤销方式

GitHub installation token 不支持提前撤销，1 小时后自动失效。如需立即撤销：
- 通知 Owner 在 race-ops-bot App 设置页 rotate keys
- 或修改 App 的 installation permissions`;

  const issueResult = exec([
    "issue", "create",
    "--repo", REPO,
    "--title", title,
    "--label", "jit-audit,race-ops",
    "--body", body,
  ]);

  let issueUrl = "(issue creation failed)";
  if (issueResult.status === 0) {
    issueUrl = issueResult.stdout.trim();
    console.log(`✓ 审计 issue 已创建: ${issueUrl}`);
  } else {
    console.warn(`⚠️  审计 issue 创建失败:`);
    console.warn(`   ${issueResult.stderr}`);
    console.warn(`   Token 仍有效, 但请手动创建 issue 留下审计记录`);
  }

  // 8. 输出
  console.log(`\n✅ JIT Token 已就绪\n`);
  console.log(`   Token 前缀:  ${token.substring(0, 25)}...`);
  console.log(`   到期:        ${expiresAt}`);
  console.log(`   Run:         https://github.com/${REPO}/actions/runs/${runId}`);
  console.log(`   Issue:       ${issueUrl}\n`);

  console.log(`📋 供 /dev 流程 source:`);
  console.log(`   source ${envPath}\n`);

  console.log(`💡 测试 token:`);
  console.log(`   export GH_TOKEN="${token}"`);
  console.log(`   gh auth status`);
  console.log(`   gh pr list\n`);
}

main().catch((err) => {
  console.error("\n❌ 异常:", (err as Error).message);
  process.exit(1);
});
