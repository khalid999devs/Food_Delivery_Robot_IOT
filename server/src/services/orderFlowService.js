const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const { createOrder, getOrder, setOrderStatus } = require("./orderStore");
function isSuccessfulRobotAck(ack) {
  return ["success", "ready_for_pickup", "ready"].includes(String(ack?.status || "").toLowerCase());
}

function isSuccessfulVendingAck(ack) {
  return ["accepted", "success", "ready"].includes(String(ack?.status || "").toLowerCase());
}

function routeResponse(statusCode, body) {
  return { statusCode, body };
}

async function startDispenseAndDeliver({ a, b, targetStation, userLocation }) {
  const orderId = `ORD_${Date.now()}`;
  const order = createOrder({ orderId, targetStation, a, b, userLocation });
  const expectedProducts = Math.max(1, a + b);

  try {
    const robotPayload = buildCommandPayload("robot_car_001", "prepare_for_pickup", {
      orderId,
      targetStation,
      a,
      b,
      expectedProducts,
      userLocation
    });
    order.robotPrepareCommandId = robotPayload.commandId;
    setOrderStatus(order, "robot_prepare_sent", "Robot prepare command sent", robotPayload);

    const robotAck = await publishCommandAndWaitForAck("robot_car_001", robotPayload);
    order.robotReadyAck = robotAck;

    if (!isSuccessfulRobotAck(robotAck)) {
      const blocked = String(robotAck?.status || "").toLowerCase() === "blocked";
      setOrderStatus(
        order,
        blocked ? "blocked_by_obstacle" : "failed",
        blocked ? "Robot preparation blocked by obstacle" : "Robot prepare acknowledgement failed",
        robotAck
      );
      return routeResponse(blocked ? 409 : 502, {
          success: false,
          message: blocked
            ? "Robot preparation was blocked by obstacle"
            : "Robot did not acknowledge prepare_for_pickup successfully",
          order,
          robotAck
        });
    }

    setOrderStatus(order, "robot_ready", "Robot is ready for pickup", robotAck);

    const vendingPayload = buildCommandPayload("vending_001", "dispense", {
      orderId,
      a,
      b,
      targetStation
    });
    order.vendingCommandId = vendingPayload.commandId;
    setOrderStatus(order, "vending_dispense_sent", "Vending dispense command sent", vendingPayload);

    const vendingAck = await publishCommandAndWaitForAck("vending_001", vendingPayload);
    order.vendingAck = vendingAck;

    if (!isSuccessfulVendingAck(vendingAck)) {
      setOrderStatus(order, "failed", "Vending acknowledgement was not successful", vendingAck);
      return routeResponse(502, {
          success: false,
          message: "Vending did not accept the dispense order",
          order,
          robotAck,
          vendingAck
        });
    }

    setOrderStatus(order, "vending_accepted", "Vending accepted order", vendingAck);

    return routeResponse(200, {
        success: true,
        message: "Order started. Robot is ready and vending dispense has started.",
        order,
        robotAck,
        vendingAck
      });
  } catch (error) {
    setOrderStatus(order, "failed", error.message, {
      statusCode: error.statusCode || 500
    });
    return routeResponse(error.statusCode || 500, {
        success: false,
        message: error.message,
        order
      });
  }
}

async function cancelOrder(orderId) {
  const order = getOrder(orderId);

  if (!order) {
    return null;
  }

  const result = { robotAck: null, vendingAck: null };

  try {
    result.robotAck = await publishCommandAndWaitForAck(
      "robot_car_001",
      buildCommandPayload("robot_car_001", "stop", { orderId })
    );
  } catch (error) {
    result.robotError = error.message;
  }

  try {
    result.vendingAck = await publishCommandAndWaitForAck(
      "vending_001",
      buildCommandPayload("vending_001", "reset", { orderId })
    );
  } catch (error) {
    result.vendingError = error.message;
  }

  setOrderStatus(order, "failed", "Order cancelled", result);
  return { order, ...result };
}

module.exports = {
  cancelOrder,
  startDispenseAndDeliver
};
