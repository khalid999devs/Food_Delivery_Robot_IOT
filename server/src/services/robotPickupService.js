const { addTimeline } = require("./orderStore");
const { sendRobotDeliveryForOrder } = require("./robotDeliveryService");

const pickupCompleteValues = new Set([
  "product_loaded",
  "products_loaded",
  "cart_loaded",
  "order_complete",
  "order_completed"
]);

function getDetectedProductCount(payload) {
  const values = [
    payload.cart?.productCount,
    payload.productCount,
    payload.detectedProducts
  ];
  const count = values.map(Number).find(Number.isFinite);
  return count === undefined ? null : count;
}

function handleRobotPickupCompletion(order, payload, value) {
  const completionValue = [
    value,
    payload.event,
    payload.status,
    payload.robotMode,
    payload.type
  ]
    .map((item) => String(item || "").toLowerCase())
    .find((item) => pickupCompleteValues.has(item));

  if (!completionValue) {
    return false;
  }

  const expectedProducts =
    Number(order.products?.a || 0) + Number(order.products?.b || 0);
  const detectedProducts = getDetectedProductCount(payload);

  if (
    detectedProducts !== null &&
    expectedProducts > 0 &&
    detectedProducts < expectedProducts
  ) {
    addTimeline(order, "warning", "Robot reported loaded before expected count", {
      expectedProducts,
      detectedProducts
    });
    return true;
  }

  addTimeline(order, "success", "Robot confirmed all expected products loaded", {
    completionValue,
    expectedProducts,
    detectedProducts
  });
  sendRobotDeliveryForOrder(order.orderId);
  return true;
}

module.exports = {
  getDetectedProductCount,
  handleRobotPickupCompletion,
  pickupCompleteValues
};
