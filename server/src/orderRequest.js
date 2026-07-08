const allowedStations = new Set([
  "station_1",
  "station_2",
  "station_3",
  "station_4"
]);

function toQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : NaN;
}

function parseUserLocation(value) {
  if (value === undefined || value === null) {
    return { value: null };
  }

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const accuracy = Number(value.accuracy);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { error: "userLocation must contain valid latitude and longitude" };
  }

  return {
    value: {
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      capturedAt: value.capturedAt || new Date().toISOString()
    }
  };
}

function parseOrderRequest(body = {}) {
  const a = toQuantity(body.a);
  const b = toQuantity(body.b);
  const { targetStation } = body;

  if (!allowedStations.has(targetStation)) {
    return {
      error: "Invalid targetStation",
      allowedStations: Array.from(allowedStations)
    };
  }

  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b <= 0) {
    return {
      error: "Products a and b must be numbers >= 0, and a + b must be greater than 0"
    };
  }

  const location = parseUserLocation(body.userLocation);

  if (location.error) {
    return { error: location.error };
  }

  return {
    value: {
      a,
      b,
      targetStation,
      userLocation: location.value
    }
  };
}

module.exports = {
  allowedStations,
  parseOrderRequest,
  parseUserLocation
};
