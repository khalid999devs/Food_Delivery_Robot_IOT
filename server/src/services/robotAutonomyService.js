const createHttpError = require("../httpError");
const {
  buildCommandPayload,
  publishCommandAndWaitForAck
} = require("./commandService");

const autonomousCommands = new Set([
  "go_to_station",
  "simulate_order_completed",
  "start_delivery"
]);

function isAutonomousCommand(deviceId, command) {
  return deviceId === "robot_car_001" && autonomousCommands.has(command);
}

async function ensureRobotAutonomousMode(source) {
  const payload = buildCommandPayload("robot_car_001", "manual_off", {
    reason: source
  });
  const ack = await publishCommandAndWaitForAck("robot_car_001", payload);
  const values = [ack?.status, ack?.event, ack?.type, ack?.robotMode]
    .map((value) => String(value || "").toLowerCase());

  if (values.some((value) => ["blocked", "failed", "error"].includes(value))) {
    throw createHttpError(409, "Robot could not leave manual mode");
  }

  return { command: payload, ack };
}

module.exports = {
  ensureRobotAutonomousMode,
  isAutonomousCommand
};
