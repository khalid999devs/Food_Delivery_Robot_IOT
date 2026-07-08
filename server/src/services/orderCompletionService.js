const { getOrder, setOrderStatus } = require("./orderStore");
const { buildCommandPayload, publishCommandAndWaitForAck } = require("./commandService");

const deliveryReceiptDevices = ["robot_car_001", "vending_001"];

function buildReceiptParams(order) {
  return {
    orderId: order.orderId,
    targetStation: order.targetStation,
    products: order.products
  };
}

async function notifyDevice(deviceId, order) {
  const command = buildCommandPayload(deviceId, "delivery_received", buildReceiptParams(order));

  try {
    const ack = await publishCommandAndWaitForAck(deviceId, command);
    const ackStatus = String(ack.status || "success").toLowerCase();
    const success = !["blocked", "error", "failed"].includes(ackStatus);
    return { deviceId, success, command, ack };
  } catch (error) {
    return {
      deviceId,
      success: false,
      command,
      error: {
        message: error.message,
        statusCode: error.statusCode || 500
      }
    };
  }
}

async function publishDeliveryReceived(order) {
  const results = await Promise.all(
    deliveryReceiptDevices.map((deviceId) => notifyDevice(deviceId, order))
  );

  return {
    allAcknowledged: results.every((result) => result.success),
    results
  };
}

async function markDeliveryReceived(orderId) {
  const order = getOrder(orderId);

  if (!order) {
    return null;
  }

  if (order.status === "delivery_received") {
    return {
      order,
      notifications: order.deliveryReceivedNotifications || null
    };
  }

  setOrderStatus(order, "delivery_received", "Delivery received by customer");
  const notifications = await publishDeliveryReceived(order);
  order.deliveryReceivedNotifications = notifications;

  setOrderStatus(
    order,
    "delivery_received",
    notifications.allAcknowledged
      ? "Delivery receipt acknowledged by robot and vending"
      : "Delivery receipt sent with a device acknowledgement issue",
    notifications
  );

  setTimeout(() => {
    if (order.status === "delivery_received") {
      setOrderStatus(order, "completed", "Order completed. System ready for next order");
    }
  }, 5000);

  return {
    order,
    notifications
  };
}

module.exports = {
  markDeliveryReceived
};
