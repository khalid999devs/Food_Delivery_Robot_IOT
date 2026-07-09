function getLoadConfirmationError(order) {
  if (["blocked_by_obstacle", "failed"].includes(order.status)) {
    return {
      statusCode: 409,
      message: "Order cannot confirm loading in its current state"
    };
  }

  if (Number(order.detectedProductCount || 0) < 1) {
    return {
      statusCode: 409,
      message: "Waiting for at least one cart IR product detection"
    };
  }

  return null;
}

module.exports = {
  getLoadConfirmationError
};
