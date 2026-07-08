const express = require("express");

const {
  devices,
  getAllowedCommands,
  hasDevice,
  refreshDeviceOnlineStates
} = require("../devices");
const requireApiKey = require("../middleware/requireApiKey");
const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("../services/commandService");

const router = express.Router();

router.use(requireApiKey);

router.get("/", (req, res) => {
  refreshDeviceOnlineStates();

  res.json({
    success: true,
    devices
  });
});

router.get("/:deviceId", (req, res) => {
  const { deviceId } = req.params;

  if (!hasDevice(deviceId)) {
    return res.status(404).json({
      success: false,
      message: "Device not found"
    });
  }

  refreshDeviceOnlineStates();

  return res.json({
    success: true,
    device: devices[deviceId]
  });
});

router.post("/:deviceId/command", async (req, res) => {
  const { deviceId } = req.params;
  const { command } = req.body || {};

  if (!hasDevice(deviceId)) {
    return res.status(404).json({
      success: false,
      message: "Device not found"
    });
  }

  const allowedCommands = getAllowedCommands(deviceId);

  if (!allowedCommands.includes(command)) {
    return res.status(400).json({
      success: false,
      message: "Invalid command",
      allowedCommands
    });
  }

  const commandParams = Object.prototype.hasOwnProperty.call(req.body || {}, "params")
    ? req.body.params
    : {};
  const commandPayload = buildCommandPayload(deviceId, command, commandParams);

  try {
    const ack = await publishCommandAndWaitForAck(deviceId, commandPayload);

    return res.json({
      success: true,
      message: "Command delivered and acknowledged",
      command: commandPayload,
      ack
    });
  } catch (error) {
    if (error.statusCode === 504) {
      return res.status(504).json({
        success: false,
        message: "Timeout waiting for device acknowledgement",
        command: commandPayload
      });
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      command: commandPayload
    });
  }
});

module.exports = router;
