/**
 * lark-bot extension — 随 pi agent 生命周期自动启停 lark-bot
 *
 * session_start(reason="startup") → spawn lark-bot 子进程
 * session_shutdown(reason="quit")  → kill lark-bot 子进程
 */

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
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

    const script = join(root, ".pi", "scripts", "lark-bot.ts");
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
