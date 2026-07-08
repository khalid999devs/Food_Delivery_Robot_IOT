const { devices, hasDevice, markDeviceSeen } = require("../devices");
const logger = require("../logger");

const TELEMETRY_HISTORY_LIMIT = 100;

function parseTelemetryTopic(topic) {
  const parts = topic.split("/");

  if (
    parts.length !== 3 ||
    parts[0] !== "devices" ||
    parts[2] !== "telemetry" ||
    !hasDevice(parts[1])
  ) {
    return null;
  }

  return parts[1];
}

function handleTelemetryMessage(topic, message) {
  const deviceId = parseTelemetryTopic(topic);

  if (!deviceId) {
    return;
  }

  let payload;

  try {
    payload = JSON.parse(message.toString());
  } catch (error) {
    logger.warn(`Invalid MQTT telemetry JSON from ${deviceId}: ${error.message}`);
    return;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    logger.warn(`Ignored non-object telemetry payload from ${deviceId}`);
    return;
  }

  if (payload.deviceId && payload.deviceId !== deviceId) {
    logger.warn(`Ignored telemetry with mismatched deviceId on topic ${topic}`);
    return;
  }

  const device = devices[deviceId];
  device.latestTelemetry = payload;
  device.telemetryHistory.push(payload);

  if (device.telemetryHistory.length > TELEMETRY_HISTORY_LIMIT) {
    device.telemetryHistory.splice(
      0,
      device.telemetryHistory.length - TELEMETRY_HISTORY_LIMIT
    );
  }

  markDeviceSeen(deviceId);
  logger.debug(`Telemetry received from ${deviceId}`);
}

module.exports = {
  handleTelemetryMessage,
  TELEMETRY_HISTORY_LIMIT
};
