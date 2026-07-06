const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("../services/commandService");

const router = express.Router();

router.use(requireApiKey);

router.post("/robot-arrived", async (req, res) => {
  const body = req.body || {};
  const orderId = body.orderId || "ORD_1001";
  const hasQuantityParams = body.a !== undefined || body.b !== undefined;
  const vendingParams = hasQuantityParams
    ? { orderId, a: Number(body.a || 0), b: Number(body.b || 0) }
    : { orderId, a: 1, b: 0 };
  const vendingCommand = buildCommandPayload("vending_001", "dispense", vendingParams);
  let vendingAck = null;

  try {
    vendingAck = await publishCommandAndWaitForAck("vending_001", vendingCommand);
    const vendingStatus = String(vendingAck.status || "").toLowerCase();

    if (!["success", "accepted"].includes(vendingStatus)) {
      return res.status(502).json({
        success: false,
        message: "Vending dispense command was acknowledged but did not succeed",
        vendingCommand,
        vendingAck
      });
    }

    const robotCommand = buildCommandPayload("robot_car_001", "delivery_loaded", { orderId });
    const robotAck = await publishCommandAndWaitForAck("robot_car_001", robotCommand);

    return res.json({
      success: true,
      message: "Robot arrived flow completed",
      vendingCommand,
      vendingAck,
      robotCommand,
      robotAck
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 504 ? "Timeout waiting for device acknowledgement" : error.message,
      vendingCommand,
      vendingAck
    });
  }
});

module.exports = router;
