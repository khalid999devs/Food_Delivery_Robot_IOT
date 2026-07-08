const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const { parseOrderRequest } = require("../orderRequest");
const { cancelOrder, startDispenseAndDeliver } = require("../services/orderFlowService");
const { markDeliveryReceived } = require("../services/orderCompletionService");
const { activeOrderStatuses, getAllOrders, getCurrentOrder, getLatestActiveOrder, getOrder } =
  require("../services/orderStore");

const router = express.Router();
const deliveryReceivableStatuses = new Set(["awaiting_delivery_receipt", "delivery_received"]);

router.use(requireApiKey);

router.post("/dispense-and-deliver", async (req, res) => {
  const request = parseOrderRequest(req.body);

  if (request.error) {
    return res.status(400).json({
      success: false,
      message: request.error,
      ...(request.allowedStations ? { allowedStations: request.allowedStations } : {})
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

  const result = await startDispenseAndDeliver(request.value);
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

async function sendDeliveryReceivedResponse(req, res, order) {
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

  const result = await markDeliveryReceived(order.orderId);
  const allAcknowledged = result.notifications?.allAcknowledged !== false;

  return res.json({
    success: allAcknowledged,
    message: allAcknowledged
      ? "Delivery received. Robot and vending were notified."
      : "Delivery received, but one device did not acknowledge the notification.",
    order: result.order,
    notifications: result.notifications
  });
}

router.post("/current/delivery-received", async (req, res) => {
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

router.post("/:orderId/delivery-received", async (req, res) => {
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
