const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const { addTimeline, getOrder, setOrderStatus } = require("./orderStore");

function getAckStatus(ack) {
  return String(ack?.status || "").toLowerCase();
}

function applyRobotDeliveryAck(order, ack, successMessage) {
  const status = getAckStatus(ack);
  order.robotDeliveryAck = ack;

  if (status === "blocked") {
    setOrderStatus(order, "blocked_by_obstacle", "Robot delivery blocked by obstacle", ack);
    return false;
  }

  if (["failed", "error"].includes(status)) {
    setOrderStatus(order, "failed", "Robot delivery acknowledgement failed", ack);
    return false;
  }

  if (status === "delivery_started") {
    order.status = "robot_delivering";
  }

  addTimeline(order, "success", successMessage, ack);
  return true;
}

async function sendRobotDeliveryForOrder(orderId) {
  const order = getOrder(orderId);

  if (
    !order ||
    ["failed", "blocked_by_obstacle"].includes(order.status) ||
    order.robotDeliveryCommandId
  ) {
    return;
  }

  const payload = buildCommandPayload("robot_car_001", "start_delivery", {
    orderId,
    targetStation: order.targetStation,
    userLocation: order.userLocation
  });

  order.robotDeliveryCommandId = payload.commandId;
  setOrderStatus(order, "robot_delivery_sent", "Robot delivery command sent", payload);

  try {
    const ack = await publishCommandAndWaitForAck("robot_car_001", payload);
    applyRobotDeliveryAck(order, ack, "Robot delivery started");
  } catch (error) {
    setOrderStatus(order, "failed", "Robot delivery command failed", {
      message: error.message
    });
  }
}

module.exports = {
  applyRobotDeliveryAck,
  getAckStatus,
  sendRobotDeliveryForOrder
};
