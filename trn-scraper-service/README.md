# TRN Scraper Service

Local proof-of-concept service that opens Rocket League Tracker profile pages in a headless Chromium browser and exposes a small JSON endpoint for the Wails app.

## Setup

```bash
npm install
npm run install:browsers
npm start
```

The service listens on `http://127.0.0.1:7331` by default.

## Endpoint

```text
GET /profile?platform=epic&username=MMR%20Tank
```

The Wails app reads `TRN_SCRAPER_URL` from the root `.env` or `.env.local`. If unset, it defaults to `http://127.0.0.1:7331`.
