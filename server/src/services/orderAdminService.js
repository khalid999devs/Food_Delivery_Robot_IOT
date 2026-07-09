const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const {
  addTimeline,
  getLatestActiveOrder,
  nowIso
} = require("./orderStore");

const resetCommands = [
  { deviceId: "robot_car_001", command: "cancel_delivery" },
  { deviceId: "vending_001", command: "reset" }
];

async function resetDevice(item, orderId) {
  const payload = buildCommandPayload(item.deviceId, item.command, {
    orderId,
    reason: "admin_force_reset"
  });

  try {
    const ack = await publishCommandAndWaitForAck(item.deviceId, payload);
    return { deviceId: item.deviceId, success: true, command: payload, ack };
  } catch (error) {
    return {
      deviceId: item.deviceId,
      success: false,
      command: payload,
      error: {
        message: error.message,
        statusCode: error.statusCode || 500
      }
    };
  }
}

async function forceResetCurrentOrder() {
  const order = getLatestActiveOrder();

  if (!order) {
    return null;
  }

  order.adminResetAt = nowIso();
  order.status = "completed";
  addTimeline(order, "warning", "Order force-reset by admin");

  const deviceResets = await Promise.all(
    resetCommands.map((item) => resetDevice(item, order.orderId))
  );
  order.adminResetDeviceResults = deviceResets;
  addTimeline(order, "info", "Device reset commands completed best-effort", deviceResets);

  return {
    order,
    deviceResets
  };
}

module.exports = {
  forceResetCurrentOrder
};
