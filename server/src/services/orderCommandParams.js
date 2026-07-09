function buildOrderRobotParams(order) {
  const a = Number(order.products?.a || 0);
  const b = Number(order.products?.b || 0);

  return {
    orderId: order.orderId,
    targetStation: order.targetStation,
    a,
    b,
    expectedProducts: Math.max(1, a + b),
    ...(order.userLocation ? { userLocation: order.userLocation } : {})
  };
}

module.exports = {
  buildOrderRobotParams
};
