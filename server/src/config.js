require("dotenv").config();

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : String(value).trim();
}

function readNumber(name, fallback) {
  const rawValue = readEnv(name);

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

const frontendOrigins = readEnv("FRONTEND_ORIGIN")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const nodeEnv = readEnv("NODE_ENV", "development");

const config = {
  nodeEnv,
  port: readNumber("PORT", 3000),
  mqttHost: readEnv("MQTT_HOST"),
  mqttPort: readNumber("MQTT_PORT", 8883),
  mqttUsername: readEnv("MQTT_USERNAME"),
  mqttPassword: readEnv("MQTT_PASSWORD"),
  apiKey: readEnv("API_KEY"),
  frontendOrigin: frontendOrigins[0] || "",
  frontendOrigins,
  commandTimeoutMs: readNumber("COMMAND_TIMEOUT_MS", 5000),
  requestJsonLimit: readEnv("REQUEST_JSON_LIMIT", "64kb"),
  startupDeviceCheckDelayMs: readNumber("STARTUP_DEVICE_CHECK_DELAY_MS", 1200),
  logLevel: readEnv("LOG_LEVEL", nodeEnv === "production" ? "off" : "info")
};

config.isProduction = config.nodeEnv === "production";
config.mqttUrl = config.mqttHost ? `mqtts://${config.mqttHost}:${config.mqttPort}` : "";

function getConfigStatus() {
  return {
    nodeEnv: config.nodeEnv,
    mqttConfigured: Boolean(config.mqttHost && config.mqttUsername && config.mqttPassword),
    apiKeyEnabled: Boolean(config.apiKey),
    logLevel: config.logLevel,
    corsMode: config.frontendOrigins.length ? "restricted" : "open",
    allowedOrigins: config.frontendOrigins
  };
}

function assertProductionConfig() {
  if (!config.isProduction) {
    return;
  }

  const required = ["MQTT_HOST", "MQTT_USERNAME", "MQTT_PASSWORD", "API_KEY", "FRONTEND_ORIGIN"];
  const missing = required.filter((name) => !readEnv(name));

  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}

config.getConfigStatus = getConfigStatus;
config.assertProductionConfig = assertProductionConfig;

module.exports = config;
