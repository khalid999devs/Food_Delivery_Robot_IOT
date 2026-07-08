const express = require("express");

const { devices, hasDevice } = require("../devices");
const requireApiKey = require("../middleware/requireApiKey");
const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("../services/commandService");

const router = express.Router({ mergeParams: true });
const ROBOT_DEVICE_ID = "robot_car_001";

router.use(requireApiKey);

function validateKnownDevice(req, res) {
  const { deviceId } = req.params;

  if (!hasDevice(deviceId)) {
    res.status(404).json({ success: false, message: "Device not found" });
    return false;
  }

  return true;
}

function validateTelemetryControl(req, res) {
  if (!validateKnownDevice(req, res)) {
    return false;
  }

  const { deviceId } = req.params;

  if (deviceId !== ROBOT_DEVICE_ID) {
    res.status(400).json({
      success: false,
      message: "Telemetry controls are only supported for robot_car_001"
    });
    return false;
  }

  return true;
}

async function sendTelemetryCommand(req, res, command, params) {
  if (!validateTelemetryControl(req, res)) {
    return;
  }

  const { deviceId } = req.params;
  const payload = buildCommandPayload(deviceId, command, params);

  try {
    const ack = await publishCommandAndWaitForAck(deviceId, payload);
    res.json({
      success: true,
      message: "Telemetry command delivered and acknowledged",
      command: payload,
      ack
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      command: payload
    });
  }
}

router.get("/latest", (req, res) => {
  if (!validateKnownDevice(req, res)) {
    return;
  }

  res.json({
    success: true,
    deviceId: req.params.deviceId,
    telemetry: devices[req.params.deviceId].latestTelemetry
  });
});

router.get("/history", (req, res) => {
  if (!validateKnownDevice(req, res)) {
    return;
  }

  res.json({
    success: true,
    deviceId: req.params.deviceId,
    history: devices[req.params.deviceId].telemetryHistory
  });
});

router.post("/start", (req, res) => {
  sendTelemetryCommand(req, res, "start_telemetry", {
    intervalMs: 1000,
    durationMs: 600000
  });
});

router.post("/stop", (req, res) => {
  sendTelemetryCommand(req, res, "stop_telemetry", {});
});

module.exports = router;
