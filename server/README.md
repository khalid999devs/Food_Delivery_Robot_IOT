# Robot Vending IoT Server

Express backend for sending reliable MQTT commands to the ESP32 robot car and ESP32 vending machine.

## Structure

```text
server/
  index.js
  src/
    config.js
    devices.js
    topics.js
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
```

## Setup

```bash
cp .env.example .env
npm install
npm start
```

The server listens on `process.env.PORT || 3000`.

## Environment

```env
PORT=3000
NODE_ENV=development
MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password
API_KEY=123456
FRONTEND_ORIGIN=http://localhost:5173
COMMAND_TIMEOUT_MS=5000
REQUEST_JSON_LIMIT=64kb
STARTUP_DEVICE_CHECK_DELAY_MS=1200
LOG_LEVEL=info
```

For production, set `NODE_ENV=production`. The server will fail fast if `MQTT_HOST`,
`MQTT_USERNAME`, `MQTT_PASSWORD`, `API_KEY`, or `FRONTEND_ORIGIN` is missing.

`FRONTEND_ORIGIN` can contain multiple comma-separated origins, for example:

```env
FRONTEND_ORIGIN=http://localhost:5173,https://your-app.vercel.app
```

## API

- `GET /`
- `GET /health`
- `GET /api/devices`
- `GET /api/devices/:deviceId`
- `POST /api/devices/:deviceId/command`
- `POST /api/flows/robot-arrived`
- `POST /api/mqtt/test-ping`
- `POST /api/orders/dispense-and-deliver`
- `GET /api/orders`
- `GET /api/orders/current`
- `GET /api/orders/:orderId`
- `POST /api/orders/:orderId/cancel`
- `POST /api/orders/current/delivery-received`
- `POST /api/orders/:orderId/delivery-received`

Protected `/api` routes require `x-api-key` when `API_KEY` is set.

`GET /health` always returns HTTP 200 for Render health checks and includes
`mqttConnected`, `mqttConfigured`, `apiKeyEnabled`, `corsMode`, `deviceCheck`, and `ready`.

## Deploy to Render

Manual setup:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Set these environment variables in Render:

- `NODE_ENV=production`
- `MQTT_HOST`
- `MQTT_PORT=8883`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `API_KEY`
- `FRONTEND_ORIGIN=https://your-vercel-app.vercel.app`
- `COMMAND_TIMEOUT_MS=5000`
- `REQUEST_JSON_LIMIT=64kb`
- `STARTUP_DEVICE_CHECK_DELAY_MS=1200`
- `LOG_LEVEL=off`

The included `render.yaml` lists these values without committing secrets. `LOG_LEVEL=off`
keeps Render logs quiet for normal MQTT/status traffic.

## MQTT

The server publishes commands with QoS 1 and `retain: false`, then waits up to 5 seconds for a matching status acknowledgement by `deviceId + commandId`.

Use `POST /api/mqtt/test-ping` to publish a broker round-trip test message to `backend/test/ping`.

## Vending Commands

Allowed vending commands:

- `ping`
- `dispense`
- `refill`
- `status`
- `reset`
- `lock_door`
- `unlock_door`

Examples:

```json
{ "command": "dispense", "params": { "orderId": "ORD_1001", "a": 2, "b": 1 } }
```

```json
{ "command": "status", "params": {} }
```

```json
{ "command": "refill", "params": { "pin": "1234", "a": 5, "b": 3 } }
```

## Order Flow

Start the real dispense and delivery flow:

```json
{
  "a": 1,
  "b": 1,
  "targetStation": "station_2"
}
```

The backend first commands `robot_car_001` with `prepare_for_pickup`, then sends vending `dispense`, then starts robot `start_delivery` after matching vending completion arrives by MQTT.
