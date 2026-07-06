# Robot Vending IoT Client

React admin dashboard for sending lab-demo commands through the Express backend.

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
