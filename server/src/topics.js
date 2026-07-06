function commandTopic(deviceId) {
  return `devices/${deviceId}/command`;
}

function statusTopic(deviceId) {
  return `devices/${deviceId}/status`;
}

function eventTopic(deviceId) {
  return `devices/${deviceId}/event`;
}

module.exports = {
  commandTopic,
  statusTopic,
  eventTopic
};
