const config = require("../config");
const { devices, refreshDeviceOnlineStates } = require("../devices");
const logger = require("../logger");
const {
  buildCommandPayload,
  hasPendingCommandForDevice,
  publishCommandAndWaitForAck
} = require("./commandService");

let checkTimer = null;
let healthSweepTimer = null;
let periodicPingTimer = null;
let checking = false;
let lastCheckAt = null;

function getDeviceCheckState() {
  return {
    checking,
    lastCheckAt
  };
}

async function pingDevice(deviceId, reason) {
  const payload = buildCommandPayload(deviceId, "ping", { reason });
  const ack = await publishCommandAndWaitForAck(deviceId, payload);

  devices[deviceId].online = true;
  devices[deviceId].latestStatus = ack;
  devices[deviceId].lastSeenAt = new Date().toISOString();
}

async function checkKnownDevices(reason = "startup") {
  if (checking) {
    return;
  }

  checking = true;
  lastCheckAt = new Date().toISOString();

  const checks = Object.keys(devices).map(async (deviceId) => {
    if (hasPendingCommandForDevice(deviceId)) {
      return;
    }

    try {
      await pingDevice(deviceId, reason);
    } catch (error) {
      if (error.statusCode === 504) {
        devices[deviceId].online = false;
      }

      logger.debug(`Device check failed for ${deviceId}: ${error.message}`);
    }
  });

  await Promise.all(checks);
  checking = false;
}

function scheduleKnownDeviceCheck(reason = "startup") {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkKnownDevices(reason);
  }, config.startupDeviceCheckDelayMs);
}

function startDeviceHealthMonitoring() {
  clearInterval(healthSweepTimer);
  clearInterval(periodicPingTimer);
  refreshDeviceOnlineStates();
  healthSweepTimer = setInterval(
    refreshDeviceOnlineStates,
    Math.max(1000, config.deviceHealthSweepMs)
  );
  healthSweepTimer.unref();
  periodicPingTimer = setInterval(
    () => checkKnownDevices("periodic"),
    Math.max(5000, config.devicePingIntervalMs)
  );
  periodicPingTimer.unref();
}

function stopDeviceHealthMonitoring() {
  clearTimeout(checkTimer);
  clearInterval(healthSweepTimer);
  clearInterval(periodicPingTimer);
  checkTimer = null;
  healthSweepTimer = null;
  periodicPingTimer = null;
}

module.exports = {
  checkKnownDevices,
  getDeviceCheckState,
  scheduleKnownDeviceCheck,
  startDeviceHealthMonitoring,
  stopDeviceHealthMonitoring
};
