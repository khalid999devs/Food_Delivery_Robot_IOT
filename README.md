# Robot Vending IoT Lab Project

Simple two-app IoT lab project for reliable command transfer between a React admin panel, an Express backend, HiveMQ Cloud MQTT, and two ESP32 devices.

No monorepo tooling, no workspaces, and no shared root `package.json` are used.

For a short GPT-friendly explanation of the full website algorithm and future
customer-facing plan, see [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md).

## Architecture

```text
React Admin Client
  -> Express Server REST API
  -> HiveMQ MQTT Broker
  -> ESP32 Robot Car / ESP32 Vending Machine
```

Current focus:

- reliable command transfer
- MQTT command publish with QoS 1
- MQTT command messages are not retained
- backend waits for acknowledgement
- order flow between robot and vending
- robot telemetry and ultrasonic safety

Not included yet:

- database
- authentication UI
- customer-facing vending UI
- payment flow
- production GPS route persistence

## Folder Structure

```text
project-root/
  client/
    package.json
    index.html
    vite.config.js
    vercel.json
    .env.example
    src/
      main.jsx
      App.jsx
      api.js
      styles.css
    README.md
  server/
    package.json
    index.js
    .env.example
    render.yaml
    src/
      config.js
      devices.js
      topics.js
      httpError.js
      middleware/
        requireApiKey.js
      routes/
        deviceRoutes.js
        flowRoutes.js
        rootRoutes.js
      services/
        commandService.js
        messageHandlers.js
        mqttService.js
    README.md
  README.md
  .gitignore
```

## Devices

- `robot_car_001`
- `vending_001`

## MQTT Topics

Pattern:

- `devices/{deviceId}/command`
- `devices/{deviceId}/status`
- `devices/{deviceId}/event`

Real topics:

- `devices/robot_car_001/command`
- `devices/robot_car_001/status`
- `devices/robot_car_001/event`
- `devices/vending_001/command`
- `devices/vending_001/status`
- `devices/vending_001/event`

## MQTT Cloud Test

The dashboard includes a `Test MQTT Cloud Ping` button. It calls:

```text
POST /api/mqtt/test-ping
```

The backend publishes a QoS 1, non-retained message to:

```text
backend/test/ping
```

Then it waits for HiveMQ Cloud to deliver that same message back to the backend subscription. This confirms the backend can publish to and receive from the MQTT broker without needing an ESP32 online.

## Command Contract

Backend publishes:

```json
{
  "commandId": "cmd_...",
  "deviceId": "robot_car_001",
  "command": "forward",
  "params": {
    "speed": 160,
    "durationMs": 1000
  },
  "sentAt": "ISO_DATE"
}
```

Commands are published to `devices/{deviceId}/command` with QoS 1 and `retain: false`.

## Status/Ack Contract

ESP32 should publish status:

```json
{
  "commandId": "cmd_...",
  "deviceId": "robot_car_001",
  "status": "success",
  "message": "Command executed",
  "arduinoReply": "OK_FORWARD"
}
```

The backend matches acknowledgements by `deviceId + commandId`. If an ack arrives within 5 seconds, the API returns success. If no ack arrives, the API returns HTTP 504 timeout.

## Local Setup

Server:

```bash
cd server
cp .env.example .env
npm install
npm start
```

Client:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

## Render Backend Deployment

Create a Render Node web service using the `server/` folder.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Set these environment variables in Render:

- `NODE_ENV=production`
- `PORT`
- `MQTT_HOST`
- `MQTT_PORT`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `API_KEY`
- `FRONTEND_ORIGIN`
- `COMMAND_TIMEOUT_MS`
- `REQUEST_JSON_LIMIT`
- `STARTUP_DEVICE_CHECK_DELAY_MS`
- `DEVICE_PING_INTERVAL_MS`
- `DEVICE_OFFLINE_TIMEOUT_MS`
- `DEVICE_HEALTH_SWEEP_MS`
- `LOG_LEVEL`

Do not commit real `.env` files or MQTT credentials.

Recommended Render settings:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

In production, the backend fails fast if the required MQTT/API/CORS environment
variables are missing. `FRONTEND_ORIGIN` may be comma-separated if you need both
local and deployed frontend origins.

