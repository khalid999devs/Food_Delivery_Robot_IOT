const { addTimeline, getLatestActiveOrder } = require("./orderStore");

const OBSTACLE_DETECTED_VALUES = new Set(["obstacle_stop", "obstacle_detected"]);

function getSafetyValue(payload) {
  return String(payload.event || payload.status || payload.type || "").toLowerCase();
}

function updateOrderFromRobotSafetyPayload(payload) {
  const value = getSafetyValue(payload);
  let message = "";

  if (OBSTACLE_DETECTED_VALUES.has(value)) {
    message = "Obstacle detected. Robot stopped.";
  } else if (value === "obstacle_cleared") {
    message = "Obstacle cleared.";
  } else {
    return false;
  }

  const order = getLatestActiveOrder();

  if (!order) {
    return true;
  }

  if (OBSTACLE_DETECTED_VALUES.has(value)) {
    order.status = "blocked_by_obstacle";
  }

  const latestSafetyEntry = [...order.timeline]
    .reverse()
    .find((item) => item.message.startsWith("Obstacle "));

  if (latestSafetyEntry?.message !== message) {
    addTimeline(order, message.includes("stopped") ? "warning" : "success", message, payload);
  }

  return true;
}

module.exports = {
  updateOrderFromRobotSafetyPayload
};
