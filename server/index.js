const cors = require("cors");
const express = require("express");

const config = require("./src/config");
const createCorsOptions = require("./src/corsOptions");
const logger = require("./src/logger");
const deviceRoutes = require("./src/routes/deviceRoutes");
const flowRoutes = require("./src/routes/flowRoutes");
const mqttRoutes = require("./src/routes/mqttRoutes");
const orderRoutes = require("./src/routes/orderRoutes");
const orderSimulationRoutes = require("./src/routes/orderSimulationRoutes");
const rootRoutes = require("./src/routes/rootRoutes");
const telemetryRoutes = require("./src/routes/telemetryRoutes");
const errorHandler = require("./src/middleware/errorHandler");
const notFound = require("./src/middleware/notFound");
const requestContext = require("./src/middleware/requestContext");
const securityHeaders = require("./src/middleware/securityHeaders");
const {
  startDeviceHealthMonitoring,
  stopDeviceHealthMonitoring
} = require("./src/services/deviceHealthService");
const { startMqtt, stopMqtt } = require("./src/services/mqttService");

config.assertProductionConfig();

const app = express();

app.disable("x-powered-by");
app.use(requestContext);
app.use(securityHeaders);
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: config.requestJsonLimit }));

app.use(rootRoutes);
app.use("/api/devices/:deviceId/telemetry", telemetryRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/flows", flowRoutes);
app.use("/api/mqtt", mqttRoutes);
app.use("/api/orders", orderSimulationRoutes);
app.use("/api/orders", orderRoutes);
app.use(notFound);
app.use(errorHandler);

startDeviceHealthMonitoring();
startMqtt();

const server = app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error(`Port ${config.port} is already in use. Stop the old server or set PORT.`);
    process.exit(1);
  }

  throw error;
});

function shutdown(signal) {
  logger.info(`${signal} received. Shutting down server.`);
  stopDeviceHealthMonitoring();
  stopMqtt();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
