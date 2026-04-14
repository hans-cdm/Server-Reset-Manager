# Server Monitor — serahdah

Monitor dan auto-reset server Minecraft "serahdah" yang dihost di Seedloaf.

## Features

- **Live monitoring** — Semak status online/offline, versi, software, dan pemain melalui protokol Minecraft awam
- **Auto-reset setiap 5 jam** — Log masuk ke Seedloaf secara automatik menggunakan browser automation (Playwright + Chromium), kemudian stop dan start semula server
- **Manual reset** — Butang "Reset Sekarang" untuk reset manual dengan konfirmasi
- **Countdown timer** — Kiraan masa mundur ke reset berikutnya
- **Log aktiviti** — Semua operasi reset dilog dalam masa nyata

## Tech Stack

- **Runtime**: Node.js 20
- **Server**: Express.js (REST API + static files)
- **Browser Automation**: Playwright Core + System Chromium
- **Status Check**: api.mcsrvstat.us (public Minecraft status API)
- **Port**: 5000

## Project Structure

```
/
├── server.js        # Express server + auto-reset scheduler
├── seedloaf.js      # Playwright automation (Seedloaf login + server control)
├── package.json
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Environment Variables / Secrets

- `SEEDLOAF_EMAIL` — Email akaun Seedloaf
- `SEEDLOAF_PASSWORD` — Password akaun Seedloaf

## Auto-Reset Flow

1. Scheduler dijalankan setiap 5 jam
2. Chromium headless dibuka
3. Login ke accounts.seedloaf.com dengan credentials
4. Navigate ke `/dashboard/serahdah`
5. Klik butang "Stop"
6. Tunggu 15 saat
7. Klik butang "Start"
8. Log keputusan
