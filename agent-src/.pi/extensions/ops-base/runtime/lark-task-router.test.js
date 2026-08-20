"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LarkTaskRouter } = require("./lark-task-router.js");
const { TaskStore } = require("./task-store.js");
const { loadTrustedIngress } = require("./trusted-ingress.js");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ops-base-lark-router-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const store = new TaskStore({ workspaceRoot: workspace, runtimeRoot: path.join(root, "runtime") });
  await store.initialize();
  return {
    store,
    router: new LarkTaskRouter(store),
    async cleanup() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

function event(overrides = {}) {
  return {
    chatId: "oc_chat_1",
    chatType: "p2p",
    feishuOpenId: "ou_operatora",
    triggerMessageId: "om_message_1",
    threadId: null,
    rootMessageId: null,
    ...overrides,
  };
}

test("同一用户同一路由的连续消息进入同一 task", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const second = await env.router.route(event({ triggerMessageId: "om_message_2" }));

  assert.equal(first.kind, "created");
  assert.equal(second.kind, "follow-up");
  assert.equal(second.state.taskId, first.state.taskId);
  assert.equal(second.state.operator.feishuOpenId, "ou_operatora");
  assert.equal(second.state.routing.triggerMessageId, "om_message_1");
});

test("同一 messageId 经 WS/poll 重复投递时持久去重且不产生第二个 ingress", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const duplicate = await env.router.route(event());

  assert.equal(first.kind, "created");
  assert.equal(duplicate.kind, "follow-up");
  assert.equal(duplicate.deduplicated, true);
  const state = await env.store.readTask(first.state.taskId);
  assert.equal(state.resources.items.filter((item) => item.locator?.messageId === "om_message_1").length, 1);
});

test("不同用户的新任务在全局 active task 存在时被拒绝", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const rejected = await env.router.route(event({ feishuOpenId: "ou_operatorb", triggerMessageId: "om_message_2" }));

  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.state.taskId, first.state.taskId);
});

test("task 结束并释放 lock 后才允许创建新 task", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const cancelling = await env.store.transitionState(first.state.taskId, first.state.documentRevision, "CANCELLING");
  const cleaning = await env.store.transitionState(first.state.taskId, cancelling.documentRevision, "CLEANING");
  await env.store.endTask(first.state.taskId, cleaning.documentRevision, "CANCELLED");
  const second = await env.router.route(event({ feishuOpenId: "ou_operatorb", triggerMessageId: "om_message_2" }));

  assert.equal(second.kind, "created");
  assert.notEqual(second.state.taskId, first.state.taskId);
});

test("仅在 new_session 成功后登记本 task 的 PI session，隔离上下文", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const attached = await env.store.recordPiSession(first.state.taskId, first.state.documentRevision, {
    piSessionId: "pi-session-fresh-1",
    sessionFile: "/outside-workspace/sessions/fresh-1.jsonl",
    sessionKey: "p2p",
  });

  assert.equal(attached.routing.piSessionResourceId, "res_pi_session_1");
  const resource = attached.resources.items.find((item) => item.resourceId === "res_pi_session_1");
  assert.deepEqual(resource.locator, {
    piSessionId: "pi-session-fresh-1",
    sessionFile: "/outside-workspace/sessions/fresh-1.jsonl",
    sessionKey: "p2p",
  });
  assert.notEqual(resource.locator.piSessionId, "pi-session-previous-task");
  await env.store.activateIngress(first.state.taskId, "om_message_1");

  const trusted = await loadTrustedIngress(env.store, "pi-session-fresh-1");
  assert.deepEqual(trusted, {
    taskId: first.state.taskId,
    feishuOpenId: "ou_operatora",
    route: {
      channel: "FEISHU",
      chatType: "P2P",
      chatId: "oc_chat_1",
      threadId: null,
      topicId: null,
      rootMessageId: null,
      replyToMessageId: null,
      messageId: "om_message_1",
      triggerMessageId: "om_message_1",
    },
    messageId: "om_message_1",
    triggerMessageId: "om_message_1",
  });
  assert.equal(await loadTrustedIngress(env.store, "pi-session-other"), null);
});

test("task state 不是 ENDED 时，agent_settled 判定必须保持 task active", async (t) => {
  const env = await fixture();
  t.after(env.cleanup);
  const first = await env.router.route(event());
  const stateAfterSettled = await env.store.readTask(first.state.taskId);

  assert.notEqual(stateAfterSettled.lifecycle.state, "ENDED");
  assert.equal((await env.store.scanNonEndedTasks())[0].taskId, first.state.taskId);
});
