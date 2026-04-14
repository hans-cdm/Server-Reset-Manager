let nextResetAt = null;
let countdownTimer = null;
let resetInProgress = false;

// ---- Fetch data ----
async function loadAll() {
  try {
    const data = await fetch('/api/status').then(r => r.json());
    renderServer(data.server);
    renderResetState(data.reset);
    renderLogs(data.reset.logs);
    document.getElementById('last-refresh').textContent = 'Refresh: ' + new Date().toLocaleTimeString();
  } catch {}
}

async function refreshStatus() {
  showToast('Menyemak status...', 'info');
  await fetch('/api/status/refresh');
  await loadAll();
  showToast('Status dikemaskini', 'success');
}

// ---- Render server card ----
function renderServer(s) {
  const badge = document.getElementById('status-badge');
  const card  = document.getElementById('server-card');
  if (s.online) {
    badge.textContent = 'ONLINE'; badge.className = 'badge badge-online';
    card.classList.add('card-online'); card.classList.remove('card-offline');
  } else {
    badge.textContent = 'OFFLINE'; badge.className = 'badge badge-offline';
    card.classList.add('card-offline'); card.classList.remove('card-online');
  }
  document.getElementById('d-software').textContent = s.software || '—';
  document.getElementById('d-version').textContent  = s.version  || '—';
  const pEl = document.getElementById('d-players');
  pEl.textContent = `${s.players} / ${s.maxPlayers}`;
  pEl.className = 'detail-val' + (s.players > 0 ? ' has-players' : '');
  document.getElementById('d-motd').textContent = s.motd || '—';

  const pct = s.maxPlayers > 0 ? Math.min(100, (s.players / s.maxPlayers) * 100) : 0;
  document.getElementById('player-bar').style.width = pct + '%';

  const pl = document.getElementById('player-list');
  pl.innerHTML = (s.playerList || []).map(p => `<span class="player-chip">${p}</span>`).join('');
}

// ---- Render reset state ----
function renderResetState(state) {
  resetInProgress = state.status === 'resetting';
  const btn = document.getElementById('manual-reset-btn');
  const rbadge = document.getElementById('reset-status-badge');
  btn.disabled = resetInProgress;

  if (resetInProgress) {
    rbadge.textContent = 'Resetting...'; rbadge.className = 'badge badge-warn';
  } else {
    rbadge.textContent = 'Auto'; rbadge.className = 'badge badge-purple';
  }

  document.getElementById('reset-count-badge').textContent = (state.resetCount || 0) + ' resets';

  if (state.nextResetAt) {
    nextResetAt = new Date(state.nextResetAt);
    startCountdown();
  }
}

// ---- Countdown timer ----
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  if (!nextResetAt) return;
  const diff = nextResetAt - Date.now();
  if (diff <= 0) {
    document.getElementById('cnt-h').textContent = '00';
    document.getElementById('cnt-m').textContent = '00';
    document.getElementById('cnt-s').textContent = '00';
    return;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  document.getElementById('cnt-h').textContent = String(h).padStart(2, '0');
  document.getElementById('cnt-m').textContent = String(m).padStart(2, '0');
  document.getElementById('cnt-s').textContent = String(s).padStart(2, '0');
  document.getElementById('next-reset-text').textContent =
    'Reset seterusnya: ' + nextResetAt.toLocaleString();
}

// ---- Render activity log ----
function renderLogs(logs) {
  const el = document.getElementById('activity-log');
  if (!logs || logs.length === 0) {
    el.innerHTML = '<div class="log-empty muted small">Belum ada aktiviti...</div>';
    return;
  }
  el.innerHTML = logs.map(l => `
    <div class="log-entry">
      <span class="log-time">${new Date(l.time).toLocaleTimeString()}</span>
      <span class="log-msg log-${l.type || 'info'}">${l.msg}</span>
    </div>
  `).join('');
}

// ---- Manual reset ----
function triggerReset() {
  if (resetInProgress) return;
  document.getElementById('modal').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modal').style.display = 'none';
}
async function confirmReset() {
  closeModal();
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (res.ok) {
      showToast('Reset dimulakan! Ini mungkin ambil masa beberapa minit.', 'info');
      setTimeout(loadAll, 2000);
    } else {
      const j = await res.json();
      showToast(j.error || 'Gagal memulakan reset', 'error');
    }
  } catch { showToast('Ralat sambungan', 'error'); }
}

// Close modal on backdrop click
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

// ---- Toast ----
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ---- Init ----
loadAll();
setInterval(loadAll, 30_000);
