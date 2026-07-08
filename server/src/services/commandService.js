const crypto = require("crypto");

const { commandTimeoutMs } = require("../config");
const { devices } = require("../devices");
const createHttpError = require("../httpError");
const { commandTopic } = require("../topics");

const pendingCommands = new Map();
let mqttClient = null;
let mqttConnectedGetter = () => false;

function setMqttClient(client, isConnected) {
  mqttClient = client;
  mqttConnectedGetter = isConnected;
}

function buildCommandPayload(deviceId, command, params = {}) {
  return {
    commandId: `cmd_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    deviceId,
    command,
    params,
    sentAt: new Date().toISOString()
  };
}

function hasPendingCommandForDevice(deviceId) {
  return Array.from(pendingCommands.keys()).some((key) => key.startsWith(`${deviceId}:`));
}

function resolvePendingCommand(deviceId, commandId, ack) {
  const pendingCommand = pendingCommands.get(`${deviceId}:${commandId}`);

  if (pendingCommand) {
    pendingCommand.resolve(ack);
  }
}

function rejectAllPendingCommands(error) {
  Array.from(pendingCommands.values()).forEach((pendingCommand) => {
    pendingCommand.reject(error);
  });
}

function publishCommandAndWaitForAck(deviceId, payload) {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !mqttConnectedGetter()) {
      reject(createHttpError(503, "MQTT broker is not connected"));
      return;
    }

    if (hasPendingCommandForDevice(deviceId) && payload.command !== "stop") {
      reject(createHttpError(409, "Device already has a pending command"));
      return;
    }

    const pendingKey = `${deviceId}:${payload.commandId}`;
    let settled = false;

    function cleanup() {
      const pendingCommand = pendingCommands.get(pendingKey);

      if (pendingCommand) {
        clearTimeout(pendingCommand.timeout);
      }

      pendingCommands.delete(pendingKey);
      devices[deviceId].busy = hasPendingCommandForDevice(deviceId);
    }

    function finishResolve(ack) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(ack);
    }

    function finishReject(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    const timeout = setTimeout(() => {
      finishReject(createHttpError(504, "Timeout waiting for device acknowledgement"));
    }, commandTimeoutMs);

    pendingCommands.set(pendingKey, {
      deviceId,
      commandId: payload.commandId,
      resolve: finishResolve,
      reject: finishReject,
      timeout,
      createdAt: new Date().toISOString()
    });

    devices[deviceId].busy = true;

    mqttClient.publish(
      commandTopic(deviceId),
      JSON.stringify(payload),
      { qos: 1, retain: false },
      (error) => {
        if (error) {
          finishReject(createHttpError(502, "Failed to publish MQTT command"));
        }
      }
    );
  });
}

module.exports = {
  buildCommandPayload,
  hasPendingCommandForDevice,
  publishCommandAndWaitForAck,
  rejectAllPendingCommands,
  resolvePendingCommand,
  setMqttClient
};