Use `LOG_LEVEL=off` on Render to keep remote logs quiet. After every MQTT
connect/reconnect, and then every 10 seconds, the backend pings `robot_car_001`
and `vending_001`. Busy devices are skipped so health probes do not interrupt commands.

## Vercel Frontend Deployment

Create a Vercel project using the `client/` folder.

Set:

- `VITE_API_BASE_URL` to your Render backend URL
- `VITE_API_KEY` to the same value as backend `API_KEY`
- `VITE_API_TIMEOUT_MS` to `15000`

Recommended Vercel settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

The frontend includes loading states, request timeouts, manual refresh, and
clear disabled states while the backend or MQTT broker is unavailable.

## Test Flow

1. Start the server.
2. Start the client.
3. Confirm `/health` shows the server running.
4. Send robot or vending `ping`.
5. Publish a matching fake ESP32 status ack to test success.
6. Send a command without publishing an ack to test timeout.
7. Run the robot-arrived flow to dispense from vending, then notify the robot with `delivery_loaded`.

Manual fake ESP32 ack test:

```bash
npx mqtt pub \
  -h "$MQTT_HOST" \
  -p 8883 \
  -u "$MQTT_USERNAME" \
  -P "$MQTT_PASSWORD" \
  --protocol mqtts \
  -t "devices/robot_car_001/status" \
  -m '{"commandId":"PASTE_COMMAND_ID","deviceId":"robot_car_001","status":"success","message":"Fake ESP32 ack"}'
```

## ESP32 Expected Behavior Later

Each ESP32 should:

- connect to HiveMQ Cloud over MQTT TLS
- subscribe to its own `devices/{deviceId}/command` topic
- execute the received command
- publish status to `devices/{deviceId}/status`
- include the same `commandId` in every acknowledgement
- publish device events to `devices/{deviceId}/event`

## Real Vending Commands

Dispense Product A and B:

```json
{
  "command": "dispense",
  "params": {
    "orderId": "ORD_1001",
    "a": 2,
    "b": 1
  }
}
```

Legacy single-slot dispense is still accepted:

```json
{
  "command": "dispense",
  "params": {
    "orderId": "ORD_1001",
    "slot": "A1"
  }
}
```

Refresh vending status:

```json
{
  "command": "status",
  "params": {}
}
```

Refill vending stock:

```json
{
  "command": "refill",
  "params": {
    "pin": "1234",
    "a": 5,
    "b": 3
  }
}
```

The vending ESP32 can include these fields in status acknowledgements:

- `qtyA`
- `qtyB`
- `dispensing`
- `currentProduct`
- `queueLength`
- `totalOrderItems`
- `dispensedCount`
- `activeOrderId`
- `uptimeMs`

## Dispense And Deliver Order Flow

The frontend `Dispense All & Send Robot` button calls:

```text
POST /api/orders/dispense-and-deliver
```

Example request:

```json
{
  "a": 1,
  "b": 1,
  "targetStation": "station_4",
  "userLocation": {
    "latitude": 22.8997,
    "longitude": 89.5023,
    "accuracy": 8,
    "capturedAt": "ISO_DATE"
  }
}
```

Backend flow:

1. Create `orderId`.
2. Send `prepare_for_pickup` with the order, station, quantities, expected product count, and user location.
3. If robot acknowledges, send `dispense` to `vending_001`.
4. Return after vending acknowledges `accepted`, `success`, or `ready`.
5. Robot `product_detected` events update the order but do not start movement.
6. Robot `product_loaded` starts delivery after validating any reported cart count.
7. Vending completion updates progress but does not bypass cart IR confirmation.
8. A command ID guard ensures duplicate robot completion events send `start_delivery` only once.
9. The simulation button remains an explicit demo-only way to start delivery.

The dashboard supports `station_1` through `station_4`. Selecting a station requests
browser geolocation; the next order sends those coordinates to the backend. Browser
location requires HTTPS in production or `localhost` during development.

Order endpoints:

- `POST /api/orders/dispense-and-deliver`
- `GET /api/orders`
- `GET /api/orders/current`
- `GET /api/orders/:orderId`
- `POST /api/orders/:orderId/cancel`

## Important Notes

- Commands use QoS 1.
- Commands are not retained.
- Every command has `commandId`.
- Backend waits for ack.
- Robot telemetry is available for live lab monitoring.
- Database will be added later.
# Food_Delivery_Robot_IOT
