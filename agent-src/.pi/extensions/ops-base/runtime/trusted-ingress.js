"use strict";

/** 由 PI Extension 使用的只读可信 ingress 查询。 */
async function loadTrustedIngress(taskStore, piSessionId) {
  const state = await taskStore.recoverActiveTask();
  if (!state) return null;
  const resourceId = state.routing?.piSessionResourceId;
  const session = state.resources.items.find((item) => item.resourceId === resourceId);
  if (!session || session.type !== "PI_SESSION" || session.locator?.piSessionId !== piSessionId) {
    return null;
  }
  const current = await taskStore.readCurrentIngress(state.taskId);
  const ingress = current.ingress;
  // 再次校验 artifact 与 state 的不可伪造 envelope 绑定，拒绝让 prompt 覆盖身份或路由。
  if (ingress.taskId !== state.taskId
    || ingress.operator?.feishuOpenId !== state.operator?.feishuOpenId
    || ingress.route?.chatId !== state.routing?.chatId
    || ingress.route?.messageId !== state.routing?.currentTurnMessageId) {
    throw new Error("可信 ingress 与 task state 不匹配");
  }
  return {
    taskId: state.taskId,
    feishuOpenId: state.operator.feishuOpenId,
    route: ingress.route,
    messageId: ingress.route.messageId,
    triggerMessageId: state.routing.triggerMessageId,
  };
}

module.exports = { loadTrustedIngress };
