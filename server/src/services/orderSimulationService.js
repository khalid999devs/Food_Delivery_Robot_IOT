const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const { applyRobotDeliveryAck, getAckStatus } = require("./robotDeliveryService");
const { addTimeline, getOrder, setOrderStatus } = require("./orderStore");

async function simulateVendingCompleted(orderId) {
  const order = getOrder(orderId);

  if (!order) {
    return null;
  }

  const payload = buildCommandPayload("robot_car_001", "simulate_order_completed", {
    orderId,
    targetStation: order.targetStation,
    userLocation: order.userLocation
  });

  order.robotDeliveryCommandId = payload.commandId;
  addTimeline(order, "info", "Vending completion simulation sent to robot", payload);

  try {
    const ack = await publishCommandAndWaitForAck("robot_car_001", payload);
    const status = getAckStatus(ack);
    const accepted = applyRobotDeliveryAck(order, ack, "Simulated completion started robot delivery");

    if (!accepted) {
      return {
        statusCode: status === "blocked" ? 409 : 502,
        body: {
          success: false,
          message:
            status === "blocked"
              ? "Delivery was blocked by obstacle"
              : "Robot rejected simulated vending completion",
          order,
          command: payload,
          ack
        }
      };
    }

    if (status === "delivery_queued") {
      order.status = "robot_delivery_sent";
    }

    return {
      statusCode: 200,
      body: {
        success: true,
        message: "Vending completion simulated and robot delivery requested",
        order,
        command: payload,
        ack
      }
    };
  } catch (error) {
    setOrderStatus(order, "failed", "Vending completion simulation failed", {
      message: error.message
    });
    return {
      statusCode: error.statusCode || 500,
      body: { success: false, message: error.message, order, command: payload }
    };
  }
}

module.exports = {
  simulateVendingCompleted
};
