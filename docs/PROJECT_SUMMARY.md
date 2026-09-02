# SnackRoute Project Summary

Use this document as a compact context handoff for developers or AI assistants
working on this repository.

## Objective

SnackRoute is an IoT lab/demo system that coordinates:

- a customer-facing smart vending storefront;
- an admin device-control dashboard;
- an Express REST backend;
- HiveMQ Cloud MQTT;
- an ESP32 vending machine;
- an ESP32 robot delivery car;
- a robot Arduino for motors/line following; and
- an optional ESP32-CAM interface.

The central engineering goal is reliable and observable command transfer from
website to backend to MQTT device, followed by a matching device
acknowledgement.

## Repository Constraints

```text
client/    standalone React + Vite project
server/    standalone Node.js + Express project
```

- no monorepo tooling
- no npm workspaces
- no shared root `package.json`
- no database yet
- CommonJS on the backend
- plain CSS and no UI library on the frontend
- Render-compatible backend
- Vercel-compatible frontend
- backend source files should remain small (approximately 150 lines maximum)

## Deployed Architecture

```text
Customer Storefront --\
                       +-- HTTPS REST --> Express/Render
Admin Dashboard ------/                      |
                                             | MQTT TLS, QoS 1
                                             v
                                       HiveMQ Cloud
                                          /     \
                                         v       v
                                 Robot ESP32   Vending ESP32
                                      |
                                      v
                             Arduino motor controller
```

The browser never receives MQTT credentials. It sends `x-api-key` to the REST
backend. The backend publishes commands and subscribes to status, event, and
telemetry topics.

## Device IDs and Topics

Devices:

```text
robot_car_001
vending_001
```

Topics:

```text
devices/{deviceId}/command
devices/{deviceId}/status
devices/{deviceId}/event
devices/{deviceId}/telemetry
```

Commands use QoS 1 and `retain: false`.

## Command Contract

```json
{
  "commandId": "cmd_<timestamp>_<random>",
  "deviceId": "robot_car_001",
  "command": "start_delivery",
  "params": {
    "orderId": "ORD_...",
    "targetStation": "station_2",
    "a": 1,
    "b": 1,
    "expectedProducts": 2,
    "userLocation": {
      "latitude": 22.8997,
      "longitude": 89.5023
    }
  },
  "sentAt": "ISO_DATE"
}
```

The device acknowledgement must contain the same `commandId` and device ID.
The backend matches `deviceId:commandId` in a `pendingCommands` map and waits
five seconds by default.

## Customer Flow

1. Customer selects Lemon Cream, Chocolate Crunch, or Duo Snack Pack.
2. Customer selects one of four stations.
3. Browser requests latitude/longitude and attaches it when available.
4. A demo payment confirmation appears.
5. Frontend posts `a`, `b`, `targetStation`, and `userLocation`.
6. Backend asks the robot to `prepare_for_pickup`.
7. After robot readiness, backend asks vending to `dispense`.
8. Cart IR sensors publish `product_detected`.
9. Vending publishes completion.
10. Backend sends `delivery_loaded` after at least one real IR detection.
11. Robot acknowledges `product_loaded` or `success`.
12. Backend sends `manual_off`, then `start_delivery`.
13. Robot reports station/delivery completion.
14. Customer or admin confirms delivery receipt.
15. Backend notifies both devices and marks the order complete after five
    seconds.

## Product Detection Rule

Real orders must have at least one cart IR detection. Vending completion alone
must not start an empty robot.

The load chain begins when:

```text
(vending completed AND detectedProductCount >= 1)
OR
(detectedProductCount >= expectedProducts)
OR
(website confirms loaded AND detectedProductCount >= 1)
```

`simulate_order_completed` is the explicit zero-IR demo/manual bypass.

## Safety Rules

- Ultrasonic distance under the ESP32 threshold causes an immediate Arduino
  stop and an `obstacle_stop`/`obstacle_detected` message.
- Backend marks the active order `blocked_by_obstacle`.
- Frontend displays a red/warning safety state and disables movement actions.
- Emergency stop remains enabled.
- `obstacle_cleared` is displayed but never automatically resumes movement.
- Autonomous start first sends `manual_off`.
- `delivery_start_rejected`, failed, unknown, and blocked acknowledgements are
  not reported as successful.

## Device Health

MQTT Connected means the backend is connected to HiveMQ, not that ESP32 devices
are online.

The backend:

- marks a device seen on any valid status/event;
- pings both devices after MQTT connect/reconnect;
- pings periodically while skipping busy devices; and
- marks a device offline when `lastSeenAt` becomes stale or ping times out.

