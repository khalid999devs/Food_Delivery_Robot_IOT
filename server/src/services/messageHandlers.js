const { devices, hasDevice, markDeviceSeen } = require("../devices");
const logger = require("../logger");
const { resolvePendingCommand } = require("./commandService");
const {
  updateOrderFromRobotPayload,
  updateOrderFromVendingEvent,
  updateOrderFromVendingStatus
} = require("./orderMqttHandlers");

function parseJsonMessage(message) {
  const raw = message.toString();

  try {
    return {
      payload: JSON.parse(raw),
      raw
    };
  } catch (error) {
    return {
      error,
      raw
    };
  }
}

function markInvalidMessage(deviceId, channel, parsed) {
  const invalidPayload = {
    status: "invalid_json",
    message: `Backend received ${channel} message but JSON was invalid`,
    error: parsed.error.message,
    raw: parsed.raw,
    receivedAt: new Date().toISOString()
  };

  if (channel === "status") {
    devices[deviceId].latestStatus = invalidPayload;
  } else {
    devices[deviceId].latestEvent = invalidPayload;
  }

  markDeviceSeen(deviceId);
  logger.warn(`Invalid MQTT ${channel} JSON from ${deviceId}: ${parsed.error.message}`);
}

function parseDeviceTopic(topic) {
  const parts = topic.split("/");

  if (parts.length !== 3 || parts[0] !== "devices") {
    return null;
  }

  const [, deviceId, channel] = parts;

  if (!hasDevice(deviceId)) {
    return null;
  }

  return { deviceId, channel };
}

function isMismatchedDevice(payload, deviceId, topic) {
  if (!payload.deviceId || payload.deviceId === deviceId) {
    return false;
  }

  logger.warn(`Ignored message with mismatched deviceId on topic ${topic}`);
  return true;
}

function handleStatusMessage(topic, message) {
  const topicInfo = parseDeviceTopic(topic);

  if (!topicInfo || topicInfo.channel !== "status") {
    return;
  }

  const { deviceId } = topicInfo;
  const parsed = parseJsonMessage(message);

  if (parsed.error) {
    markInvalidMessage(deviceId, "status", parsed);
    return;
  }

  const { payload } = parsed;

  if (isMismatchedDevice(payload, deviceId, topic)) {
    return;
  }

  devices[deviceId].latestStatus = payload;
  markDeviceSeen(deviceId);
  logger.debug(`Status received from ${deviceId}: ${payload.status || "unknown"}`);

  if (payload.commandId) {
    resolvePendingCommand(deviceId, payload.commandId, payload);
  }

  if (deviceId === "vending_001") {
    updateOrderFromVendingStatus(payload);
  }

  if (deviceId === "robot_car_001") {
    updateOrderFromRobotPayload(payload);
  }
}

function handleEventMessage(topic, message) {
  const topicInfo = parseDeviceTopic(topic);

  if (!topicInfo || topicInfo.channel !== "event") {
    return;
  }

  const { deviceId } = topicInfo;
  const parsed = parseJsonMessage(message);

  if (parsed.error) {
    markInvalidMessage(deviceId, "event", parsed);
    return;
  }

  const { payload } = parsed;

  if (isMismatchedDevice(payload, deviceId, topic)) {
    return;
  }

  devices[deviceId].latestEvent = payload;
  markDeviceSeen(deviceId);
  logger.debug(`Event received from ${deviceId}: ${payload.event || payload.type || "unknown"}`);

  if (deviceId === "vending_001") {
    updateOrderFromVendingEvent(payload);
  }

  if (deviceId === "robot_car_001") {
    updateOrderFromRobotPayload(payload);
  }
}

module.exports = {
  handleEventMessage,
  handleStatusMessage
};
