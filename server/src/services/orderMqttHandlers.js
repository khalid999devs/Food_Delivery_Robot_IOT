const {
  canUpdateOrder,
  findOrderByRobotPayload,
  findOrderByVendingPayload
} = require("./orderLookupService");
const { getOrder, addTimeline, createOrder, nowIso, setOrderStatus } = require("./orderStore");
const {
  handleRobotPickupCompletion,
  handleRobotProductDetection
} = require("./robotPickupService");
const { handleVendingCompletion } = require("./vendingCompletionService");

function getRobotPayloadValue(payload) {
  return String(payload.event || payload.robotMode || payload.status || payload.type || "").toLowerCase();
}

function getRobotReportedQuantity(payload) {
  const counts = [payload.cart?.expectedProductCount, payload.cart?.productCount].map(Number);
  return counts.find((count) => Number.isFinite(count) && count > 0) || 0;
}

function getOrCreateRobotOrder(payload, value) {
  const existingOrder = findOrderByRobotPayload(payload);
  const storedOrder = payload.orderId ? getOrder(payload.orderId) : null;

  if (
    existingOrder ||
    storedOrder?.adminResetAt ||
    !payload.orderId ||
    !["delivery_completed", "completed"].includes(value)
  ) {
    return existingOrder;
  }

  const targetStation = payload.targetStation || "station_3";
  const quantity = getRobotReportedQuantity(payload);
  const order = createOrder({
    orderId: payload.orderId,
    targetStation,
    a: quantity,
    b: 0
  });

  addTimeline(order, "info", "Order restored from robot completion status", payload);
  return order;
}

function updateOrderFromVendingStatus(payload) {
  const order = findOrderByVendingPayload(payload);

  if (!order) {
    return;
  }

  const status = String(payload.status || "").toLowerCase();

  if (handleVendingCompletion(order, payload, "vending_status")) {
    return;
  }

  if (status === "accepted") {
    setOrderStatus(order, "vending_accepted", "Vending accepted order", payload);
  } else if (status === "dispensing") {
    setOrderStatus(order, "vending_dispensing", "Vending dispensing", payload);
  } else if (status === "progress") {
    setOrderStatus(order, "vending_progress", "Vending progress", payload);
  } else if (status === "failed") {
    setOrderStatus(order, "failed", "Vending failed", payload);
  }
}

function updateOrderFromVendingEvent(payload) {
  const orderId = payload.orderId || payload.activeOrderId;
  const order = orderId ? getOrder(orderId) : null;

  if (!canUpdateOrder(order)) {
    return;
  }

  const event = payload.event || payload.type;
  addTimeline(order, "info", `Vending event: ${event || "unknown"}`, payload);

  if (handleVendingCompletion(order, payload, "vending_event")) {
    return;
  }

  if (event === "order_accepted") {
    order.status = "vending_accepted";
  } else if (event === "dispensing_item") {
    order.status = "vending_dispensing";
  } else if (event === "item_dispensed") {
    order.status = "vending_progress";
  } else if (event === "order_failed") {
    order.status = "failed";
    order.updatedAt = nowIso();
  }
}

function updateOrderFromRobotPayload(payload) {
  const value = getRobotPayloadValue(payload);
  const order = getOrCreateRobotOrder(payload, value);

  if (!order) {
    return;
  }

  addTimeline(order, value === "failed" || value === "error" ? "failed" : "info", "Robot update", payload);

  if (handleRobotProductDetection(order, payload, value)) {
    // Reaching the expected count starts the real load-confirmation chain.
  } else if (handleRobotPickupCompletion(order, payload, value)) {
    // Pickup handler starts delivery after validating any reported cart count.
  } else if (["robot_ready_for_pickup", "ready_for_pickup"].includes(value)) {
    order.status = "robot_ready";
  } else if (value === "delivery_started") {
    order.status = "robot_delivering";
  } else if (value === "station_reached") {
    order.status = "station_reached";
  } else if (["delivery_completed", "completed"].includes(value)) {
    order.status = "awaiting_delivery_receipt";
  } else if (value === "delivery_start_rejected" || value.endsWith("_rejected")) {
    setOrderStatus(order, "failed", "Robot rejected delivery start", payload);
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
