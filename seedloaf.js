const { chromium } = require('playwright-core');
const { execSync } = require('child_process');

const CHROMIUM_PATH = (() => {
  try { return execSync('which chromium').toString().trim(); }
  catch { return '/usr/bin/chromium'; }
})();
const SEEDLOAF_URL  = 'https://seedloaf.com';
const WORLD_NAME    = 'serahdah';

let log = [];
let currentStatus = 'idle';
let nextResetAt = null;
let resetCount = 0;

function addLog(msg, type = 'info') {
  const entry = { time: new Date().toISOString(), msg, type };
  log.unshift(entry);
  if (log.length > 100) log.pop();
  console.log(`[seedloaf][${type}] ${msg}`);
}

async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  });
}

async function signIn(page) {
  addLog('Navigating to Seedloaf login...');
  await page.goto('https://accounts.seedloaf.com/sign-in', { waitUntil: 'domcontentloaded', timeout: 45000 });

  addLog('Waiting for login form to render...');
  const emailInput = page.locator('input[name="identifier"], input[type="email"], input[placeholder*="email" i], input[placeholder*="Email" i]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 30000 });
  await page.screenshot({ path: '/tmp/seedloaf-login.png' });

  addLog('Filling in email...');
  await emailInput.fill(process.env.SEEDLOAF_EMAIL || '');
  await emailInput.press('Enter');
  await page.waitForTimeout(2500);

  addLog('Filling in password...');
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  await passwordInput.fill(process.env.SEEDLOAF_PASSWORD || '');
  await passwordInput.press('Enter');

  addLog('Waiting for dashboard...');
  await page.waitForURL(`${SEEDLOAF_URL}/dashboard**`, { timeout: 45000 });
  addLog('Logged in successfully', 'success');
}

async function getServerStatus(page) {
  await page.goto(`${SEEDLOAF_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);
  const content = await page.content();

  if (content.includes(WORLD_NAME)) {
    addLog(`Found world: ${WORLD_NAME}`);
    return true;
  }
  addLog(`World "${WORLD_NAME}" not found on dashboard`, 'warn');
  return false;
}

async function navigateToWorld(page) {
  addLog(`Navigating to dashboard to find world: ${WORLD_NAME}...`);
  await page.goto(`${SEEDLOAF_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/seedloaf-dashboard.png' });

  const worldLink = page.locator(`a:has-text("${WORLD_NAME}"), [href*="${WORLD_NAME}"]`).first();
  if (await worldLink.isVisible({ timeout: 8000 }).catch(() => false)) {
    addLog(`Found world link, clicking...`);
    await worldLink.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  } else {
    addLog(`World link not found by name, dumping links...`, 'warn');
    const html = await page.content();
    const links = html.match(/href="[^"]*"/g) || [];
    addLog(`Page links: ${links.slice(0, 20).join(', ')}`, 'info');
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/seedloaf-world.png' });
  addLog(`Current URL after navigate: ${page.url()}`);
}

async function clickButton(page, labels) {
  for (const label of labels) {
    try {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        addLog(`Clicking "${label}" button...`);
        await btn.click();
        return label;
      }
    } catch {}
    try {
      const btn = page.locator(`[aria-label*="${label}" i], [title*="${label}" i]`).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        addLog(`Clicking "${label}" (aria) button...`);
        await btn.click();
        return label;
      }
    } catch {}
  }
  return null;
}

async function stopServer(page) {
  addLog('Attempting to stop server...');
  const pageContent = await page.content();
  const buttons = pageContent.match(/<button[^>]*>([^<]*)<\/button>/gi) || [];
  addLog(`Buttons on page: ${buttons.slice(0, 10).join(' | ')}`, 'info');
  const clicked = await clickButton(page, ['Stop', 'Stop Server', 'Turn Off', 'Shutdown', 'Kill', 'Power Off', 'Restart', 'Delete', 'Terminate', 'Pause']);
  if (clicked) {
    addLog(`Server stop command sent ("${clicked}")`, 'success');
    await page.waitForTimeout(5000);
    return true;
  }
  addLog('Could not find Stop button — taking screenshot for debugging', 'warn');
  await page.screenshot({ path: '/tmp/seedloaf-stop-debug.png' });
  return false;
}

async function startServer(page) {
  addLog('Attempting to start server...');
  await page.waitForTimeout(3000);
  const clicked = await clickButton(page, ['Start', 'Start Server', 'Turn On', 'Launch', 'Boot']);
  if (clicked) {
    addLog(`Server start command sent ("${clicked}")`, 'success');
    await page.waitForTimeout(5000);
    return true;
  }
  addLog('Could not find Start button — taking screenshot for debugging', 'warn');
  await page.screenshot({ path: '/tmp/seedloaf-start-debug.png' });
  return false;
}

async function resetServer() {
  if (currentStatus === 'resetting') {
    addLog('Reset already in progress, skipping', 'warn');
    return false;
  }

  currentStatus = 'resetting';
  addLog('=== Starting server reset cycle ===', 'info');

  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await signIn(page);
    await navigateToWorld(page);

    const stopped = await stopServer(page);
    if (!stopped) {
      addLog('Stop failed, aborting reset', 'error');
      currentStatus = 'idle';
      return false;
    }

    addLog('Waiting 15s for server to shut down...');
    await page.waitForTimeout(15000);

    await navigateToWorld(page);
    const started = await startServer(page);

    resetCount++;
    addLog(`=== Reset #${resetCount} complete ===`, 'success');
    currentStatus = 'idle';
    return started;

  } catch (err) {
    addLog(`Reset failed: ${err.message}`, 'error');
    currentStatus = 'idle';
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

const RESET_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 hours

function scheduleNextReset() {
  nextResetAt = new Date(Date.now() + RESET_INTERVAL_MS);
  addLog(`Next auto-reset scheduled at: ${nextResetAt.toLocaleString()}`, 'info');

  setTimeout(async () => {
    await resetServer();
    scheduleNextReset();
  }, RESET_INTERVAL_MS);
}

function startScheduler() {
  addLog(`Auto-reset scheduler started. Interval: 5 hours`, 'info');
  scheduleNextReset();
}

function getState() {
  return {
    status: currentStatus,
    nextResetAt,
    resetCount,
    logs: log.slice(0, 50),
  };
}

module.exports = { resetServer, startScheduler, getState };
