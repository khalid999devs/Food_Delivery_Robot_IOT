const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const { buildOrderRobotParams } = require("./orderCommandParams");
const { addTimeline, getOrder, setOrderStatus } = require("./orderStore");
const { ensureRobotAutonomousMode } = require("./robotAutonomyService");

function getAckStatus(ack) {
  return String(ack?.status || "").toLowerCase();
}

function applyRobotDeliveryAck(order, ack, successMessage) {
  const status = getAckStatus(ack);
  const values = [ack?.status, ack?.event, ack?.type, ack?.robotMode]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
  const obstacleResponse = values.some((value) =>
    ["blocked", "obstacle_stop"].includes(value)
  );
  order.robotDeliveryAck = ack;

  if (obstacleResponse) {
    setOrderStatus(order, "blocked_by_obstacle", "Robot delivery blocked by obstacle", ack);
    return false;
  }

  const rejected = values.some(
    (value) =>
      ["failed", "error", "rejected", "delivery_start_rejected"].includes(value) ||
      value.endsWith("_rejected")
  );

  if (rejected) {
    setOrderStatus(order, "failed", "Robot rejected delivery start", ack);
    return false;
  }

  if (!["delivery_started", "delivery_queued", "success"].includes(status)) {
    setOrderStatus(order, "failed", "Robot returned an unexpected delivery acknowledgement", ack);
    return false;
  }

  if (["delivery_started", "success"].includes(status)) {
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
    return null;
  }

  let payload = null;

  try {
    const autonomy = await ensureRobotAutonomousMode("start_delivery");
    addTimeline(order, "info", "Robot manual mode disabled before delivery", autonomy);
    payload = buildCommandPayload(
      "robot_car_001",
      "start_delivery",
      buildOrderRobotParams(order)
    );
    order.robotDeliveryCommandId = payload.commandId;
    setOrderStatus(order, "robot_delivery_sent", "Robot delivery command sent", payload);
    const ack = await publishCommandAndWaitForAck("robot_car_001", payload);
    const success = applyRobotDeliveryAck(order, ack, "Robot delivery started");
    return {
      success,
      statusCode: success ? 200 : order.status === "blocked_by_obstacle" ? 409 : 502,
      message: success ? "Robot delivery started" : "Robot delivery command rejected",
      command: payload,
      ack
    };
  } catch (error) {
    setOrderStatus(order, "failed", "Robot delivery command failed", {
      message: error.message
    });
    return {
      success: false,
      statusCode: error.statusCode || 500,
      message: error.message,
      command: payload
    };
  }
}

module.exports = {
  applyRobotDeliveryAck,
  getAckStatus,
  sendRobotDeliveryForOrder
};
