/**
 * lark-bot extension — 按需启停 lark-bot
 *
 * 默认不自动启动。需在 settings.json 中设置 larkBot.autoStart = true 才会随 pi 启动。
 * 也可手动启动：tsx .pi/scripts/lark-bot.ts &
 */

import { spawn, ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 基于扩展文件自身位置推导项目根目录（不依赖 process.cwd()）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..", "..", ".."); // extensions/lark-bot → 项目根

const IS_WIN = process.platform === "win32";
let botProc: ChildProcess | null = null;

export default function (pi: any) {
  pi.on("session_start", async (event: any) => {
    if (event.reason !== "startup") return;
    if (botProc) return;
    if (process.env.LARK_BOT_RUNTIME === "1") return; // 防递归

    // 检查 autoStart 开关。仅当本地 settings.json 中明确设置下才会为 true:
    //   { "larkBot": { "autoStart": true } }
    // 以下情况一律视为 false:
    //   - settings.json 不存在（.gitignore，开发者默认无此文件）
    //   - 无 larkBot key
    //   - autoStart 缺失 / false / 非布尔值
    let autoStart = false;
    try {
      const settings = JSON.parse(readFileSync(join(root, ".pi", "settings.json"), "utf-8"));
      autoStart = settings?.larkBot?.autoStart === true;
    } catch {}

    if (!autoStart) {
      console.error("[lark-bot ext] autoStart=false，跳过自动启动。");
      console.error("[lark-bot ext] 手动启动: tsx .pi/scripts/lark-bot.ts &");
      return;
    }

    const script = join(root, ".pi", "scripts", "lark-bot", "main.ts");
    const nodeBin = process.execPath;
    const tsxEntry = join(root, ".pi", "npm", "node_modules", "tsx", "dist", "cli.mjs");

    if (!existsSync(script)) {
      console.error("[lark-bot ext] 脚本不存在:", script);
      return;
    }

    console.error("[lark-bot ext] 启动飞书 Bot ...");

    botProc = spawn(nodeBin, [tsxEntry, script], {
      cwd: root,
      stdio: ["pipe", "ignore", "ignore"],  // stdin pipe: shutdown IPC
      env: {
        ...process.env,
        LARK_PARENT_PID: String(process.pid),
      },
      detached: !IS_WIN,
      windowsHide: IS_WIN,
    });

    botProc.on("exit", (code) => {
      console.error(`[lark-bot ext] Bot 进程退出 (code=${code})`);
      botProc = null;
    });

    botProc.on("error", (err) => {
      console.error(`[lark-bot ext] 启动失败: ${err.message}`);
      botProc = null;
    });
  });

  pi.on("session_shutdown", async (event: any) => {
    if (!botProc) return;

    console.error(`[lark-bot ext] 停止飞书 Bot (reason=${event.reason}) ...`);

    // 通过 stdin 发送 shutdown 指令，让 lark-bot 自行 cleanup()
    // error 监听防止 bot 已退出时 EPIPE 打穿 PI Agent
    botProc.stdin.once("error", () => {});
    botProc.stdin.write('{"type":"shutdown"}\n');

    botProc = null;
  });
}
