import { useEffect, useMemo, useState } from "react";
import {
  API_BASE_URL,
  getCurrentOrder,
  getDevices,
  getHealth,
  markCurrentOrderDeliveryReceived,
  runDispenseAndDeliverOrder,
  runMqttTestPing,
  runRobotArrivedFlow,
  sendDeviceCommand
} from "./api.js";

const robotCommands = [
  { label: "Ping", command: "ping", params: {} },
  { label: "Forward", command: "forward", params: { speed: 160, durationMs: 1000 } },
  { label: "Backward", command: "backward", params: { speed: 160, durationMs: 1000 } },
  { label: "Left", command: "left", params: { speed: 140, durationMs: 500 } },
  { label: "Right", command: "right", params: { speed: 140, durationMs: 500 } },
  { label: "Stop", command: "stop", params: {} },
  { label: "Line Follow On", command: "line_follow_on", params: {} },
  { label: "Line Follow Off", command: "line_follow_off", params: {} }
];

const stationOptions = [
  { label: "Station 1", value: "station_1" },
  { label: "Station 2", value: "station_2" },
  { label: "Station 3", value: "station_3" }
];

const activeOrderStatuses = new Set([
  "created",
  "robot_prepare_sent",
  "robot_ready",
  "vending_dispense_sent",
  "vending_accepted",
  "vending_dispensing",
  "vending_progress",
  "vending_completed",
  "robot_delivery_sent",
  "robot_delivering",
  "station_reached",
  "delivery_received"
]);

const orderStatusLabels = {
  created: "Created",
  robot_prepare_sent: "Preparing robot",
  robot_ready: "Robot ready for pickup",
  vending_dispense_sent: "Starting vending dispense",
  vending_accepted: "Vending accepted order",
  vending_dispensing: "Vending dispensing",
  vending_progress: "Product detected / dispensing progress",
  vending_completed: "Vending completed",
  robot_delivery_sent: "Robot delivery command sent",
  robot_delivering: "Robot delivering to station",
  station_reached: "Robot reached station",
  delivery_received: "Delivery received",
  completed: "Delivery completed",
  failed: "Failed"
};

function formatJson(value) {
  if (!value) {
    return "No data yet";
  }

  return JSON.stringify(value, null, 2);
}

function getStatusNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function clampQuantity(value, stock) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? Math.floor(numericValue) : 0;
  const nonNegativeValue = Math.max(0, safeValue);

  return stock === null ? nonNegativeValue : Math.min(nonNegativeValue, stock);
}

function getStatusBoolean(value) {
  return value === true || value === 1 || value === "true" || value === "1";
}

function getNonNegativeNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

function formatStatusLabel(value) {
  if (!value) {
    return "Unknown";
  }

  const normalizedValue = String(value).replace(/_/g, " ");
  return normalizedValue.charAt(0).toUpperCase() + normalizedValue.slice(1);
}

function isOrderActive(order) {
  return Boolean(order && activeOrderStatuses.has(order.status));
}

function formatOrderStatus(status) {
  return orderStatusLabels[status] || formatStatusLabel(status);
}

function formatStation(value) {
  return stationOptions.find((station) => station.value === value)?.label || value || "--";
}

