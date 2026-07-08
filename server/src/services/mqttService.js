const mqtt = require("mqtt");

const config = require("../config");
const createHttpError = require("../httpError");
const logger = require("../logger");
const { eventTopic, statusTopic, telemetryTopic } = require("../topics");
const { rejectAllPendingCommands, setMqttClient } = require("./commandService");
const { scheduleKnownDeviceCheck } = require("./deviceHealthService");
const { handleEventMessage, handleStatusMessage } = require("./messageHandlers");
const { handleTelemetryMessage } = require("./telemetryHandler");
const {
  handleMqttTestMessage,
  mqttTestTopic,
  setMqttTestClient
} = require("./mqttTestService");

let mqttClient = null;
let mqttConnected = false;

function isMqttConnected() {
  return mqttConnected;
}

function startMqtt() {
  if (!config.mqttHost) {
    logger.warn("MQTT_HOST is not set. MQTT connection is disabled.");
    return;
  }

  mqttClient = mqtt.connect(config.mqttUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    clientId: `iot_backend_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    reconnectPeriod: 2000,
    connectTimeout: 8000,
    clean: true
  });

  setMqttClient(mqttClient, isMqttConnected);
  setMqttTestClient(mqttClient, isMqttConnected);

  function markDisconnected(message) {
    mqttConnected = false;
    rejectAllPendingCommands(createHttpError(503, message));
  }

  mqttClient.on("connect", () => {
    mqttConnected = true;
    logger.info("Connected to MQTT broker");

    const subscriptions = [
      statusTopic("+"),
      eventTopic("+"),
      telemetryTopic("+"),
      mqttTestTopic
    ];

    mqttClient.subscribe(subscriptions, { qos: 1 }, (error) => {
      if (error) {
        logger.error(`Failed to subscribe to MQTT topics: ${error.message}`);
        return;
      }

      logger.info(`Subscribed to ${subscriptions.join(", ")}`);
      scheduleKnownDeviceCheck("mqtt_connected");
    });
  });

  mqttClient.on("reconnect", () => {
    markDisconnected("MQTT broker is reconnecting");
  });

  mqttClient.on("close", () => {
    markDisconnected("MQTT broker connection closed");
  });

  mqttClient.on("offline", () => {
    markDisconnected("MQTT broker is offline");
  });

  mqttClient.on("error", (error) => {
    markDisconnected("MQTT broker error");
    logger.error(`MQTT error: ${error.message}`);
  });

  mqttClient.on("message", (topic, message) => {
    try {
      if (topic === mqttTestTopic) {
        handleMqttTestMessage(message);
        return;
      }

      if (topic.endsWith("/status")) {
        handleStatusMessage(topic, message);
        return;
      }

      if (topic.endsWith("/event")) {
        handleEventMessage(topic, message);
        return;
      }

      if (topic.endsWith("/telemetry")) {
        handleTelemetryMessage(topic, message);
      }
    } catch (error) {
      logger.error(`MQTT message handler failed for ${topic}: ${error.message}`);
    }
  });
}

function stopMqtt() {
  if (!mqttClient) {
    return;
  }

  mqttConnected = false;
  rejectAllPendingCommands(createHttpError(503, "Server is shutting down"));
  mqttClient.end(false);
}

module.exports = {
  isMqttConnected,
  startMqtt,
  stopMqtt
};
