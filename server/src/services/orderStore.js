const orders = new Map();
const activeOrderStatuses = new Set([
  "created",
  "robot_prepare_sent",
  "robot_ready",
  "vending_dispense_sent",
  "vending_accepted",
  "vending_dispensing",
  "vending_progress",
  "vending_completed",
  "robot_load_confirmation_sent",
  "robot_loaded",
  "robot_delivery_sent",
  "robot_delivering",
  "blocked_by_obstacle",
  "station_reached",
  "awaiting_delivery_receipt",
  "delivery_received"
]);

function nowIso() {
  return new Date().toISOString();
}

function addTimeline(order, type, message, data = null) {
  order.timeline.push({
    at: nowIso(),
    type,
    message,
    data
  });
  order.updatedAt = nowIso();
}

function setOrderStatus(order, status, message, data = null) {
  order.status = status;
  addTimeline(order, status === "failed" ? "failed" : "info", message, data);
}

function getAllOrders() {
  return Array.from(orders.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getOrder(orderId) {
  return orders.get(orderId) || null;
}

function getLatestActiveOrder() {
  return getAllOrders().find((order) => activeOrderStatuses.has(order.status)) || null;
}

function getCurrentOrder() {
  return getLatestActiveOrder() || getAllOrders()[0] || null;
}

function createOrder({ orderId, targetStation, a, b, userLocation = null }) {
  const createdAt = nowIso();
  const order = {
    orderId,
    targetStation,
    userLocation,
    products: { a, b },
    status: "created",
    robotPrepareCommandId: null,
    vendingCommandId: null,
    deliveryLoadedCommandId: null,
    deliveryLoadedCommandIds: [],
    robotDeliveryCommandId: null,
    robotReadyAck: null,
    vendingAck: null,
    deliveryLoadedAck: null,
    robotDeliveryAck: null,
    detectedProductCount: 0,
    vendingCompletionReceived: false,
    vendingCompletionPayload: null,
    createdAt,
    updatedAt: createdAt,
    timeline: []
  };

  orders.set(orderId, order);
  addTimeline(order, "info", "Order created", {
    targetStation,
    userLocation,
    products: order.products
  });
  return order;
}

module.exports = {
  activeOrderStatuses,
  addTimeline,
  createOrder,
  getAllOrders,
  getCurrentOrder,
  getLatestActiveOrder,
  getOrder,
  nowIso,
  setOrderStatus
};
