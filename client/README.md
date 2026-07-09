# Robot Vending IoT Client

React application with a consumer snack-ordering experience and a protected lab-demo
admin control panel.

## Views

- `/` or the URL without a hash: consumer SnackRoute storefront
- `/#admin`: demo admin login and the existing IoT control panel

Demo admin credentials:

```text
Username: admin02
Password: robot01
```

This login is intentionally client-side and suitable only for the lab demo. It is not
production authentication.

The consumer catalog exposes three choices without changing the two-lane vending
protocol:

- Lemon Cream -> Product A
- Chocolate Crunch -> Product B
- Duo Snack Pack -> one Product A plus one Product B

Each catalog choice is demo-available with a maximum cart quantity of three. Pressing
`Place order` opens a no-charge demo payment confirmation; confirming then calls the
same real `/api/orders/dispense-and-deliver` flow used by the admin panel.

The consumer page uses the same order API, station selection, browser location,
device availability, delivery tracking, and delivery-received flow as the admin panel.

The admin panel also provides a confirmed `Force Reset Current Order` override for
recovering from a stuck lab flow.

Admin Product A/B selectors use a fixed demo range of 0–3 and are not clamped by stale
ESP32 stock reports. Old vending `dispensing` or queue fields do not disable a new order
when the backend has no active order.

For an active real order, `Confirm Products Loaded / Start Delivery` calls the backend
load-confirmation endpoint. It does not use the simulation command.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Environment

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_API_KEY=123456
VITE_API_TIMEOUT_MS=15000
```

## Deploy to Vercel

Create a Vercel project using this `client/` folder as the project root.

Set:

- `VITE_API_BASE_URL` to your Render backend URL
- `VITE_API_KEY` to the same value as the backend `API_KEY`
- `VITE_API_TIMEOUT_MS` to `15000` or your preferred request timeout

The included `vercel.json` handles SPA routing.

Recommended Vercel settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
