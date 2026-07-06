const config = require("../config");
const { devices } = require("../devices");
const logger = require("../logger");
const { buildCommandPayload, publishCommandAndWaitForAck } = require("./commandService");

let checkTimer = null;
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

  for (const deviceId of Object.keys(devices)) {
    try {
      await pingDevice(deviceId, reason);
    } catch (error) {
      if (error.statusCode === 504) {
        devices[deviceId].online = false;
      }

      logger.debug(`Device check failed for ${deviceId}: ${error.message}`);
    }
  }

  checking = false;
}

function scheduleKnownDeviceCheck(reason = "startup") {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkKnownDevices(reason);
  }, config.startupDeviceCheckDelayMs);
}

module.exports = {
  checkKnownDevices,
  getDeviceCheckState,
  scheduleKnownDeviceCheck
};
