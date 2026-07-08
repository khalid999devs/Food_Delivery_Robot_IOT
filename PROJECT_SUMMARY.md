# Robot Vending IoT Project Summary

## Goal

This lab system coordinates an ESP32 vending machine and an ESP32 delivery robot.
The current focus is reliable commands, product loading, delivery, safety, and live
robot telemetry. A database, payment flow, and customer authentication are future work.

## Software Architecture

```text
React/Vite frontend on Vercel
  -> Express REST API on Render
  -> HiveMQ Cloud over MQTT TLS
  -> ESP32 vending machine and ESP32 robot car
```

The `client/` and `server/` applications are independent. There is no root package,
workspace, or monorepo tool.

## Frontend Modules

- `App.jsx`: dashboard state, station/product selection, manual controls, orders, and polling.
- `api.js`: REST requests with `x-api-key`.
- `TelemetryPanel.jsx`: robot GPS, cart IR, and ultrasonic sensor display.
- `styles.css`: responsive desktop/mobile presentation.

The dashboard polls health, device state, and the current order every three seconds.
Selecting one of four stations requests browser latitude/longitude. Coordinates are
included when the order is submitted. Location permission requires HTTPS or localhost.

The backend probes both ESP32 devices every ten seconds. A matching ping acknowledgement
marks a device online, while a timeout marks it offline. Devices with active commands
are skipped, and a passive stale timestamp check provides a second disconnect signal.

## Backend Modules

- Routes validate REST input and return order/device state.
- `commandService` publishes QoS 1, non-retained MQTT commands and matches acks by
  `deviceId + commandId` for up to five seconds.
- `messageHandlers` receives status/event messages and updates in-memory device state.
- `orderFlowService` prepares the robot and starts vending.
- `orderMqttHandlers` maps real ESP32 messages into order state.
- `robotPickupService` validates final cart loading and requests delivery.
- `robotDeliveryService` sends one guarded `start_delivery` command.
- Telemetry and obstacle services handle live sensors and safety state.

All state is in memory and resets when the backend restarts.

## Real Order Algorithm

1. User selects Product A/B quantities and Station 1, 2, 3, or 4.
2. Browser captures user latitude/longitude when station selection is clicked.
3. Frontend POSTs quantities, station, and location to `/api/orders/dispense-and-deliver`.
4. Backend rejects empty orders and creates an order ID.
5. Backend sends `prepare_for_pickup` to the robot with:

```json
{
  "orderId": "ORD_...",
  "targetStation": "station_4",
  "a": 1,
  "b": 1,
  "expectedProducts": 2,
  "userLocation": {
    "latitude": 22.8997,
    "longitude": 89.5023
  }
}
```

6. Robot arms cart detection and acknowledges `ready_for_pickup`.
7. Backend starts vending only after the robot acknowledgement succeeds.
8. IR detections publish `product_detected`; these update the UI and never start movement.
9. After the expected count, robot publishes `product_loaded`.
10. Backend checks any reported product count and sends `start_delivery`.
11. Vending completion alone does not bypass the cart IR confirmation.
12. `robotDeliveryCommandId` ensures duplicate robot completion events start delivery only once.
13. Robot reports delivery progress and completion.
14. User clicks `Delivery Received`; backend notifies both devices and resets the flow.

## Safety And Demo Behavior

- Obstacle detection under 8 cm stops the robot and blocks delivery/movement controls.
- Obstacle clearing is displayed but never auto-resumes movement.
- Emergency Stop remains available.
- Manual W/A/S/D and arrow controls work only in manual mode; key release sends Stop.
- `Simulate Order Completed / Start Delivery` remains available for lab testing.
- Camera availability is optional and does not block commands or telemetry.

## GPS Plan

User coordinates now reach the backend and robot command payloads. Current station routing
still uses fixed station IDs. A future GPS calculation module can store station coordinates,
compare them with user/robot coordinates, choose the nearest reachable route, and publish
route progress. Persistent route history requires the future database.
