const { getOrder, setOrderStatus } = require("./orderStore");

function markDeliveryReceived(orderId) {
  const order = getOrder(orderId);

  if (!order) {
    return null;
  }

  if (order.status === "delivery_received") {
    return order;
  }

  setOrderStatus(order, "delivery_received", "Delivery received by customer");

  setTimeout(() => {
    if (order.status === "delivery_received") {
      setOrderStatus(order, "completed", "Order completed. System ready for next order");
    }
  }, 5000);

  return order;
}

module.exports = {
  markDeliveryReceived
};
