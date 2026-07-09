const { getAllOrders, getOrder } = require("./orderStore");

function canUpdateOrder(order) {
  return Boolean(order && !order.adminResetAt);
}

function findOrderByVendingPayload(payload) {
  const orderId = payload.orderId || payload.activeOrderId;
  const directOrder = orderId ? getOrder(orderId) : null;

  if (canUpdateOrder(directOrder)) {
    return directOrder;
  }

  if (!payload.commandId) {
    return null;
  }

  return (
    getAllOrders().find(
      (order) =>
        canUpdateOrder(order) &&
        order.vendingCommandId === payload.commandId
    ) || null
  );
}

function findOrderByRobotPayload(payload) {
  const orderId = payload.orderId || payload.activeOrderId;
  const directOrder = orderId ? getOrder(orderId) : null;

  if (canUpdateOrder(directOrder)) {
    return directOrder;
  }

  if (!payload.commandId) {
    return null;
  }

  return (
    getAllOrders().find(
      (order) =>
        canUpdateOrder(order) &&
        (order.robotPrepareCommandId === payload.commandId ||
          order.robotDeliveryCommandId === payload.commandId)
    ) || null
  );
}

module.exports = {
  canUpdateOrder,
  findOrderByRobotPayload,
  findOrderByVendingPayload
};