## Frontend Architecture

### `ConsumerStorefront.jsx`

- customer catalog and quantity limits
- demo checkout/payment modal
- station selection and browser geolocation
- order submission
- periodic health/device/order refresh
- live order progress and delivery receipt
- clickable demo progress override

### `App.jsx`

- hash-based consumer/admin view selection
- admin dashboard state and polling
- robot/vending controls
- order actions
- keyboard manual movement
- telemetry window
- response/error presentation

### `AdminLogin.jsx`

Client-side demo login:

```text
admin02 / robot01
```

This is not production authentication.

### `api.js`

- API base URL from Vite environment
- `x-api-key` header
- JSON parsing and normalized errors
- browser request timeout
- endpoint wrappers

## Backend Architecture

### Transport and Configuration

- `index.js`: Express startup and graceful shutdown
- `config.js`: validated environment configuration
- `mqttService.js`: MQTT lifecycle and subscriptions
- `commandService.js`: IDs, pending commands, QoS publish, timeout, correlation
- `messageHandlers.js`: safe JSON parsing and message dispatch
- `deviceHealthService.js`: startup/periodic device pings

### Order Domain

- `orderStore.js`: in-memory orders and timeline
- `orderFlowService.js`: prepare robot and start vending
- `robotPickupService.js`: IR evidence and pickup completion
- `vendingCompletionService.js`: vending-complete recognition
- `loadConfirmationPolicy.js`: real-load eligibility
- `deliveryLoadedService.js`: load command and one timeout retry
- `robotAutonomyService.js`: manual-off handoff
- `robotDeliveryService.js`: start-delivery validation
- `robotSafetyHandler.js`: obstacle order updates
- `orderCompletionService.js`: delivery-received fan-out
- `orderSimulationService.js`: explicit demo bypass

### Routes

- `deviceRoutes.js`: device state and direct commands
- `orderRoutes.js`: normal order lifecycle
- `orderAdminRoutes.js`: load confirmation, force reset, demo progress
- `orderSimulationRoutes.js`: simulated vending completion
- `telemetryRoutes.js`: telemetry controls and reads
- `mqttRoutes.js`: cloud loopback test

## Order State

Important statuses:

```text
created
robot_prepare_sent
robot_ready
vending_dispense_sent
vending_accepted
vending_dispensing
vending_progress
vending_completed
robot_load_confirmation_sent
robot_loaded
robot_delivery_sent
robot_delivering
blocked_by_obstacle
station_reached
awaiting_delivery_receipt
delivery_received
completed
failed
```

The demo progress numbers force display state only:

```text
1 -> robot_ready
2 -> vending_dispensing
3 -> robot_delivering
4 -> awaiting_delivery_receipt
```

They do not publish device movement commands.

## Manual Control

- Manual mode must be on for keyboard movement.
- W/Up: forward
- S/Down: backward
- A/Left: left
- D/Right: right
- Space: stop
- Movement key release sends stop.
- Repeated keydown events are ignored.
- Physical movement does not depend on frontend `durationMs`.

## Telemetry

The robot can publish:

- GPS coordinates
- cart IR states and product counts
- ultrasonic distance and obstacle flag
- robot/manual mode
- uptime and related device state

The backend stores latest telemetry and a bounded in-memory history. The camera
is optional and not required for telemetry or command transfer.

## GPS Status

Implemented:

- browser location capture
- coordinate validation
- location storage in the in-memory order
- forwarding location in robot order commands

Planned, not implemented:

- station coordinate registry
- Haversine nearest-station selection
- A* or Dijkstra route calculation
- GPS route deviation tracking
- route persistence/recalculation

Do not describe nearest-path GPS routing as complete until those modules exist.

## Deployment

Render:

```text
Root: server
Build: npm install
Start: npm start
Health: /health
```

Vercel:

```text
Root: client
Build: npm run build
Output: dist
```

Production backend logging should use `LOG_LEVEL=off`. Real `.env` files and
MQTT credentials must never be committed.

## Known Limitations

- backend restart clears orders
- no real authentication or authorization
- browser Vite API key is not a secret
- no real payment provider
- no database/audit persistence
- no implemented GPS nearest-path engine
- one active order and one pending non-stop command per device
- demo override endpoints can change order presentation without hardware action

See [ALGORITHMS_AND_BUSINESS_LOGIC.md](ALGORITHMS_AND_BUSINESS_LOGIC.md) for
detailed pseudocode and state-transition logic.
