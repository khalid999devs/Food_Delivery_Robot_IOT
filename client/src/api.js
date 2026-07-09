export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const API_KEY = import.meta.env.VITE_API_KEY || "";
const configuredTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
const API_TIMEOUT_MS = Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : 15000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`API request timed out after ${Math.round(API_TIMEOUT_MS / 1000)}s`);
    }

    throw new Error(`API request failed: ${error.message}`);
  } finally {
    window.clearTimeout(timeoutId);
  }

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function getHealth() {
  return request("/health");
}

export function getDevices() {
  return request("/api/devices");
}

export function getLatestDeviceTelemetry(deviceId) {
  return request(`/api/devices/${deviceId}/telemetry/latest`);
}

export function getDeviceTelemetryHistory(deviceId) {
  return request(`/api/devices/${deviceId}/telemetry/history`);
}

export function startDeviceTelemetry(deviceId) {
  return request(`/api/devices/${deviceId}/telemetry/start`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function stopDeviceTelemetry(deviceId) {
  return request(`/api/devices/${deviceId}/telemetry/stop`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getCurrentOrder() {
  return request("/api/orders/current");
}

export function sendDeviceCommand(deviceId, command, params = {}) {
  return request(`/api/devices/${deviceId}/command`, {
    method: "POST",
    body: JSON.stringify({ command, params })
  });
}

export function runDispenseAndDeliverOrder(a, b, targetStation, userLocation = null) {
  return request("/api/orders/dispense-and-deliver", {
    method: "POST",
    body: JSON.stringify({ a, b, targetStation, userLocation })
  });
}

export function markCurrentOrderDeliveryReceived() {
  return request("/api/orders/current/delivery-received", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function forceResetCurrentOrder() {
  return request("/api/orders/current/force-reset", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function confirmOrderLoaded(orderId) {
  return request(`/api/orders/${orderId}/confirm-loaded`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function forceOrderProgress(orderId, step) {
  return request(`/api/orders/${orderId}/demo-progress`, {
    method: "POST",
    body: JSON.stringify({ step })
  });
}

export function simulateOrderVendingCompleted(orderId) {
  return request(`/api/orders/${orderId}/simulate-vending-completed`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function runMqttTestPing() {
  return request("/api/mqtt/test-ping", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function runRobotArrivedFlow(orderId, a = 1, b = 0) {
  return request("/api/flows/robot-arrived", {
    method: "POST",
    body: JSON.stringify({ orderId, a, b })
  });
}
