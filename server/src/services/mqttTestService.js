const crypto = require("crypto");

const config = require("../config");
const createHttpError = require("../httpError");

const mqttTestTopic = "backend/test/ping";
const pendingMqttPings = new Map();

let mqttClient = null;
let mqttConnectedGetter = () => false;

function setMqttTestClient(client, isConnected) {
  mqttClient = client;
  mqttConnectedGetter = isConnected;
}

function cleanupPing(pingId) {
  const pendingPing = pendingMqttPings.get(pingId);

  if (pendingPing) {
    clearTimeout(pendingPing.timeout);
  }

  pendingMqttPings.delete(pingId);
}

function handleMqttTestMessage(message) {
  let payload = null;

  try {
    payload = JSON.parse(message.toString());
  } catch {
    return;
  }

  const pendingPing = pendingMqttPings.get(payload.pingId);

  if (!pendingPing) {
    return;
  }

  cleanupPing(payload.pingId);
  pendingPing.resolve({
    success: true,
    message: "MQTT cloud round-trip successful",
    topic: mqttTestTopic,
    sent: pendingPing.payload,
    received: {
      ...payload,
      receivedAt: new Date().toISOString()
    }
  });
}

function runMqttTestPing() {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !mqttConnectedGetter()) {
      reject(createHttpError(503, "MQTT broker is not connected"));
      return;
    }

    const pingId = `mqtt_ping_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const payload = {
      pingId,
      type: "mqtt_test_ping",
      message: "Hello HiveMQ Cloud",
      sentAt: new Date().toISOString()
    };

    const timeout = setTimeout(() => {
      cleanupPing(pingId);
      reject(createHttpError(504, "Timeout waiting for MQTT cloud test response"));
    }, config.commandTimeoutMs);

    pendingMqttPings.set(pingId, {
      payload,
      resolve,
      reject,
      timeout
    });

    mqttClient.subscribe(mqttTestTopic, { qos: 1 }, (subscribeError) => {
      if (subscribeError) {
        cleanupPing(pingId);
        reject(createHttpError(502, "Failed to subscribe to MQTT test topic"));
        return;
      }

      mqttClient.publish(
        mqttTestTopic,
        JSON.stringify(payload),
        { qos: 1, retain: false },
        (publishError) => {
          if (publishError) {
            cleanupPing(pingId);
            reject(createHttpError(502, "Failed to publish MQTT test ping"));
          }
        }
      );
    });
  });
}

module.exports = {
  handleMqttTestMessage,
  mqttTestTopic,
  runMqttTestPing,
  setMqttTestClient
};
