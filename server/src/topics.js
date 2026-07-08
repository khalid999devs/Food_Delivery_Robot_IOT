function commandTopic(deviceId) {
  return `devices/${deviceId}/command`;
}

function statusTopic(deviceId) {
  return `devices/${deviceId}/status`;
}

function eventTopic(deviceId) {
  return `devices/${deviceId}/event`;
}

function telemetryTopic(deviceId) {
  return `devices/${deviceId}/telemetry`;
}

module.exports = {
  commandTopic,
  eventTopic,
  statusTopic,
  telemetryTopic
};
