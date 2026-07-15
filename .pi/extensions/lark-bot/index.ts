/**
 * lark-bot extension — 随 pi agent 生命周期自动启停 lark-bot
 *
 * session_start(reason="startup") → spawn lark-bot 子进程
 * session_shutdown(reason="quit")  → kill lark-bot 子进程
 */

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let botProc: ChildProcess | null = null;

export default function (pi: any) {
  pi.on("session_start", async (event: any) => {
    if (event.reason !== "startup") return;
    if (botProc) return;
    if (process.env.LARK_BOT_RUNTIME === "1") return; // 防递归

    const root = process.cwd();
    const script = join(root, ".pi", "scripts", "lark-bot.ts");
    const tsxBin = join(root, ".pi", "npm", "node_modules", ".bin", "tsx");

    if (!existsSync(script)) {
      console.error("[lark-bot ext] 脚本不存在:", script);
      return;
    }

    console.error("[lark-bot ext] 启动飞书 Bot ...");

    botProc = spawn(tsxBin, [script], {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env },
      detached: true,
    });

    botProc.on("exit", (code) => {
      console.error(`[lark-bot ext] Bot 进程退出 (code=${code})`);
      botProc = null;
    });
  });

  pi.on("session_shutdown", async (event: any) => {
    if (event.reason !== "quit") return;
    if (!botProc) return;

    console.error("[lark-bot ext] 停止飞书 Bot ...");
    botProc.kill("SIGTERM");
    botProc = null;
  });
}
