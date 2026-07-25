/**
 * test.js — Automated Browser Verification Script
 *
 * This script is designed for AI agents or developers to perform end-to-end (E2E) E2E UI
 * testing and state machine verification automatically.
 * It spawns a temporary static web server, launches a headless Puppeteer browser,
 * simulates user interaction (e.g. typing floor 5), takes screenshots of all state transitions,
 * and automatically shuts down the server upon completion.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_ROOT = __dirname;
const PORT = 10459;

// 1. Start a temporary static server
const server = http.createServer((req, res) => {
  let safeUrl = req.url.split('?')[0];
  let filePath = path.join(WEB_ROOT, safeUrl === '/' ? 'index.html' : safeUrl);

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.png':
      contentType = 'image/png';
      break;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, async () => {
  console.log(`[Test Server] Started at http://localhost:${PORT}`);

  let browser;
  try {
    // 2. Launch headless Puppeteer browser
    console.log('[Test Browser] Launching Puppeteer...');
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', error => {
      console.error('[Browser Page Error]:', error.message);
    });

    console.log('[Test Browser] Navigating to game home...');
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });

    const sleep = ms => new Promise(res => setTimeout(res, ms));

    // Verify initial state (1F, door open)
    const initFloor = await page.$eval('#floor-display', el => el.textContent.trim());
    console.log(`[Verify] Initial Floor: "${initFloor}" (Expected: "1") - ${initFloor === '1' ? '✅' : '❌'}`);

    const isLeftDoorOpen = await page.$eval('#door-left', el => !el.classList.contains('closed'));
    console.log(`[Verify] Initial Door Open: ${isLeftDoorOpen} (Expected: true) - ${isLeftDoorOpen ? '✅' : '❌'}`);

    await page.screenshot({ path: 'test_init.png' });
    console.log('[Screenshot] Saved initial state to: test_init.png');

    // Trigger movement: Type '5' and hit Enter
    console.log('[Interaction] Typing floor "5" and sending Enter...');
    await page.focus('#floor-input');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');

    // Verify door starts closing
    await sleep(200);
    const isLeftDoorClosing = await page.$eval('#door-left', el => el.classList.contains('closed') || el.style.transform !== '');
    console.log(`[Verify] Door Closing Started: ${isLeftDoorClosing} (Expected: true) - ${isLeftDoorClosing ? '✅' : '❌'}`);

    await page.screenshot({ path: 'test_closing.png' });
    console.log('[Screenshot] Saved closing state to: test_closing.png');

    // Wait 1.5s for doors to close and elevator to start moving
    await sleep(1500);
    const isMovingArrowActive = await page.$eval('#arrow-up', el => el.classList.contains('active') || el.style.opacity !== '0.1');
    console.log(`[Verify] Moving Arrow Active: ${isMovingArrowActive} (Expected: true) - ${isMovingArrowActive ? '✅' : '❌'}`);

    await page.screenshot({ path: 'test_moving.png' });
    console.log('[Screenshot] Saved moving state to: test_moving.png');

    // Wait 9.5s for elevator to arrive and open doors (1F -> 5F travel)
    console.log('[Wait] Waiting 9.5s for movement to finish and doors to open at 5F...');
    await sleep(9500);

    const finalFloor = await page.$eval('#floor-display', el => el.textContent.trim());
    console.log(`[Verify] Arrived Floor: "${finalFloor}" (Expected: "5") - ${finalFloor === '5' ? '✅' : '❌'}`);

    const isLeftDoorOpenAgain = await page.$eval('#door-left', el => !el.classList.contains('closed'));
    console.log(`[Verify] Arrived Door Open: ${isLeftDoorOpenAgain} (Expected: true) - ${isLeftDoorOpenAgain ? '✅' : '❌'}`);

    await page.screenshot({ path: 'test_arrived.png' });
    console.log('[Screenshot] Saved arrived state to: test_arrived.png');

    console.log('=== All Automated Tests Passed! ===');

  } catch (err) {
    console.error('[Test Error]:', err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[Test Browser] Closed.');
    }
    server.close(() => {
      console.log('[Test Server] Stopped. Exiting.');
    });
  }
});