function formatTime(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function DeviceCard({
  title,
  deviceId,
  device,
  commands,
  onCommand,
  loadingAction,
  mqttConnected,
  isInitialLoading,
  currentOrder,
  onDeliveryReceived
}) {
  const canReceiveDelivery =
    deviceId === "robot_car_001" &&
    currentOrder &&
    ["robot_delivery_sent", "robot_delivering", "station_reached"].includes(currentOrder.status);
  const commandsDisabled = Boolean(loadingAction) || isInitialLoading || !mqttConnected;

  return (
    <section className="card device-card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          <p>{deviceId}</p>
        </div>
        <span className={`status-pill ${device?.online ? "online" : "offline"}`}>
          {isInitialLoading ? "Checking" : device?.online ? "Online" : "Offline"}
        </span>
      </div>

      {!mqttConnected ? (
        <div className="notice-banner compact">MQTT is disconnected. Commands are paused.</div>
      ) : null}

      <dl className="device-meta">
        <div>
          <dt>Last seen</dt>
          <dd>{device?.lastSeenAt || "Never"}</dd>
        </div>
        <div>
          <dt>Busy</dt>
          <dd>{device?.busy ? "Yes" : "No"}</dd>
        </div>
      </dl>

      {deviceId === "robot_car_001" ? (
        <div className="robot-status-grid">
          <div>
            <span>Status</span>
            <strong>{formatStatusLabel(device?.latestStatus?.status)}</strong>
          </div>
          <div>
            <span>Message</span>
            <strong>{device?.latestStatus?.message || "--"}</strong>
          </div>
          <div>
            <span>Order ID</span>
            <strong>{device?.latestStatus?.orderId || "--"}</strong>
          </div>
          <div>
            <span>Target Station</span>
            <strong>{formatStation(device?.latestStatus?.targetStation)}</strong>
          </div>
          <div>
            <span>Latest Event</span>
            <strong>{device?.latestEvent?.event || "--"}</strong>
          </div>
        </div>
      ) : null}

      <div className="command-grid">
        {commands.map((item) => {
          const actionKey = `${deviceId}:${item.command}`;
          const isLoading = loadingAction === actionKey;

          return (
            <button
              key={actionKey}
              type="button"
              className={`${item.command === "stop" ? "danger-button" : ""} ${
                isLoading ? "is-loading" : ""
              }`}
              onClick={() => onCommand(deviceId, item.command, item.params, actionKey)}
              disabled={commandsDisabled}
              aria-busy={isLoading}
            >
              {isLoading ? "Sending..." : item.label}
            </button>
          );
        })}
      </div>

      {canReceiveDelivery ? (
        <button
          type="button"
          className={`success-button full-width-action ${
            loadingAction === "order:delivery-received" ? "is-loading" : ""
          }`}
          onClick={onDeliveryReceived}
          disabled={Boolean(loadingAction)}
          aria-busy={loadingAction === "order:delivery-received"}
        >
          {loadingAction === "order:delivery-received" ? "Confirming..." : "Delivery Received"}
        </button>
      ) : null}

      <div className="device-data-grid">
        <div>
          <h3>Latest Status</h3>
          <pre>{formatJson(device?.latestStatus)}</pre>
        </div>
        <div>
          <h3>Latest Event</h3>
          <pre>{formatJson(device?.latestEvent)}</pre>
        </div>
      </div>
    </section>
  );
}

function VendingCard({
  device,
  robot,
  currentOrder,
  loadingAction,
  vendingQtyA,
  vendingQtyB,
  selectedStation,
  setVendingQtyA,
  setVendingQtyB,
  setSelectedStation,
  refillA,
  refillB,
  adminPin,
  setRefillA,
  setRefillB,
  setAdminPin,
  mqttConnected,
  isInitialLoading,
  onPing,
  onDispenseAll,
  onRefreshStatus,
  onReset,
  onRefill
}) {
  const status = device?.latestStatus || {};
  const stockA = getStatusNumber(status.qtyA);
  const stockB = getStatusNumber(status.qtyB);
  const queueLength = getStatusNumber(status.queueLength);
  const dispensedCount = getStatusNumber(status.dispensedCount);
  const totalOrderItems = getStatusNumber(status.totalOrderItems);
  const dispensing = getStatusBoolean(status.dispensing);
  const stateValue = String(status.status || "").toLowerCase();
  const stateLabel = formatStatusLabel(status.status);
  const busyStates = ["accepted", "dispensing", "progress"];
  const currentProduct = status.currentProduct || "--";
  const activeOrderId = status.activeOrderId || "--";
  const statusMessage = status.message || "--";
  const progress =
    dispensedCount !== null && totalOrderItems !== null ? `${dispensedCount} / ${totalOrderItems}` : "-";
  const activeOrder = isOrderActive(currentOrder);
  const commandBlocked = Boolean(loadingAction) || isInitialLoading || !mqttConnected;
  const vendingBusy = Boolean(
    device?.busy ||
      dispensing ||
      (queueLength !== null && queueLength > 0) ||
      busyStates.includes(stateValue)
  );
  const disableAll = commandBlocked;
  const disableDispense =
    disableAll ||
    vendingBusy ||
    activeOrder ||
    !device?.online ||
    !robot?.online ||
    !selectedStation ||
    vendingQtyA + vendingQtyB <= 0;
  const refillAmountA = getNonNegativeNumber(refillA);
  const refillAmountB = getNonNegativeNumber(refillB);
  const disableRefill = disableAll || !adminPin || refillAmountA + refillAmountB <= 0;

  function changeQtyA(delta) {
    setVendingQtyA((quantity) => clampQuantity(quantity + delta, stockA));
  }

  function changeQtyB(delta) {
    setVendingQtyB((quantity) => clampQuantity(quantity + delta, stockB));
  }

  return (
    <section className="card device-card vending-card">
      <div className="card-header">
        <div>
          <h2>Vending Machine</h2>
          <p>vending_001</p>
        </div>
        <span className={`status-pill ${device?.online ? "online" : "offline"}`}>
          {isInitialLoading ? "Checking" : device?.online ? "Online" : "Offline"}
        </span>
      </div>

      {!mqttConnected ? (
        <div className="notice-banner compact">MQTT is disconnected. Vending commands are paused.</div>
      ) : null}

      <dl className="device-meta">
        <div>
          <dt>Last seen</dt>
          <dd>{device?.lastSeenAt || "Never"}</dd>
        </div>
        <div>
          <dt>Busy</dt>
          <dd>{device?.busy ? "Yes" : "No"}</dd>
        </div>
      </dl>

      <div className="vending-stats">
        <div className="stock-chip">
          <span>Stock A</span>
          <strong>{stockA ?? "--"}</strong>
        </div>
        <div className="stock-chip">
          <span>Stock B</span>
          <strong>{stockB ?? "--"}</strong>
        </div>
        <div className="stock-chip">
          <span>State</span>
          <strong>{stateLabel}</strong>
        </div>
        <div className="stock-chip">
          <span>Queue</span>
          <strong>{queueLength ?? "--"}</strong>
        </div>
      </div>

      <div className="progress-box">
        <div>
          <span>Message</span>
          <strong>{statusMessage}</strong>
        </div>
        <div>
          <span>Current product</span>
          <strong>{currentProduct}</strong>
        </div>
        <div>
          <span>Active order ID</span>
          <strong>{activeOrderId}</strong>
        </div>
        <div>
          <span>Progress</span>
          <strong>{progress}</strong>
        </div>
      </div>

      <div className="cart-panel">
        <h3>Vending Cart</h3>
        {activeOrder ? (
          <div className="active-order-warning">
            Active order in progress: {currentOrder.orderId} ({formatOrderStatus(currentOrder.status)})
          </div>
        ) : null}
        <div className="quantity-row">
          <span>Product A</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => changeQtyA(-1)}
              disabled={disableAll || vendingQtyA <= 0}
            >
              -
            </button>
            <strong>{vendingQtyA}</strong>
            <button
              type="button"
              onClick={() => changeQtyA(1)}
              disabled={disableAll || (stockA !== null && vendingQtyA >= stockA)}
            >
              +
            </button>
          </div>
        </div>
        <div className="quantity-row">
          <span>Product B</span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => changeQtyB(-1)}
              disabled={disableAll || vendingQtyB <= 0}
            >
              -
            </button>
            <strong>{vendingQtyB}</strong>
            <button
              type="button"
              onClick={() => changeQtyB(1)}
              disabled={disableAll || (stockB !== null && vendingQtyB >= stockB)}
            >
              +
            </button>
          </div>
        </div>

        <div className="station-selector">
          <span>Target station</span>
          <div>
            {stationOptions.map((station) => (
              <button
                key={station.value}
                type="button"
                className={selectedStation === station.value ? "selected" : ""}
                onClick={() => setSelectedStation(station.value)}
                disabled={disableAll}
              >
                {station.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="vending-actions">
        <button
          type="button"
          className={loadingAction === "vending_001:ping" ? "is-loading" : ""}
          onClick={onPing}
          disabled={disableAll}
          aria-busy={loadingAction === "vending_001:ping"}
        >
          {loadingAction === "vending_001:ping" ? "Sending..." : "Vending Ping"}
        </button>
        <button
          type="button"
          className={loadingAction === "vending_001:status" ? "is-loading" : ""}
          onClick={onRefreshStatus}
          disabled={disableAll}
          aria-busy={loadingAction === "vending_001:status"}
        >
          {loadingAction === "vending_001:status" ? "Refreshing..." : "Refresh Vending Status"}
        </button>
        <button
          type="button"
          className={loadingAction === "order:dispense-and-deliver" ? "is-loading" : ""}
          onClick={onDispenseAll}
          disabled={disableDispense}
          aria-busy={loadingAction === "order:dispense-and-deliver"}
        >
          {loadingAction === "order:dispense-and-deliver"
            ? "Starting..."
            : "Dispense All & Send Robot"}
        </button>
        <button
          type="button"
          className={loadingAction === "vending_001:reset" ? "is-loading" : ""}
          onClick={onReset}
          disabled={disableAll}
          aria-busy={loadingAction === "vending_001:reset"}
        >
          {loadingAction === "vending_001:reset" ? "Resetting..." : "Reset Vending Machine"}
        </button>
      </div>

      <div className="refill-panel">
        <h3>Refill Stock</h3>
        <div className="refill-grid">
          <label>
            <span>Admin PIN</span>
            <input
              type="password"
              value={adminPin}
              onChange={(event) => setAdminPin(event.target.value)}
              placeholder="1234"
              disabled={disableAll}
            />
          </label>
          <label>
            <span>Add A</span>
            <input
              type="number"
              min="0"
              value={refillA}
              onChange={(event) => setRefillA(event.target.value)}
              placeholder="0"
              disabled={disableAll}
            />
          </label>
          <label>
            <span>Add B</span>
            <input
              type="number"
              min="0"
              value={refillB}
              onChange={(event) => setRefillB(event.target.value)}
              placeholder="0"
              disabled={disableAll}
            />
          </label>
        </div>
        <button
          type="button"
          className={`primary-button ${loadingAction === "vending_001:refill" ? "is-loading" : ""}`}
          onClick={onRefill}
          disabled={disableRefill}
          aria-busy={loadingAction === "vending_001:refill"}
        >
          {loadingAction === "vending_001:refill" ? "Refilling..." : "Refill Stock"}
        </button>
      </div>

      <div className="device-data-grid">
        <div>
          <h3>Latest Status</h3>
          <pre>{formatJson(device?.latestStatus)}</pre>
        </div>
        <div>
          <h3>Latest Event</h3>
          <pre>{formatJson(device?.latestEvent)}</pre>
        </div>
      </div>
    </section>
  );
}

function AckValue({ value }) {
  return <strong>{value ? formatStatusLabel(value.status || "received") : "--"}</strong>;
}

function OrderProgressCard({ order }) {
  if (!order) {
    return (
      <section className="card order-card">
        <div className="card-header">
          <div>
            <h2>Order Progress</h2>
            <p>No orders yet</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card order-card">
      <div className="card-header">
        <div>
          <h2>Order Progress</h2>
          <p>{order.orderId}</p>
        </div>
        <span className={`status-pill ${order.status === "failed" ? "offline" : "online"}`}>
          {formatOrderStatus(order.status)}
        </span>
      </div>

      <div className="order-summary-grid">
        <div>
          <span>Target station</span>
          <strong>{formatStation(order.targetStation)}</strong>
        </div>
        <div>
          <span>Products</span>
          <strong>A {order.products?.a ?? 0} / B {order.products?.b ?? 0}</strong>
        </div>
        <div>
          <span>Robot prepare ack</span>
          <AckValue value={order.robotReadyAck} />
        </div>
        <div>
          <span>Vending ack</span>
          <AckValue value={order.vendingAck} />
        </div>
        <div>
          <span>Robot delivery ack</span>
          <AckValue value={order.robotDeliveryAck} />
        </div>
      </div>

      <div className="timeline">
        {(order.timeline || []).map((item, index) => (
          <div key={`${item.at}-${index}`} className={`timeline-item ${item.type}`}>
            <span>{item.at}</span>
            <strong>{item.message}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [health, setHealth] = useState(null);
  const [devices, setDevices] = useState({});
  const [loadingAction, setLoadingAction] = useState("");
  const [latestResponse, setLatestResponse] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [vendingQtyA, setVendingQtyA] = useState(0);
  const [vendingQtyB, setVendingQtyB] = useState(0);
  const [refillA, setRefillA] = useState("");
  const [refillB, setRefillB] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [selectedStation, setSelectedStation] = useState("station_1");
  const [currentOrder, setCurrentOrder] = useState(null);

  const robot = devices.robot_car_001;
  const vending = devices.vending_001;
  const vendingStockA = getStatusNumber(vending?.latestStatus?.qtyA);
  const vendingStockB = getStatusNumber(vending?.latestStatus?.qtyB);

  const healthLabel = useMemo(() => {
    if (!health) {
      return "Checking";
    }

    return health.mqttConnected ? "Connected" : "Disconnected";
  }, [health]);

  useEffect(() => {
    setVendingQtyA((quantity) => clampQuantity(quantity, vendingStockA));
  }, [vendingStockA]);

  useEffect(() => {
    setVendingQtyB((quantity) => clampQuantity(quantity, vendingStockB));
  }, [vendingStockB]);

  async function refreshState({ showLoading = false } = {}) {
    if (showLoading) {
      setIsRefreshing(true);
    }

    const [healthResult, devicesResult, orderResult] = await Promise.allSettled([
      getHealth(),
      getDevices(),
      getCurrentOrder()
    ]);
    const refreshErrors = [];

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
    } else {
      refreshErrors.push(healthResult.reason);
    }

    if (devicesResult.status === "fulfilled") {
      const devicesResponse = devicesResult.value;
      setDevices(devicesResponse.devices || {});
    } else {
      refreshErrors.push(devicesResult.reason);
    }

    if (orderResult.status === "fulfilled") {
      setCurrentOrder(orderResult.value.order || null);
    } else {
      refreshErrors.push(orderResult.reason);
    }

    if (refreshErrors.length) {
      const error = refreshErrors[0];
      setErrorMessage(error.data?.message || error.message);
    } else {
      setErrorMessage("");
    }

    setLastUpdatedAt(new Date().toISOString());
    setIsInitialLoading(false);
    setIsRefreshing(false);
  }

  useEffect(() => {
    refreshState();
    const intervalId = window.setInterval(refreshState, 3000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function runAction(actionKey, action) {
    setLoadingAction(actionKey);
    setErrorMessage("");

    try {
      const response = await action();
      setLatestResponse(response);
      await refreshState();
      return response;
    } catch (error) {
      const response = error.data || {
        success: false,
        message: error.message
      };

      setLatestResponse(response);
      setErrorMessage(response.message || error.message);
      return null;
    } finally {
      setLoadingAction("");
    }
  }

  function handleCommand(deviceId, command, params, actionKey) {
    runAction(actionKey, () => sendDeviceCommand(deviceId, command, params));
  }

  function handleVendingPing() {
    runAction("vending_001:ping", () => sendDeviceCommand("vending_001", "ping", {}));
  }

  async function handleVendingDispenseAll() {
    const response = await runAction("order:dispense-and-deliver", () =>
      runDispenseAndDeliverOrder(vendingQtyA, vendingQtyB, selectedStation)
    );

    if (response?.success) {
      setVendingQtyA(0);
      setVendingQtyB(0);
    }
  }

  function handleVendingRefreshStatus() {
    runAction("vending_001:status", () => sendDeviceCommand("vending_001", "status", {}));
  }

  function handleVendingReset() {
    runAction("vending_001:reset", () => sendDeviceCommand("vending_001", "reset", {}));
  }

  async function handleVendingRefill() {
    const response = await runAction("vending_001:refill", () =>
      sendDeviceCommand("vending_001", "refill", {
        pin: adminPin,
        a: getNonNegativeNumber(refillA),
        b: getNonNegativeNumber(refillB)
      })
    );

    if (response?.success) {
      setRefillA("");
      setRefillB("");
    }
  }

  function handleFlow() {
    runAction("flow:robot-arrived", () => runRobotArrivedFlow("ORD_1001", 1, 0));
  }

  function handleMqttTestPing() {
    runAction("mqtt:test-ping", runMqttTestPing);
  }

  function handleDeliveryReceived() {
    runAction("order:delivery-received", markCurrentOrderDeliveryReceived);
  }

  function handleRefreshNow() {
    refreshState({ showLoading: true });
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">IoT Lab Demo</p>
          <h1>Robot Vending IoT Control Panel</h1>
          <p className="api-target">API: {API_BASE_URL}</p>
        </div>
        <div className="header-status">
          <div className={`connection-badge ${health?.mqttConnected ? "online" : "offline"}`}>
            MQTT {healthLabel}
          </div>
          <div className="sync-status">
            <span className={isRefreshing ? "sync-dot active" : "sync-dot"} />
            {isRefreshing
              ? "Refreshing"
              : lastUpdatedAt
                ? `Updated ${formatTime(lastUpdatedAt)}`
                : "Not synced"}
          </div>
        </div>
      </header>

      <section className="card health-card">
        <div>
          <h2>Server Health</h2>
          <p>
            {isInitialLoading
              ? "Loading server state"
              : health?.server === "ok"
                ? "Server is running"
                : "Waiting for server"}
          </p>
        </div>
        <div className="health-stats">
          <div>
            <span>MQTT</span>
            <strong>{healthLabel}</strong>
          </div>
          <div>
            <span>Uptime</span>
            <strong>{health?.uptimeMs ? `${Math.round(health.uptimeMs / 1000)}s` : "-"}</strong>
          </div>
          <div>
            <span>API Key</span>
            <strong>{health?.apiKeyEnabled ? "Enabled" : "Not set"}</strong>
          </div>
          <div>
            <span>CORS</span>
            <strong>{formatStatusLabel(health?.corsMode)}</strong>
          </div>
          <div>
            <span>Device Check</span>
            <strong>
              {health?.deviceCheck?.checking
                ? "Checking"
                : health?.deviceCheck?.lastCheckAt
                  ? formatTime(health.deviceCheck.lastCheckAt)
                  : "--"}
            </strong>
          </div>
        </div>
        <button
          type="button"
          className={`secondary-button ${isRefreshing ? "is-loading" : ""}`}
          onClick={handleRefreshNow}
          disabled={Boolean(loadingAction) || isRefreshing}
          aria-busy={isRefreshing}
        >
          {isRefreshing ? "Refreshing..." : "Refresh Now"}
        </button>
      </section>

      {isInitialLoading ? <div className="notice-banner">Loading dashboard data...</div> : null}
      {health && !health.mqttConnected ? (
        <div className="warning-banner">MQTT is disconnected. Commands will be available after the backend reconnects.</div>
      ) : null}

      <section className="card mqtt-test-card">
        <div>
          <h2>MQTT Cloud Test</h2>
          <p>Publishes a test message to HiveMQ Cloud and waits for the backend to receive it back.</p>
        </div>
        <button
          type="button"
          className={`primary-button ${loadingAction === "mqtt:test-ping" ? "is-loading" : ""}`}
          onClick={handleMqttTestPing}
          disabled={Boolean(loadingAction) || isInitialLoading || !health?.mqttConnected}
          aria-busy={loadingAction === "mqtt:test-ping"}
        >
          {loadingAction === "mqtt:test-ping" ? "Testing..." : "Test MQTT Cloud Ping"}
        </button>
      </section>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <div className="dashboard-grid">
        <DeviceCard
          title="Robot Delivery Car"
          deviceId="robot_car_001"
          device={robot}
          commands={robotCommands}
          onCommand={handleCommand}
          loadingAction={loadingAction}
          mqttConnected={Boolean(health?.mqttConnected)}
          isInitialLoading={isInitialLoading}
          currentOrder={currentOrder}
          onDeliveryReceived={handleDeliveryReceived}
        />

        <VendingCard
          device={vending}
          robot={robot}
          currentOrder={currentOrder}
          loadingAction={loadingAction}
          vendingQtyA={vendingQtyA}
          vendingQtyB={vendingQtyB}
          selectedStation={selectedStation}
          setVendingQtyA={setVendingQtyA}
          setVendingQtyB={setVendingQtyB}
          setSelectedStation={setSelectedStation}
          refillA={refillA}
          refillB={refillB}
          adminPin={adminPin}
          setRefillA={setRefillA}
          setRefillB={setRefillB}
          setAdminPin={setAdminPin}
          mqttConnected={Boolean(health?.mqttConnected)}
          isInitialLoading={isInitialLoading}
          onPing={handleVendingPing}
          onDispenseAll={handleVendingDispenseAll}
          onRefreshStatus={handleVendingRefreshStatus}
          onReset={handleVendingReset}
          onRefill={handleVendingRefill}
        />
      </div>

      <OrderProgressCard order={currentOrder} />

      <section className="card flow-card">
        <div>
          <h2>Flow Control</h2>
          <p>Order ORD_1001, Product A x1, Product B x0</p>
        </div>
        <button
          type="button"
          className={`primary-button ${loadingAction === "flow:robot-arrived" ? "is-loading" : ""}`}
          onClick={handleFlow}
          disabled={Boolean(loadingAction) || isInitialLoading || !health?.mqttConnected}
          aria-busy={loadingAction === "flow:robot-arrived"}
        >
          {loadingAction === "flow:robot-arrived"
            ? "Running..."
            : "Robot Arrived -> Dispense A=1 B=0 -> Delivery Loaded"}
        </button>
      </section>

      <section className="card response-card">
        <div className="card-header compact-header">
          <div>
            <h2>Latest API Response</h2>
            <p>{loadingAction ? "Waiting for current action response" : "Most recent backend response"}</p>
          </div>
          {loadingAction ? <span className="status-pill online">Working</span> : null}
        </div>
        <pre>{formatJson(latestResponse)}</pre>
      </section>
    </main>
  );
}

export default App;
