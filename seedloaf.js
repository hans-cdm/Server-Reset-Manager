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
  const isHeadless = !process.env.DISPLAY;
  addLog(`Launching browser (headless: ${isHeadless}, DISPLAY: ${process.env.DISPLAY || 'none'})`);
  return chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,800',
    ],
  });
}

async function signInWithCookie(context) {
  const sessionCookie = process.env.SEEDLOAF_SESSION_COOKIE;
  if (!sessionCookie) return false;

  addLog('Using saved session cookie to authenticate...');
  await context.addCookies([
    {
      name: '__session',
      value: sessionCookie,
      domain: 'seedloaf.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    {
      name: '__session',
      value: sessionCookie,
      domain: '.seedloaf.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ]);
  return true;
}

async function signIn(page, context) {
  const usedCookie = await signInWithCookie(context);

  addLog('Navigating to Seedloaf dashboard...');
  await page.goto(`${SEEDLOAF_URL}/dashboard`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/seedloaf-login.png' });

  const currentUrl = page.url();
  addLog(`After navigation URL: ${currentUrl}`);

  if (currentUrl.includes('/dashboard')) {
    addLog('Logged in successfully via cookie', 'success');
    return;
  }

  if (usedCookie) {
    addLog('Cookie auth failed, trying email/password login...', 'warn');
  }

  addLog('Navigating to login page...');
  await page.goto('https://accounts.seedloaf.com/sign-in', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  addLog(`Login page title: ${title}`);
  if (title.includes('Just a moment') || title.includes('Checking')) {
    throw new Error('Cloudflare is blocking access. Please update SEEDLOAF_SESSION_COOKIE.');
  }

  addLog('Waiting for login form...');
  const emailInput = page.locator('input[name="identifier"], input[type="email"], input[placeholder*="email" i]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });

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
  await page.goto(`${SEEDLOAF_URL}/dashboard`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/seedloaf-dashboard.png' });

  const html = await page.content();

  // Try to find world by name first
  let worldLink = page.locator(`a:has-text("${WORLD_NAME}")`).first();
  let found = await worldLink.isVisible({ timeout: 3000 }).catch(() => false);

  // If not found by name, find any server management link (UUID-based dashboard link)
  if (!found) {
    addLog(`World not found by name, looking for server management link...`, 'warn');
    const uuidLinkMatch = html.match(/href="(\/dashboard\/[a-f0-9-]{36}[^"]*)"/i);
    if (uuidLinkMatch) {
      const targetUrl = `${SEEDLOAF_URL}${uuidLinkMatch[1]}`;
      addLog(`Found server link: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'load', timeout: 45000 });
      found = true;
    } else {
      addLog(`No server link found at all`, 'error');
    }
  } else {
    addLog(`Found world link by name, clicking...`);
    await worldLink.click();
    await page.waitForLoadState('load', { timeout: 20000 });
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    const page = await context.newPage();

    await signIn(page, context);
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
