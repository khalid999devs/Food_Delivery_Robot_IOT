const express = require("express");

const requireApiKey = require("../middleware/requireApiKey");
const { runMqttTestPing } = require("../services/mqttTestService");

const router = express.Router();

router.use(requireApiKey);

router.post("/test-ping", async (req, res) => {
  try {
    const result = await runMqttTestPing();
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
