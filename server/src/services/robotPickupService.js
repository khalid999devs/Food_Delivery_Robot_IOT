const { addTimeline } = require("./orderStore");
const { confirmOrderLoaded } = require("./deliveryLoadedService");
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

function handleRobotProductDetection(order, payload, value) {
  const payloadValues = [
    value,
    payload.event,
    payload.status,
    payload.type
  ].map((item) => String(item || "").toLowerCase());

  if (!payloadValues.includes("product_detected")) {
    return false;
  }

  const expectedProducts = Math.max(
    1,
    Number(order.products?.a || 0) + Number(order.products?.b || 0)
  );
  const detectedProducts = getDetectedProductCount(payload);
  order.detectedProductCount = Math.max(
    Number(order.detectedProductCount || 0),
    detectedProducts === null ? 1 : detectedProducts
  );
  addTimeline(order, "info", "Robot detected a product in the cart", {
    expectedProducts,
    detectedProducts: order.detectedProductCount
  });

  if (
    (order.vendingCompletionReceived ||
      order.detectedProductCount >= expectedProducts) &&
    !order.deliveryLoadedCommandId &&
    !order.robotDeliveryCommandId
  ) {
    confirmOrderLoaded(order.orderId, "robot_product_count").catch((error) => {
      addTimeline(order, "failed", "Automatic robot load confirmation failed", {
        message: error.message
      });
    });
  }

  return true;
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

  const isBackendLoadAck =
    payload.command === "delivery_loaded" ||
    order.deliveryLoadedCommandIds?.includes(payload.commandId);

  if (isBackendLoadAck) {
    addTimeline(order, "info", "Robot load-confirmation acknowledgement received", payload);
    return true;
  }

  const expectedProducts =
    Number(order.products?.a || 0) + Number(order.products?.b || 0);
  const detectedProducts = getDetectedProductCount(payload);
  order.detectedProductCount = Math.max(
    Number(order.detectedProductCount || 0),
    detectedProducts || 0
  );

  if (order.detectedProductCount < 1) {
    addTimeline(order, "warning", "Robot reported loaded without an IR product detection", {
      expectedProducts,
      detectedProducts: order.detectedProductCount
    });
    return true;
  }

  addTimeline(order, "success", "Robot confirmed all expected products loaded", {
    completionValue,
    expectedProducts,
    detectedProducts: order.detectedProductCount
  });
  sendRobotDeliveryForOrder(order.orderId);
  return true;
}

module.exports = {
  getDetectedProductCount,
  handleRobotProductDetection,
  handleRobotPickupCompletion,
  pickupCompleteValues
};
