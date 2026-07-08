function displayValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return `${value}${suffix}`;
}

function yesNo(value) {
  if (value === null || value === undefined) {
    return "--";
  }

  return value ? "Yes" : "No";
}

function SensorValue({ label, value }) {
  return (
    <div className="sensor-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TelemetryPanel({ telemetry, isLoading, error, onClose, isStopping }) {
  const gps = telemetry?.gps || {};
  const cart = telemetry?.cart || {};
  const ultrasonic = telemetry?.ultrasonic || {};
  const distanceCm = Number(ultrasonic.distanceCm);
  const hasValidDistance = Number.isFinite(distanceCm) && distanceCm >= 0;
  const danger =
    Boolean(ultrasonic.obstacleStopActive) || (hasValidDistance && distanceCm < 8);

  return (
    <div className="telemetry-overlay" role="presentation">
      <section
        className="telemetry-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-title"
      >
        <header className="telemetry-header">
          <div>
            <p className="eyebrow">Robot Car 001</p>
            <h2 id="telemetry-title">Live Sensors / Telemetry</h2>
            <p>{telemetry ? "Receiving live robot data" : "Waiting for first telemetry sample"}</p>
          </div>
          <button
            type="button"
            className={`telemetry-close ${isStopping ? "is-loading" : ""}`}
            onClick={onClose}
            disabled={isStopping}
            aria-label="Stop telemetry and close"
            title="Stop telemetry and close"
          >
            {isStopping ? "Stopping..." : "X"}
          </button>
        </header>

        {danger ? (
          <div className="obstacle-warning" role="alert">
            Obstacle under 8 cm - robot stopped
          </div>
        ) : null}
        {error ? <div className="error-banner telemetry-error">{error}</div> : null}
        {isLoading && !telemetry ? (
          <div className="notice-banner telemetry-loading">Loading live sensor data...</div>
        ) : null}

        <div className="telemetry-grid">
          <article className="sensor-card">
            <h3>GPS</h3>
            {!gps.valid ? <p className="sensor-note">Waiting for GPS fix</p> : null}
            <div className="sensor-values">
              <SensorValue label="Valid" value={yesNo(gps.valid)} />
              <SensorValue label="Satellites" value={displayValue(gps.satellites)} />
              <SensorValue label="Latitude" value={displayValue(gps.lat)} />
              <SensorValue label="Longitude" value={displayValue(gps.lng)} />
              <SensorValue label="Age" value={displayValue(gps.ageMs, " ms")} />
            </div>
          </article>

          <article className="sensor-card">
            <h3>Cart IR Product Detection</h3>
            <div className="sensor-values">
              <SensorValue label="IR1 state" value={displayValue(cart.ir1State)} />
              <SensorValue label="IR2 state" value={displayValue(cart.ir2State)} />
              <SensorValue label="IR1 count" value={displayValue(cart.ir1Count)} />
              <SensorValue label="IR2 count" value={displayValue(cart.ir2Count)} />
              <SensorValue label="Product count" value={displayValue(cart.productCount)} />
              <SensorValue
                label="Expected products"
                value={displayValue(cart.expectedProductCount)}
              />
              <SensorValue label="Detection armed" value={yesNo(cart.productDetectionArmed)} />
            </div>
          </article>

          <article className={`sensor-card ultrasonic-card ${danger ? "danger" : ""}`}>
            <h3>Ultrasonic Safety</h3>
            <div className="sensor-values">
              <SensorValue
                label="Distance"
                value={displayValue(ultrasonic.distanceCm, " cm")}
              />
              <SensorValue
                label="Stop threshold"
                value={displayValue(ultrasonic.stopThresholdCm ?? 8, " cm")}
              />
              <SensorValue
                label="Clear threshold"
                value={displayValue(ultrasonic.clearThresholdCm ?? 12, " cm")}
              />
              <SensorValue
                label="Obstacle stop active"
                value={yesNo(ultrasonic.obstacleStopActive)}
              />
            </div>
          </article>

          <article className="sensor-card">
            <h3>Robot</h3>
            <div className="sensor-values">
              <SensorValue label="Robot mode" value={displayValue(telemetry?.robotMode)} />
              <SensorValue label="Manual mode" value={yesNo(telemetry?.manualMode)} />
              <SensorValue label="Arduino ready" value={yesNo(telemetry?.arduinoReady)} />
              <SensorValue label="Auto started" value={yesNo(telemetry?.autoStarted)} />
              <SensorValue label="Auto finished" value={yesNo(telemetry?.autoFinished)} />
              <SensorValue
                label="Delivery allowed"
                value={yesNo(telemetry?.deliveryAllowed)}
              />
              <SensorValue label="Uptime" value={displayValue(telemetry?.uptimeMs, " ms")} />
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

export default TelemetryPanel;
