const express = require("express");

const config = require("../config");
const { getDeviceCheckState } = require("../services/deviceHealthService");
const { isMqttConnected } = require("../services/mqttService");

const router = express.Router();

router.get("/", (req, res) => {
  const configStatus = config.getConfigStatus();

  res.json({
    success: true,
    message: "Robot vending IoT server running",
    mqttConnected: isMqttConnected(),
    environment: {
      nodeEnv: configStatus.nodeEnv,
      mqttConfigured: configStatus.mqttConfigured,
      apiKeyEnabled: configStatus.apiKeyEnabled,
      corsMode: configStatus.corsMode
    }
  });
});

router.get("/health", (req, res) => {
  const configStatus = config.getConfigStatus();
  const deviceCheck = getDeviceCheckState();
  const mqttConnected = isMqttConnected();

  res.json({
    success: true,
    server: "ok",
    mqttConnected,
    mqttConfigured: configStatus.mqttConfigured,
    apiKeyEnabled: configStatus.apiKeyEnabled,
    corsMode: configStatus.corsMode,
    deviceCheck,
    ready: configStatus.mqttConfigured && mqttConnected,
    uptimeMs: process.uptime() * 1000
  });
});

module.exports = router;
