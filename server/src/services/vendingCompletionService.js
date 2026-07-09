const { confirmOrderLoaded } = require("./deliveryLoadedService");
const { addTimeline, setOrderStatus } = require("./orderStore");

const postVendingStatuses = new Set([
  "robot_load_confirmation_sent",
  "robot_loaded",
  "robot_delivery_sent",
  "robot_delivering",
  "blocked_by_obstacle",
  "station_reached",
  "awaiting_delivery_receipt",
  "delivery_received",
  "completed",
  "failed"
]);

function isVendingCompletion(payload) {
  const values = [
    payload.status,
    payload.event,
    payload.type,
    payload.message
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);

  return values.some(
    (value) =>
      ["completed", "order_completed"].includes(value) ||
      value.includes("dispense order completed")
  );
}

function handleVendingCompletion(order, payload, source) {
  if (!isVendingCompletion(payload)) {
    return false;
  }

  if (!postVendingStatuses.has(order.status)) {
    setOrderStatus(order, "vending_completed", "Vending completed", payload);
  }

  order.vendingCompletionReceived = true;
  order.vendingCompletionPayload = payload;

  if (Number(order.detectedProductCount || 0) < 1) {
    addTimeline(
      order,
      "warning",
      "Vending completed; waiting for at least one cart IR product detection"
    );
    return true;
  }

  confirmOrderLoaded(order.orderId, source).catch((error) => {
    setOrderStatus(order, "failed", "Robot load confirmation failed", {
      message: error.message
    });
  });
  return true;
}

module.exports = {
  handleVendingCompletion,
  isVendingCompletion
};
