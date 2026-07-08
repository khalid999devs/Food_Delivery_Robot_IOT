const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const { simulateVendingCompleted } = require("../services/orderSimulationService");

const router = express.Router();

router.use(requireApiKey);

router.post("/:orderId/simulate-vending-completed", async (req, res) => {
  const result = await simulateVendingCompleted(req.params.orderId);

  if (!result) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  return res.status(result.statusCode).json(result.body);
});

module.exports = router;
