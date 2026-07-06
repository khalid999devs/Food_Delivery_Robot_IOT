const { getAllOrders, getOrder, addTimeline, nowIso, setOrderStatus } = require("./orderStore");
const { sendRobotDeliveryForOrder } = require("./orderFlowService");

function findOrderByVendingPayload(payload) {
  const orderId = payload.orderId || payload.activeOrderId;

  if (orderId && getOrder(orderId)) {
    return getOrder(orderId);
  }

  if (payload.commandId) {
    return getAllOrders().find((order) => order.vendingCommandId === payload.commandId) || null;
  }

  return null;
}

function findOrderByRobotPayload(payload) {
  const orderId = payload.orderId || payload.activeOrderId;

  if (orderId && getOrder(orderId)) {
    return getOrder(orderId);
  }

  if (payload.commandId) {
    return (
      getAllOrders().find(
        (order) =>
          order.robotPrepareCommandId === payload.commandId ||
          order.robotDeliveryCommandId === payload.commandId
      ) || null
    );
  }

  return null;
}

function updateOrderFromVendingStatus(payload) {
  const order = findOrderByVendingPayload(payload);

  if (!order) {
    return;
  }

  const status = String(payload.status || "").toLowerCase();

  if (status === "accepted") {
    setOrderStatus(order, "vending_accepted", "Vending accepted order", payload);
  } else if (status === "dispensing") {
    setOrderStatus(order, "vending_dispensing", "Vending dispensing", payload);
  } else if (status === "progress") {
    setOrderStatus(order, "vending_progress", "Vending progress", payload);
  } else if (status === "completed") {
    setOrderStatus(order, "vending_completed", "Vending completed", payload);
    sendRobotDeliveryForOrder(order.orderId);
  } else if (status === "failed") {
    setOrderStatus(order, "failed", "Vending failed", payload);
  }
}

function updateOrderFromVendingEvent(payload) {
  const orderId = payload.orderId || payload.activeOrderId;
  const order = orderId ? getOrder(orderId) : null;

  if (!order) {
    return;
  }

  const event = payload.event || payload.type;
  addTimeline(order, "info", `Vending event: ${event || "unknown"}`, payload);

  if (event === "order_accepted") {
    order.status = "vending_accepted";
  } else if (event === "dispensing_item") {
    order.status = "vending_dispensing";
  } else if (event === "item_dispensed") {
    order.status = "vending_progress";
  } else if (event === "order_completed") {
    order.status = "vending_completed";
    order.updatedAt = nowIso();
    sendRobotDeliveryForOrder(order.orderId);
  } else if (event === "order_failed") {
    order.status = "failed";
    order.updatedAt = nowIso();
  }
}

function updateOrderFromRobotPayload(payload) {
  const order = findOrderByRobotPayload(payload);

  if (!order) {
    return;
  }

  const value = String(payload.event || payload.status || "").toLowerCase();
  addTimeline(order, value === "failed" || value === "error" ? "failed" : "info", "Robot update", payload);

  if (["robot_ready_for_pickup", "ready_for_pickup"].includes(value)) {
    order.status = "robot_ready";
  } else if (value === "delivery_started") {
    order.status = "robot_delivering";
  } else if (value === "station_reached") {
    order.status = "station_reached";
  } else if (["delivery_completed", "completed"].includes(value)) {
    order.status = "completed";
  } else if (["failed", "error"].includes(value)) {
    order.status = "failed";
  }

  order.updatedAt = nowIso();
}

module.exports = {
  updateOrderFromRobotPayload,
  updateOrderFromVendingEvent,
  updateOrderFromVendingStatus
};
