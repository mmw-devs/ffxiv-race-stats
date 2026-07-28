#!/usr/bin/env tsx
/**
 * get-jit-pem.ts — JIT PEM 申请脚本
 *
 * 流程:
 *   1. 预检: 开发者 gh CLI 已登录
 *   2. 触发 race-ops-jit-pem workflow
 *   3. 轮询直到 workflow 完成
 *   4. 从日志中提取 PEM（base64 形式）
 *   5. 解码并写入 /tmp 临时文件
 *   6. 输出 PEM_PATH / PEM_EXPIRES_AT 到指定 env 文件
 *
 * 用法:
 *   tsx .pi/scripts/get-jit-pem.ts [duration_minutes] [purpose]
 *
 * 示例:
 *   tsx .pi/scripts/get-jit-pem.ts 30 "测试 PI Agent content-pr Skill"
 *   tsx .pi/scripts/get-jit-pem.ts 5 "快速验证 PEM 铸造"
 *
 * 输出:
 *   - /tmp/race-ops-jit-{timestamp}.pem   (mode 600)
 *   - /tmp/race-ops-jit-env.sh            (供 /dev 流程 source)
 *
 * 不写入:
 *   - .pi/settings.json (JIT 凭证不持久化)
 */

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const REPO = "mmw-devs/ffxiv-race-stats";
const WORKFLOW = "race-ops: JIT PEM Issuance";
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_SECONDS = 2;

// ── 参数解析 ──────────────────────────────────────────────────────
const DURATION = process.argv[2] || "30";
const PURPOSE = process.argv[3] || "developer JIT test in /dev";

// 校验 duration
const VALID_DURATIONS = ["5", "15", "30"];
if (!VALID_DURATIONS.includes(DURATION)) {
  console.error(`❌ 无效的 duration: ${DURATION}`);
  console.error(`   有效值: ${VALID_DURATIONS.join(", ")}`);
  process.exit(1);
}

