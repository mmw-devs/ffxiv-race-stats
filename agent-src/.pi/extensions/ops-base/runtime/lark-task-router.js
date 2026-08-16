"use strict";

/**
 * lark-bot 的 MVP 任务路由。
 *
 * 这里不理解运营业务文本；只把可信飞书身份和消息路由绑定到唯一 task。
 */

const { TaskStoreInvariantError } = require("./task-store.js");

const FEISHU_OPEN_ID = /^ou_[A-Za-z0-9]+$/;

function normalizeRouting(event) {
  return {
    chatId: event.chatId,
    threadId: event.threadId || null,
    // 非 thread 首条群消息没有 root_id 时，以 trigger message 作为该话题根。
    rootMessageId: event.rootMessageId || event.triggerMessageId,
    triggerMessageId: event.triggerMessageId,
    lastInboundMessageId: null,
    piSessionResourceId: null,
  };
}

function buildIngress(event, state, messageKind) {
  const sentAt = new Date().toISOString();
  return {
    protocolVersion: "ops-ingress/1.0.0",
    requestId: `feishu-message:${event.triggerMessageId}`,
    messageKind,
    taskId: state.taskId,
    attempt: state.lifecycle.attempt || 1,
    sentAt,
    operator: { identityType: "FEISHU_OPEN_ID", feishuOpenId: state.operator.feishuOpenId },
    route: {
      channel: "FEISHU",
      chatType: event.chatType.toUpperCase(),
      chatId: event.chatId,
      threadId: event.threadId || null,
      topicId: null,
      rootMessageId: event.rootMessageId || null,
      replyToMessageId: null,
      messageId: event.triggerMessageId,
      triggerMessageId: state.routing.triggerMessageId,
    },
    message: {
      createdAt: event.createdAt || null,
      receivedAt: sentAt,
      text: event.text || "",
    },
  };
}

function isSameRoute(routing, event) {
  if (!routing || routing.chatId !== event.chatId) return false;
  if (event.chatType === "p2p") return true;
  if (routing.threadId) return routing.threadId === (event.threadId || null);
  return routing.rootMessageId === (event.rootMessageId || null);
}

class LarkTaskRouter {
  constructor(taskStore) {
    this.taskStore = taskStore;
  }

  async route(event) {
    if (!event || !FEISHU_OPEN_ID.test(event.feishuOpenId || "")) {
      throw new TaskStoreInvariantError("无法确认完整 feishuOpenId，拒绝创建运营 task");
    }
    if (!event.chatId || !event.triggerMessageId || !event.chatType) {
      throw new TaskStoreInvariantError("飞书消息路由字段不完整");
    }

    const active = await this.taskStore.recoverActiveTask();
    if (!active) {
      const created = await this.taskStore.createTask({
        routing: normalizeRouting(event),
        operator: { feishuOpenId: event.feishuOpenId },
      });
      const recorded = await this.taskStore.recordIngress(
        created.taskId,
        created.documentRevision,
        buildIngress(event, created, "TASK_CREATE"),
      );
      return { kind: "created", state: recorded.state, deduplicated: recorded.deduplicated };
    }

    const sameOperator = active.operator?.feishuOpenId === event.feishuOpenId;
    if (sameOperator && isSameRoute(active.routing, event)) {
      const recorded = await this.taskStore.recordIngress(
        active.taskId,
        active.documentRevision,
        buildIngress(event, active, "TASK_FOLLOW_UP"),
      );
      return { kind: "follow-up", state: recorded.state, deduplicated: recorded.deduplicated };
    }

    return {
      kind: "rejected",
      state: active,
      reason: "当前已有其他运营任务处理中",
    };
  }

  async recordPiSession(taskId, expectedDocumentRevision, session) {
    return this.taskStore.recordPiSession(taskId, expectedDocumentRevision, session);
  }
}

module.exports = { LarkTaskRouter, buildIngress, isSameRoute, normalizeRouting };
