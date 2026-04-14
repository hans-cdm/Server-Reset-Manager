const express = require('express');
const path = require('path');
const https = require('https');
const { resetServer, startScheduler, getState } = require('./seedloaf');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVER_IP = 'anomaliaa.sdlf.fun';
let cachedStatus = null;
let lastFetched = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ServerMonitor/1.0' } }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getMinecraftStatus() {
  const now = Date.now();
  if (cachedStatus && now - lastFetched < 60_000) return cachedStatus;
  try {
    const json = await fetchJson(`https://api.mcsrvstat.us/2/${SERVER_IP}`);
    cachedStatus = {
      online: json.online || false,
      players: json.players?.online ?? 0,
      maxPlayers: json.players?.max ?? 0,
      playerList: json.players?.list ?? [],
      version: json.version ?? '—',
      software: json.software ?? '—',
      motd: json.motd?.clean?.[0] ?? '',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    cachedStatus = { online: false, players: 0, maxPlayers: 0, playerList: [], version: '—', software: '—', motd: '', fetchedAt: new Date().toISOString() };
  }
  lastFetched = now;
  return cachedStatus;
}

// Warm up cache on start
getMinecraftStatus();

// API: Full status (minecraft + reset state)
app.get('/api/status', async (req, res) => {
  const [mc, state] = await Promise.all([getMinecraftStatus(), Promise.resolve(getState())]);
  res.json({
    server: { name: 'serahdah', ip: SERVER_IP, ...mc },
    reset: state,
  });
});

// API: Force refresh minecraft status
app.get('/api/status/refresh', async (req, res) => {
  lastFetched = 0;
  const mc = await getMinecraftStatus();
  res.json(mc);
});

// API: Trigger manual reset
app.post('/api/reset', async (req, res) => {
  const state = getState();
  if (state.status === 'resetting') {
    return res.status(409).json({ error: 'Reset already in progress' });
  }
  res.json({ message: 'Reset initiated' });
  resetServer();
});

// API: Get reset logs and state
app.get('/api/reset/state', (req, res) => {
  res.json(getState());
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server Monitor running on http://0.0.0.0:${PORT}`);
  startScheduler();
});
