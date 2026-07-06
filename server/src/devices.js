const devices = {
  robot_car_001: {
    name: "Robot Delivery Car",
    type: "robot",
    online: false,
    busy: false,
    latestStatus: null,
    latestEvent: null,
    lastSeenAt: null
  },
  vending_001: {
    name: "Vending Machine",
    type: "vending",
    online: false,
    busy: false,
    latestStatus: null,
    latestEvent: null,
    lastSeenAt: null
  }
};

const allowedRobotCommands = [
  "ping",
  "forward",
  "backward",
  "left",
  "right",
  "stop",
  "go_to_vending",
  "prepare_for_pickup",
  "start_delivery",
  "go_to_station",
  "delivery_loaded",
  "return_home",
  "line_follow_on",
  "line_follow_off",
  "cancel_delivery"
];

const allowedVendingCommands = [
  "ping",
  "dispense",
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

function hasDevice(deviceId) {
  return Boolean(devices[deviceId]);
}

module.exports = {
  devices,
  getAllowedCommands,
  hasDevice,
  markDeviceSeen
};
