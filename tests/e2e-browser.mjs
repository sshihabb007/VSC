import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

function loadPlaywrightChromium() {
  for (const base of [PROJECT_ROOT, path.resolve(PROJECT_ROOT, '..')]) {
    try {
      return require(require.resolve('playwright-core', { paths: [base] })).chromium;
    } catch {
      // try next search root
    }
  }
  throw new Error('playwright-core could not be resolved; run npm install first');
}

const chromium = loadPlaywrightChromium();

function detectExecutable(candidates) {
  return candidates.find((p) => p && existsSync(p)) || null;
}

const CHROME_PATH = detectExecutable([
  process.env.VSC_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]);

const BRAVE_PATH = detectExecutable([
  process.env.VSC_BRAVE_PATH,
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/brave-browser',
]);

const BROWSERS = [
  CHROME_PATH ? { name: 'Google Chrome', executablePath: CHROME_PATH } : null,
  BRAVE_PATH ? { name: 'Brave Browser', executablePath: BRAVE_PATH } : null,
].filter(Boolean);

if (BROWSERS.length === 0) {
  throw new Error('No Chromium-based browser executable found for E2E tests (set VSC_CHROME_PATH or VSC_BRAVE_PATH)');
}

/** Generate a valid silent 10-second 8kHz mono 16-bit PCM WAV buffer in memory. */
function buildSilentWavBuffer(durationSeconds = 10, sampleRate = 8000) {
  const numSamples = durationSeconds * sampleRate;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function createFixtureHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>VSC E2E Fixture</title>
  <style>
    body { margin: 0; padding: 24px; font-family: sans-serif; background: #111; color: #eee; min-height: 220vh; }
    .player-wrap { position: relative; display: inline-block; margin-right: 16px; border: 1px solid #333; }
    video { width: 320px; height: 180px; display: block; background: #000; }
  </style>
</head>
<body>
  <div class="player-wrap"><video id="video1" src="/test.wav" controls muted playsinline autoplay></video></div>
  <div class="player-wrap"><video id="video2" src="/test.wav" controls muted playsinline autoplay></video></div>
  <div id="shadow-host" class="player-wrap"></div>
  <div id="spa-stage"></div>
  <button id="spa-push" type="button">Push SPA Route</button>

  <script>
    // Shadow DOM with nested video + shadow input
    const shadowHost = document.getElementById('shadow-host');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = 'video { width: 320px; height: 180px; display: block; background: #000; } .box { position: relative; }';
    const box = document.createElement('div');
    box.className = 'box';
    const sv = document.createElement('video');
    sv.id = 'shadow-video';
    sv.src = '/test.wav';
    sv.controls = true;
    sv.muted = true;
    sv.playsInline = true;
    sv.autoplay = true;
    const sInput = document.createElement('input');
    sInput.id = 'shadow-input';
    sInput.type = 'text';
    box.appendChild(sv);
    box.appendChild(sInput);
    shadow.appendChild(shadowStyle);
    shadow.appendChild(box);
    sv.play().catch(() => {});

    document.getElementById('spa-push').addEventListener('click', () => {
      history.pushState({ page: 2 }, '', '/spa-next');
      const wrap = document.createElement('div');
      wrap.className = 'player-wrap';
      const vSpa = document.createElement('video');
      vSpa.id = 'video-spa';
      vSpa.src = '/test.wav';
      vSpa.controls = true;
      vSpa.muted = true;
      vSpa.playsInline = true;
      vSpa.autoplay = true;
      wrap.appendChild(vSpa);
      document.getElementById('spa-stage').appendChild(wrap);
      vSpa.play().catch(() => {});
    });
  </script>
</body>
</html>`;
}

function startFixtureServer() {
  const html = createFixtureHtml();
  const wav = buildSilentWavBuffer(10);
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/test.wav')) {
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.length,
        'Accept-Ranges': 'bytes',
      });
      res.end(wav);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

async function runBrowserSuite(browserSpec, baseUrl) {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsc-e2e-'));
  let context = null;
  const errors = [];

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: browserSpec.executablePath,
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-extension-debugging',
      ],
    });

    const bcdp =
      (await context.browser()?.newBrowserCDPSession?.()) ||
      (await context.newCDPSession(context.pages()[0] || (await context.newPage())));
    const loadRes = await bcdp.send('Extensions.loadUnpacked', { path: DIST_DIR });
    const extId = loadRes?.id;
    assert.ok(extId && extId.length > 10, `Invalid extensionId: ${extId}`);

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    assert.equal(new URL(sw.url()).hostname, extId);

    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`console.error: ${msg.text()}`);
      } else if (msg.type() === 'warning' && msg.text().includes('[VSC]')) {
        errors.push(`console.warn: ${msg.text()}`);
      }
    });

    await page.goto(`${baseUrl}/watch`, { waitUntil: 'domcontentloaded' });

    // 1. Wait for controllers on video1, video2, and Shadow DOM shadow-video
    await page.waitForFunction(
      () => {
        const lightCount = document.querySelectorAll('vsc-controller').length;
        const shadowRoot = document.getElementById('shadow-host')?.shadowRoot;
        const shadowCount = shadowRoot?.querySelectorAll('vsc-controller').length || 0;
        const v1 = document.getElementById('video1');
        return lightCount === 2 && shadowCount === 1 && v1?.readyState >= 1;
      },
      null,
      { timeout: 10000 }
    );

    // 2. Verify shared adoptedStyleSheets across shadow controllers
    const sheetShared = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('vsc-controller'));
      const sh = document.getElementById('shadow-host').shadowRoot.querySelector('vsc-controller');
      hosts.push(sh);
      const s0 = hosts[0].shadowRoot.adoptedStyleSheets?.[0];
      return Boolean(s0 && hosts.every((h) => h.shadowRoot.adoptedStyleSheets?.[0] === s0));
    });
    assert.equal(sheetShared, true, 'All controllers should share one compiled CSSStyleSheet');

    // 3. Keyboard shortcuts parity: c (+0.1), x (-0.1), s (-5s), d (+5s), g (fast 1.6 / toggle), z (reset), v (display)
    await page.keyboard.press('c');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.1) < 0.01,
      null,
      { timeout: 5000 }
    );
    const badgeAfterC = await page.evaluate(() => {
      const host = document.querySelector('vsc-controller');
      return {
        lightText: host.shadowRoot.querySelector('.draggable').textContent,
        shadowRate: document.getElementById('shadow-host').shadowRoot.getElementById('shadow-video').playbackRate,
      };
    });
    assert.equal(badgeAfterC.lightText, '1.10');
    assert.ok(Math.abs(badgeAfterC.shadowRate - 1.1) < 0.01);

    await page.keyboard.press('x');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.0) < 0.01,
      null,
      { timeout: 5000 }
    );

    await page.evaluate(() => {
      const v1 = document.getElementById('video1');
      v1.pause();
      v1.currentTime = 1.0;
    });
    await page.keyboard.press('d');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').currentTime - 6.0) < 0.25,
      null,
      { timeout: 5000 }
    );
    await page.keyboard.press('s');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').currentTime - 1.0) < 0.25,
      null,
      { timeout: 5000 }
    );

    await page.keyboard.press('g');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.6) < 0.01,
      null,
      { timeout: 5000 }
    );

    await page.keyboard.press('z');
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.0) < 0.01,
      null,
      { timeout: 5000 }
    );

    await page.keyboard.press('v');
    const visAttrHide = await page.evaluate(() => document.querySelector('vsc-controller').getAttribute('data-vsc-visibility'));
    assert.equal(visAttrHide, 'hide');
    await page.keyboard.press('v');
    const visAttrShow = await page.evaluate(() => document.querySelector('vsc-controller').getAttribute('data-vsc-visibility'));
    assert.equal(visAttrShow, 'show');

    // 4. Shadow DOM <input> typing guard: typing 'c' must NOT change playbackRate
    await page.evaluate(() => {
      const inp = document.getElementById('shadow-host').shadowRoot.getElementById('shadow-input');
      inp.focus();
    });
    await page.keyboard.press('c');
    const afterShadowType = await page.evaluate(() => ({
      rate: document.getElementById('video1').playbackRate,
      val: document.getElementById('shadow-host').shadowRoot.getElementById('shadow-input').value,
    }));
    assert.equal(afterShadowType.val, 'c');
    assert.equal(afterShadowType.rate, 1.0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // 5. Hover dwell (>300ms) + mouse wheel speed change (must not scroll page!)
    const dragBox = await page.evaluate(() => {
      const host = document.querySelector('vsc-controller');
      const r = host.shadowRoot.querySelector('.draggable').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(dragBox.x, dragBox.y);
    await page.waitForTimeout(360);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.1) < 0.01,
      null,
      { timeout: 5000 }
    );
    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert.equal(scrollAfter, scrollBefore, 'Wheel over controller must not scroll document');

    // 6. GPU Pointer Drag with rAF + CSS vars (--vsc-tx, --vsc-ty)
    await page.mouse.down();
    await page.mouse.move(dragBox.x + 80, dragBox.y + 45, { steps: 5 });
    await page.mouse.up();
    const dragVars = await page.evaluate(() => {
      const ctrl = document.querySelector('vsc-controller').shadowRoot.querySelector('#controller');
      return {
        tx: ctrl.style.getPropertyValue('--vsc-tx'),
        ty: ctrl.style.getPropertyValue('--vsc-ty'),
      };
    });
    assert.ok(parseFloat(dragVars.tx) > 50, `Expected --vsc-tx > 50, got ${dragVars.tx}`);
    assert.ok(parseFloat(dragVars.ty) > 25, `Expected --vsc-ty > 25, got ${dragVars.ty}`);

    // Return video1 from 1.1 -> 1.0 via wheel so all videos share a synchronized 1.0 baseline
    await page.mouse.move(dragBox.x + 80, dragBox.y + 45);
    await page.waitForTimeout(360);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(
      () => Math.abs(document.getElementById('video1').playbackRate - 1.0) < 0.01,
      null,
      { timeout: 5000 }
    );

    // 7. Dual-video conflict surrender: video2 fights back asynchronously (setTimeout) -> surrenders after budget; video1 keeps 1.6
    await page.evaluate(() => {
      const v2 = document.getElementById('video2');
      window.__v2Resets = 0;
      let timerScheduled = false;
      v2.addEventListener('ratechange', () => {
        if (Math.abs(v2.playbackRate - 1.0) > 0.01 && !timerScheduled && window.__v2Resets < 20) {
          timerScheduled = true;
          setTimeout(() => {
            timerScheduled = false;
            window.__v2Resets++;
            v2.playbackRate = 1.0;
          }, 15);
        }
      });
    });
    await page.keyboard.press('g'); // jumps all videos to 1.60
    await page.waitForFunction(
      () =>
        Math.abs(document.getElementById('video1').playbackRate - 1.6) < 0.01 &&
        Math.abs(document.getElementById('video2').playbackRate - 1.0) < 0.01 &&
        window.__v2Resets >= 5,
      null,
      { timeout: 5000 }
    );
    await page.waitForTimeout(120);
    const conflictOutcome = await page.evaluate(() => ({
      v1Rate: document.getElementById('video1').playbackRate,
      v2Rate: document.getElementById('video2').playbackRate,
      v2Resets: window.__v2Resets,
    }));
    assert.ok(Math.abs(conflictOutcome.v1Rate - 1.6) < 0.01, `v1 should stay 1.60, got ${conflictOutcome.v1Rate}`);
    assert.ok(Math.abs(conflictOutcome.v2Rate - 1.0) < 0.01, `v2 should surrender to 1.0, got ${conflictOutcome.v2Rate}`);
    assert.equal(conflictOutcome.v2Resets, 5, `Expected 1 initial + 4 fight retries (5 total resets), got ${conflictOutcome.v2Resets}`);

    // 8. SPA history.pushState + dynamically injected video
    await page.click('#spa-push');
    await page.waitForFunction(
      () => document.querySelectorAll('vsc-controller').length === 3,
      null,
      { timeout: 10000 }
    );

    // 9. Options page verification (UI render, tab switch, Controller Positioning Studio replaces Custom CSS)
    const optionsPage = await context.newPage();
    optionsPage.on('pageerror', (err) => errors.push(`options pageerror: ${err.message}`));
    await optionsPage.goto(`chrome-extension://${extId}/ui/options/options.html`, { waitUntil: 'domcontentloaded' });
    await optionsPage.waitForSelector('#shortcuts-container .row');

    const shortcutCount = await optionsPage.locator('#shortcuts-container .row').count();
    assert.equal(shortcutCount, 9, `Expected 9 default shortcuts, got ${shortcutCount}`);
    const defaultShortcutRows = await optionsPage.evaluate(() =>
      Array.from(document.querySelectorAll('#shortcuts-container .row')).map((row) => ({
        action: row.querySelector('.customDo').value,
        key: row.querySelector('.customKey').value,
        value: row.querySelector('.customValue').value,
      }))
    );
    assert.deepEqual(defaultShortcutRows, [
      { action: 'slower', key: 'X', value: '0.1' },
      { action: 'faster', key: 'C', value: '0.1' },
      { action: 'rewind', key: 'S', value: '5' },
      { action: 'advance', key: 'D', value: '5' },
      { action: 'reset', key: 'Z', value: '1' },
      { action: 'fast', key: 'G', value: '1.6' },
      { action: 'display', key: 'V', value: '0' },
      { action: 'mark', key: 'M', value: '0' },
      { action: 'jump', key: 'J', value: '0' },
    ]);
    assert.equal(await optionsPage.locator('#controllerCSS').count(), 0, 'Custom CSS textarea should be removed');

    // Switch to Advanced tab -> verify platform positioning pills & invalid site rule fail-closed
    await optionsPage.click('#tab-advanced');
    const platformPills = await optionsPage.locator('#pos-platform-tabs .pos-site-pill').allTextContents();
    assert.ok(platformPills.some((t) => t.includes('Global Default')), 'Expected Global Default tab');
    assert.ok(platformPills.some((t) => t.includes('YouTube')), 'Expected YouTube tab');
    assert.ok(platformPills.some((t) => t.includes('Facebook')), 'Expected Facebook tab');
    assert.ok(platformPills.some((t) => t.includes('Instagram')), 'Expected Instagram tab');
    assert.ok(platformPills.some((t) => t.includes('X (Twitter)')), 'Expected X (Twitter) tab');

    await optionsPage.fill('#site-rules-container .rulePattern >> nth=0', '/[bad-regex/');
    await optionsPage.click('#save');
    const errStatus = await optionsPage.locator('#status').textContent();
    assert.match(errStatus, /Invalid pattern/);

    // Fix invalid site rule, set independent YouTube & Facebook positions, add 127.0.0.1 custom site position
    await optionsPage.fill('#site-rules-container .rulePattern >> nth=0', 'imgur.com');
    await optionsPage.fill('#controllerOpacity', '0.55');

    // Configure YouTube -> Top-Right + Left (10px) + Down (10px), verify hotspot active sync too
    await optionsPage.click('#pos-platform-tabs [data-site-key="youtube"]');
    await optionsPage.click('.pos-hotspot[data-anchor="top-right"]');
    assert.equal(await optionsPage.locator('.pos-anchor-btn[data-anchor="top-right"].active').count(), 1);
    await optionsPage.click('.pos-nudge-btn[data-nudge="left"]');
    await optionsPage.click('.pos-nudge-btn[data-nudge="down"]');

    // Configure Facebook -> Bottom-Left (independent from YouTube)
    await optionsPage.click('#pos-platform-tabs [data-site-key="facebook"]');
    await optionsPage.click('.pos-anchor-btn[data-anchor="bottom-left"]');

    // Add site-wise override for active fixture host (127.0.0.1) -> Bottom-Right + Up 20px + Left 10px
    await optionsPage.fill('#pos-site-pattern', '127.0.0.1');
    await optionsPage.click('#pos-add-site');
    await optionsPage.click('.pos-anchor-btn[data-anchor="bottom-right"]');
    await optionsPage.click('.pos-nudge-btn[data-nudge="up"]');
    await optionsPage.click('.pos-nudge-btn[data-nudge="up"]');
    await optionsPage.click('.pos-nudge-btn[data-nudge="left"]');
    const studioReadout = await optionsPage.locator('#pos-readout').textContent();
    assert.match(studioReadout, /Bottom Right · X: -10px · Y: -20px/);

    await optionsPage.click('#save');
    await optionsPage.waitForFunction(
      () => document.getElementById('status')?.textContent?.includes('Options saved'),
      null,
      { timeout: 5000 }
    );
    const savedSettings = await optionsPage.evaluate(
      () => new Promise((r) => chrome.storage.sync.get(['controllerOpacity', 'sitePositions'], r))
    );
    assert.equal(savedSettings.controllerOpacity, 0.55);
    const ytRule = savedSettings.sitePositions.find((s) => s.id === 'youtube');
    const fbRule = savedSettings.sitePositions.find((s) => s.id === 'facebook');
    assert.deepEqual(
      { anchor: ytRule.anchor, offsetX: ytRule.offsetX, offsetY: ytRule.offsetY },
      { anchor: 'top-right', offsetX: -10, offsetY: 10 }
    );
    assert.deepEqual(
      { anchor: fbRule.anchor, offsetX: fbRule.offsetX, offsetY: fbRule.offsetY },
      { anchor: 'bottom-left', offsetX: 0, offsetY: 0 }
    );

    // Verify live settings propagation & bottom-right bounding rect on open content tab!
    await page.waitForFunction(() => {
      const ctrl = document.querySelector('vsc-controller')?.shadowRoot?.querySelector('#controller');
      return (
        ctrl?.style.getPropertyValue('--vsc-opacity') === '0.55' &&
        ctrl?.style.getPropertyValue('--vsc-align-x') === '-100%' &&
        ctrl?.style.getPropertyValue('--vsc-align-y') === '-100%'
      );
    });
    const positionedLayout = await page.evaluate(() => {
      const videoRect = document.getElementById('video1').getBoundingClientRect();
      const ctrl = document.querySelector('vsc-controller').shadowRoot.querySelector('#controller');
      const ctrlRect = ctrl.getBoundingClientRect();
      return {
        videoRect: { left: videoRect.left, top: videoRect.top, right: videoRect.right, bottom: videoRect.bottom, width: videoRect.width, height: videoRect.height },
        ctrlRect: { left: ctrlRect.left, top: ctrlRect.top, right: ctrlRect.right, bottom: ctrlRect.bottom },
        tx: ctrl.style.getPropertyValue('--vsc-tx'),
        ty: ctrl.style.getPropertyValue('--vsc-ty'),
      };
    });
    assert.equal(positionedLayout.tx, '0px');
    assert.equal(positionedLayout.ty, '0px');
    assert.ok(
      positionedLayout.ctrlRect.left > positionedLayout.videoRect.left + positionedLayout.videoRect.width / 2,
      'Bottom-Right anchored controller should sit in right half of video'
    );
    assert.ok(
      positionedLayout.ctrlRect.top > positionedLayout.videoRect.top + positionedLayout.videoRect.height / 2,
      'Bottom-Right anchored controller should sit in bottom half of video'
    );
    assert.ok(
      positionedLayout.ctrlRect.right < positionedLayout.videoRect.right,
      'Bottom-Right anchored controller must stay inside right video edge'
    );
    assert.ok(
      positionedLayout.ctrlRect.bottom < positionedLayout.videoRect.bottom,
      'Bottom-Right anchored controller must stay inside bottom video edge'
    );

    // Verify About tab replaces FAQ tab, contains usage guides + author info, and places FAQs at the bottom
    assert.equal(await optionsPage.locator('#tab-faq').count(), 0, 'Standalone FAQ tab should be removed');
    assert.equal(await optionsPage.locator('#tab-about').count(), 1, 'Expected About tab button');
    assert.equal((await optionsPage.locator('#tab-about').textContent()).trim(), 'About');

    await optionsPage.click('#tab-about');
    await optionsPage.waitForFunction(() => {
      const hdr = document.querySelector('.header-icon');
      const hero = document.querySelector('.about-hero-icon');
      return hdr?.complete && hdr.naturalWidth > 0 && hero?.complete && hero.naturalWidth > 0;
    });
    const aboutLayout = await optionsPage.evaluate(() => {
      const panel = document.getElementById('panel-about');
      const guideRect = document.getElementById('about-guide').getBoundingClientRect();
      const authorRect = document.getElementById('about-author').getBoundingClientRect();
      const faqRect = document.getElementById('about-faq').getBoundingClientRect();
      const hdrLogo = document.querySelector('.header-icon');
      const heroLogo = document.querySelector('.about-hero-icon');
      const favicon = document.querySelector('link[rel="icon"]');
      return {
        panelVisible: panel && getComputedStyle(panel).display !== 'none',
        shortcutsRows: document.querySelectorAll('.about-shortcuts-table tbody tr').length,
        authorText: document.getElementById('about-author')?.textContent || '',
        guideTop: guideRect.top,
        authorTop: authorRect.top,
        faqTop: faqRect.top,
        headerLogoWidth: hdrLogo?.naturalWidth || 0,
        headerLogoSrc: hdrLogo?.getAttribute('src') || '',
        heroLogoWidth: heroLogo?.naturalWidth || 0,
        heroLogoSrc: heroLogo?.getAttribute('src') || '',
        faviconHref: favicon?.getAttribute('href') || '',
      };
    });
    assert.equal(aboutLayout.panelVisible, true, 'About panel should be visible');
    assert.equal(aboutLayout.shortcutsRows, 9, 'About shortcuts guide should document all 9 default bindings');
    assert.match(aboutLayout.authorText, /Mehedi Hasan Shihab/);
    assert.ok(aboutLayout.faqTop > aboutLayout.guideTop, 'FAQ section should appear below Usage Guide');
    assert.ok(aboutLayout.faqTop > aboutLayout.authorTop, 'FAQ section should appear at the bottom below Author');
    assert.equal(aboutLayout.headerLogoWidth, 48, 'Options header icon should load 48x48 main icon');
    assert.match(aboutLayout.headerLogoSrc, /assets\/icons\/icon48\.png$/);
    assert.equal(aboutLayout.heroLogoWidth, 512, 'About hero should load 512x512 master logo');
    assert.match(aboutLayout.heroLogoSrc, /assets\/logo\.png$/);
    assert.match(aboutLayout.faviconHref, /assets\/icons\/icon48\.png$/);

    await optionsPage.close();

    // 10. Popup quick position controls + Power-off VSC_TEARDOWN propagation
    const popupPage = await context.newPage();
    popupPage.on('pageerror', (err) => errors.push(`popup pageerror: ${err.message}`));
    await popupPage.goto(`chrome-extension://${extId}/ui/popup/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForSelector('#pos-scope-select option[value="youtube"]', { state: 'attached' });
    await popupPage.waitForFunction(() => {
      const icon = document.querySelector('.brand-icon');
      return icon?.complete && icon.naturalWidth > 0;
    });
    const popupLogo = await popupPage.evaluate(() => ({
      naturalWidth: document.querySelector('.brand-icon')?.naturalWidth || 0,
      src: document.querySelector('.brand-icon')?.getAttribute('src') || '',
      faviconHref: document.querySelector('link[rel="icon"]')?.getAttribute('href') || '',
      preferredText: document.getElementById('speed-reset')?.textContent?.trim() || '',
    }));
    assert.equal(popupLogo.naturalWidth, 48, 'Popup brand icon should load 48x48 main icon');
    assert.match(popupLogo.src, /assets\/icons\/icon48\.png$/);
    assert.match(popupLogo.faviconHref, /assets\/icons\/icon48\.png$/);
    assert.equal(popupLogo.preferredText, '1.6');

    await popupPage.selectOption('#pos-scope-select', 'youtube');
    const ytPopupReadout = await popupPage.locator('#popup-pos-readout').textContent();
    assert.match(ytPopupReadout, /Top Right · -10,10px/);

    const localSiteVal = await popupPage.evaluate(() => {
      const opt = Array.from(document.querySelectorAll('#pos-scope-select option')).find((o) =>
        o.textContent.includes('127.0.0.1')
      );
      return opt?.value || '';
    });
    assert.ok(localSiteVal, 'Expected 127.0.0.1 rule in Popup scope selector');
    await popupPage.selectOption('#pos-scope-select', localSiteVal);
    await popupPage.click('.mini-pos-btn[data-anchor="top-right"]');
    await popupPage.click('.mini-nudge-btn[data-nudge="down"]');
    const popupNudgedReadout = await popupPage.locator('#popup-pos-readout').textContent();
    assert.match(popupNudgedReadout, /Top Right · -10,-10px/);

    // Verify open video tab updates live to top-right (--vsc-align-x: -100%, --vsc-align-y: 0%)
    await page.waitForFunction(() => {
      const ctrl = document.querySelector('vsc-controller')?.shadowRoot?.querySelector('#controller');
      return (
        ctrl?.style.getPropertyValue('--vsc-align-x') === '-100%' &&
        ctrl?.style.getPropertyValue('--vsc-align-y') === '0%'
      );
    });

    await popupPage.waitForSelector('#disable');
    await popupPage.click('#disable');
    await popupPage.waitForFunction(
      () => document.getElementById('status')?.textContent?.includes('Disabled'),
      null,
      { timeout: 5000 }
    );

    // Original tab should tear down all vsc-controller elements!
    await page.waitForFunction(
      () => document.querySelectorAll('vsc-controller').length === 0,
      null,
      { timeout: 5000 }
    );

    // Re-enable extension cleanly
    await popupPage.click('#disable');
    await popupPage.close();
    await page.close();

    assert.deepEqual(errors, [], `Unexpected console/page errors: ${errors.join('; ')}`);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const { server, baseUrl } = await startFixtureServer();
  try {
    for (const spec of BROWSERS) {
      const start = performance.now();
      process.stdout.write(`Running E2E suite on ${spec.name}... `);
      await runBrowserSuite(spec, baseUrl);
      const ms = (performance.now() - start).toFixed(0);
      console.log(`PASS (${ms}ms)`);
    }
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