// ── 工具函数 ──────────────────────────────────────────────────────
function exec(args: string[], options: { capture?: boolean } = {}): { stdout: string; status: number } {
  const result = spawnSync("gh", args, {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    stdout: (result.stdout || "").toString(),
    status: result.status ?? 1,
  };
}

function run(args: string[]): void {
  const r = spawnSync("gh", args, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

// ── 主流程 ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔑 申请 ${DURATION} 分钟 JIT PEM ...\n`);
  console.log(`   仓库:   ${REPO}`);
  console.log(`   用途:   ${PURPOSE}\n`);

  // 1. 预检: gh CLI 已登录
  const authCheck = exec(["auth", "status"]);
  if (authCheck.status !== 0) {
    console.error("❌ gh CLI 未登录");
    console.error("   请先执行: gh auth login");
    process.exit(1);
  }

  // 提取当前 gh 用户名（用于日志）
  const userResult = exec(["api", "user", "-q", ".login"]);
  const currentUser = userResult.stdout.trim() || "unknown";
  console.log(`   触发者: ${currentUser}\n`);

  // 2. 触发 workflow
  console.log("⏳ 触发 workflow: race-ops-jit-pem.yml ...");
  const trigger = exec(
    [
      "workflow", "run", WORKFLOW,
      "--repo", REPO,
      "-f", `duration_minutes=${DURATION}`,
      "-f", `purpose=${PURPOSE}`,
      "--json", "databaseId",
      "-q", ".databaseId",
    ],
    { capture: true }
  );

  if (trigger.status !== 0 || !trigger.stdout.trim()) {
    console.error("❌ 触发 workflow 失败");
    console.error("   可能原因:");
    console.error("   1. 你对仓库没有 write 权限");
    console.error("   2. workflow 不存在或被禁用");
    console.error("   3. gh CLI 鉴权过期");
    process.exit(1);
  }

  const runId = trigger.stdout.trim();
  console.log(`✓ Workflow 已触发: run #${runId}\n`);

  // 3. 轮询等待完成
  console.log("⏳ 等待 PEM 签发（最多 2 分钟）...");
  let attempts = 0;
  let completed = false;
  while (attempts * POLL_INTERVAL_SECONDS < MAX_WAIT_SECONDS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));

    const status = exec(
      ["run", "view", runId, "--repo", REPO, "--json", "status", "-q", ".status"],
      { capture: true }
    );

    const s = status.stdout.trim();
    if (s === "completed") {
      completed = true;
      break;
    }
    if (s === "failed" || s === "cancelled") {
      console.error(`\n❌ workflow ${s}`);
      console.error(`   查看详情: https://github.com/${REPO}/actions/runs/${runId}`);
      process.exit(1);
    }
    process.stdout.write(".");
    attempts++;
  }
  console.log("");

  if (!completed) {
    console.error(`\n❌ 超时（${MAX_WAIT_SECONDS}s）workflow 未完成`);
    console.error(`   查看详情: https://github.com/${REPO}/actions/runs/${runId}`);
    process.exit(1);
  }

  // 4. 提取 PEM（从日志中）
  console.log("⏳ 提取 PEM ...");
  const logsResult = exec(["run", "view", runId, "--repo", REPO, "--log"], { capture: true });
  const logs = logsResult.stdout;

  // 匹配 PEM 块（base64 在 ║ 行之间）
  // 格式: ║   {PEM_B64}   ║
  const pemMatch = logs.match(/PEM \(base64[\s\S]*?\n║\s+([A-Za-z0-9+/=]+)\s+║/);
  if (!pemMatch) {
    console.error("❌ 无法从日志中提取 PEM");
    console.error("   可能 workflow 输出格式已变化");
    console.error(`   手动查看: https://github.com/${REPO}/actions/runs/${runId}`);
    process.exit(1);
  }

  const pemBase64 = pemMatch[1].trim();
  let pem: string;
  try {
    pem = Buffer.from(pemBase64, "base64").toString("utf-8");
  } catch (e) {
    console.error("❌ PEM base64 解码失败:", (e as Error).message);
    process.exit(1);
  }

  // 校验 PEM 格式
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(pem) || !/END (RSA )?PRIVATE KEY/.test(pem)) {
    console.error("❌ 提取的内容不是有效 PEM");
    console.error(`   预览: ${pem.substring(0, 100)}...`);
    process.exit(1);
  }

  // 5. 写入临时文件
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpPath = `/tmp/race-ops-jit-${timestamp}.pem`;
  writeFileSync(tmpPath, pem, { mode: 0o600 });
  const envPath = `/tmp/race-ops-jit-env.sh`;

  // 6. 提取 Key ID 和到期时间（用于显示）
  const keyIdMatch = logs.match(/Key ID:\s+(\S+)/);
  const keyId = keyIdMatch ? keyIdMatch[1] : "unknown";
  const expiresAt = new Date(Date.now() + parseInt(DURATION) * 60 * 1000).toISOString();

  // 7. 写 env 文件
  writeFileSync(
    envPath,
    `export PEM_PATH="${tmpPath}"\nexport PEM_EXPIRES_AT="${expiresAt}"\nexport JIT_KEY_ID="${keyId}"\nexport JIT_RUN_ID="${runId}"\n`,
    { mode: 0o600 }
  );

  // 8. 输出结果
  console.log(`\n✅ JIT PEM 已就绪\n`);
  console.log(`   路径:    ${tmpPath}`);
  console.log(`   Key ID:  ${keyId}`);
  console.log(`   到期:    ${expiresAt} (${DURATION} 分钟后)`);
  console.log(`   Run:     https://github.com/${REPO}/actions/runs/${runId}\n`);
  console.log(`⚠️  ${DURATION} 分钟后 GitHub 将自动吊销此 PEM`);
  console.log(`   即便本地保留文件, 也无法铸造有效 token\n`);

  console.log(`\n📋 供 /dev 流程 source:`);
  console.log(`   source ${envPath}\n`);

  console.log(`💡 测试 PEM 是否有效:`);
  console.log(`   export PEM_PATH="${tmpPath}"`);
  console.log(`   bash .pi/scripts/get-app-token.sh  # 尝试铸造 token\n`);
}

main().catch((err) => {
  console.error("\n❌ JIT 流程异常:", (err as Error).message);
  process.exit(1);
});
