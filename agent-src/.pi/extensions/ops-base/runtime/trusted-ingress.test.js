"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("./task-store.js");
const { LarkTaskRouter } = require("./lark-task-router.js");
const { loadTrustedIngress } = require("./trusted-ingress.js");

test("排队 follow-up 不得覆盖已投递 turn 的可信 ingress", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-base-ingress-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TaskStore({ workspaceRoot: path.join(root, "workspace"), runtimeRoot: path.join(root, "runtime") });
  await fs.mkdir(path.join(root, "workspace"));
  await store.initialize();
  const router = new LarkTaskRouter(store);
  const event = (messageId) => ({ chatId: "oc_1", chatType: "p2p", feishuOpenId: "ou_owner", triggerMessageId: messageId, text: "消息" });
  const first = await router.route(event("om_a"));
  const session = await store.recordPiSession(first.state.taskId, first.state.documentRevision, {
    piSessionId: "pi_1", sessionFile: "/tmp/pi_1.jsonl", sessionKey: "p2p",
  });
  await store.activateIngress(first.state.taskId, "om_a"); // A 已获发送资格
  const queued = await router.route(event("om_b")); // B 到达但尚未送给 PI
  assert.equal(queued.state.routing.lastInboundMessageId, "om_b");
  assert.equal((await loadTrustedIngress(store, "pi_1")).messageId, "om_a");
  await store.activateIngress(first.state.taskId, "om_b"); // B 真正开始时才切换
  assert.equal((await loadTrustedIngress(store, "pi_1")).messageId, "om_b");
  assert.equal(session.routing.piSessionResourceId, "res_pi_session_1");
});
