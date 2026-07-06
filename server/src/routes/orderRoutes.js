const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const { cancelOrder, startDispenseAndDeliver } = require("../services/orderFlowService");
const { markDeliveryReceived } = require("../services/orderCompletionService");
const { activeOrderStatuses, getAllOrders, getCurrentOrder, getLatestActiveOrder, getOrder } =
  require("../services/orderStore");

const router = express.Router();
const allowedStations = new Set(["station_1", "station_2", "station_3"]);
const deliveryReceivableStatuses = new Set(["robot_delivery_sent", "robot_delivering", "station_reached", "delivery_received"]);

router.use(requireApiKey);

function toQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : NaN;
}

router.post("/dispense-and-deliver", async (req, res) => {
  const body = req.body || {};
  const a = toQuantity(body.a);
  const b = toQuantity(body.b);
  const { targetStation } = body;

  if (!allowedStations.has(targetStation)) {
    return res.status(400).json({
      success: false,
      message: "Invalid targetStation",
      allowedStations: Array.from(allowedStations)
    });
  }

  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b <= 0) {
    return res.status(400).json({
      success: false,
      message: "Products a and b must be numbers >= 0, and a + b must be greater than 0"
    });
  }

  const activeOrder = getLatestActiveOrder();

  if (activeOrder && activeOrderStatuses.has(activeOrder.status)) {
    return res.status(409).json({
      success: false,
      message: "Another order is already active",
      order: activeOrder
    });
  }

  const result = await startDispenseAndDeliver({ a, b, targetStation });
  return res.status(result.statusCode).json(result.body);
});

router.get("/", (req, res) => {
  res.json({
    success: true,
    orders: getAllOrders()
  });
});

router.get("/current", (req, res) => {
  res.json({
    success: true,
    order: getCurrentOrder()
  });
});

function sendDeliveryReceivedResponse(req, res, order) {
  if (!order) {
    return res.status(404).json({
      success: false,
      message: "No order found"
    });
  }

  if (!deliveryReceivableStatuses.has(order.status)) {
    return res.status(409).json({
      success: false,
      message: "Order is not waiting for delivery receipt",
      order
    });
  }

  const updatedOrder = markDeliveryReceived(order.orderId);

  return res.json({
    success: true,
    message: "Delivery received. System will be ready again in 5 seconds.",
    order: updatedOrder
  });
}

router.post("/current/delivery-received", (req, res) => {
  const order = getLatestActiveOrder() || getCurrentOrder();
  return sendDeliveryReceivedResponse(req, res, order);
});

router.get("/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  return res.json({
    success: true,
    order
  });
});

router.post("/:orderId/delivery-received", (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  return sendDeliveryReceivedResponse(req, res, order);
});

router.post("/:orderId/cancel", async (req, res) => {
  const result = await cancelOrder(req.params.orderId);

  if (!result) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  return res.json({
    success: true,
    message: "Order cancelled",
    ...result
  });
});

module.exports = router;
