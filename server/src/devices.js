const config = require("./config");

const devices = {
  robot_car_001: {
    name: "Robot Delivery Car",
    type: "robot",
    online: false,
    busy: false,
    latestStatus: null,
    latestEvent: null,
    latestTelemetry: null,
    telemetryHistory: [],
    lastSeenAt: null
  },
  vending_001: {
    name: "Vending Machine",
    type: "vending",
    online: false,
    busy: false,
    latestStatus: null,
    latestEvent: null,
    latestTelemetry: null,
    telemetryHistory: [],
    lastSeenAt: null
  }
};

const allowedRobotCommands = [
  "ping",
  "status",
  "manual_on",
  "manual_off",
  "forward",
  "backward",
  "left",
  "right",
  "stop",
  "go_to_vending",
  "prepare_for_pickup",
  "start_delivery",
  "simulate_order_completed",
  "delivery_received",
  "go_to_station",
  "delivery_loaded",
  "return_home",
  "line_follow_on",
  "line_follow_off",
  "cancel_delivery",
  "start_telemetry",
  "stop_telemetry"
];

const allowedVendingCommands = [
  "ping",
  "dispense",
  "delivery_received",
  "refill",
  "status",
  "reset",
  "lock_door",
  "unlock_door"
];

function getAllowedCommands(deviceId) {
  const device = devices[deviceId];

  if (!device) {
    return [];
  }

  if (device.type === "robot") {
    return allowedRobotCommands;
  }

  if (device.type === "vending") {
    return allowedVendingCommands;
  }

  return [];
}

function markDeviceSeen(deviceId) {
  devices[deviceId].online = true;
  devices[deviceId].lastSeenAt = new Date().toISOString();
}

function refreshDeviceOnlineStates(now = Date.now()) {
  for (const device of Object.values(devices)) {
    if (!device.online) {
      continue;
    }

    const lastSeenMs = Date.parse(device.lastSeenAt);
    const isStale =
      !Number.isFinite(lastSeenMs) ||
      now - lastSeenMs > config.deviceOfflineTimeoutMs;

    if (isStale) {
      device.online = false;
    }
  }

  return devices;
}

function hasDevice(deviceId) {
  return Boolean(devices[deviceId]);
}

module.exports = {
  devices,
  getAllowedCommands,
  hasDevice,
  markDeviceSeen,
  refreshDeviceOnlineStates
};
