const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");
const { buildOrderRobotParams } = require("./orderCommandParams");
const { canUpdateOrder } = require("./orderLookupService");
const { getOrder, setOrderStatus } = require("./orderStore");
const { getLoadConfirmationError } = require("./loadConfirmationPolicy");
const { sendRobotDeliveryForOrder } = require("./robotDeliveryService");

const pendingLoadConfirmations = new Map();
const successfulLoadStatuses = new Set(["product_loaded", "success"]);
const blockedStatuses = new Set(["blocked", "obstacle_stop"]);

function response(statusCode, body) {
  return { statusCode, body };
}

async function publishLoadAttempt(order, source, attempt) {
  const payload = buildCommandPayload(
    "robot_car_001",
    "delivery_loaded",
    buildOrderRobotParams(order)
  );

  order.deliveryLoadedCommandId = payload.commandId;
  order.deliveryLoadedCommandIds.push(payload.commandId);
  setOrderStatus(
    order,
    "robot_load_confirmation_sent",
    `Robot load confirmation sent (${source}, attempt ${attempt})`,
    payload
  );

  const ack = await publishCommandAndWaitForAck("robot_car_001", payload);
  return { ack, payload };
}

async function runLoadConfirmation(order, source) {
  if (order.robotDeliveryCommandId) {
    return response(200, {
      success: true,
      message: "Robot delivery was already requested",
      order
    });
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { ack, payload } = await publishLoadAttempt(order, source, attempt);
      const status = String(ack?.status || "").toLowerCase();
      const obstacleResponse = [ack?.status, ack?.event, ack?.type, ack?.robotMode]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => blockedStatuses.has(value));

      if (obstacleResponse) {
        setOrderStatus(order, "blocked_by_obstacle", "Robot load confirmation blocked by obstacle", ack);
        return response(409, {
          success: false,
          message: "Robot load confirmation blocked by obstacle",
          order,
          command: payload,
          ack
        });
      }

      if (!successfulLoadStatuses.has(status)) {
        setOrderStatus(order, "failed", "Robot load confirmation failed", ack);
        return response(502, {
          success: false,
          message: "Robot load confirmation failed",
          order,
          command: payload,
          ack
        });
      }

      order.deliveryLoadedAck = ack;
      setOrderStatus(order, "robot_loaded", "Robot acknowledged loaded products", ack);
      const delivery = await sendRobotDeliveryForOrder(order.orderId);

      return response(delivery?.success === false ? delivery.statusCode || 502 : 200, {
        success: delivery?.success !== false,
        message:
          delivery?.success === false
            ? delivery.message
            : "Robot load confirmed and delivery started",
        order,
        loadAck: ack,
        delivery
      });
    } catch (error) {
      const canRetry = error.statusCode === 504 && attempt === 1;

      if (canRetry) {
        setOrderStatus(order, "robot_load_confirmation_sent", "Robot load confirmation timed out; retrying once");
        continue;
      }

      setOrderStatus(order, "failed", "Robot load confirmation failed", {
        message: error.message,
        statusCode: error.statusCode || 500
      });
      return response(error.statusCode || 500, {
        success: false,
        message: "Robot load confirmation failed",
        order
      });
    }
  }

  return response(504, {
    success: false,
    message: "Robot load confirmation failed",
    order
  });
}

function confirmOrderLoaded(orderId, source = "website") {
  const order = getOrder(orderId);

  if (!canUpdateOrder(order)) {
    return Promise.resolve(null);
  }

  const policyError = getLoadConfirmationError(order);

  if (policyError) {
    return Promise.resolve(response(policyError.statusCode, {
      success: false,
      message: policyError.message,
      order
    }));
  }

  if (pendingLoadConfirmations.has(orderId)) {
    return pendingLoadConfirmations.get(orderId);
  }

  const confirmation = runLoadConfirmation(order, source).finally(() => {
    pendingLoadConfirmations.delete(orderId);
  });
  pendingLoadConfirmations.set(orderId, confirmation);
  return confirmation;
}

module.exports = {
  confirmOrderLoaded,
  successfulLoadStatuses
};
