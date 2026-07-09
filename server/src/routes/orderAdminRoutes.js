const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const { confirmOrderLoaded } = require("../services/deliveryLoadedService");
const { forceResetCurrentOrder } = require("../services/orderAdminService");
const { getOrder, setOrderStatus } = require("../services/orderStore");

const router = express.Router();
const demoProgressStatuses = {
  1: "robot_ready",
  2: "vending_dispensing",
  3: "robot_delivering",
  4: "awaiting_delivery_receipt"
};

router.use(requireApiKey);

router.post("/current/force-reset", async (req, res) => {
  const result = await forceResetCurrentOrder();

  if (!result) {
    return res.status(404).json({
      success: false,
      message: "No active order to reset"
    });
  }

  return res.json({
    success: true,
    message: "Current order force-reset. Device cleanup was attempted.",
    ...result
  });
});

router.post("/:orderId/confirm-loaded", async (req, res) => {
  const result = await confirmOrderLoaded(req.params.orderId, "website");

  if (!result) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  return res.status(result.statusCode).json(result.body);
});

router.post("/:orderId/demo-progress", (req, res) => {
  const order = getOrder(req.params.orderId);
  const step = Number(req.body?.step);
  const status = demoProgressStatuses[step];

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  if (!status) {
    return res.status(400).json({
      success: false,
      message: "Progress step must be between 1 and 4"
    });
  }

  setOrderStatus(order, status, `Demo progress forced to step ${step}`, {
    source: "consumer_progress_control",
    step
  });

  return res.json({
    success: true,
    message: `Order progress force-updated to step ${step}`,
    order
  });
});

module.exports = router;
