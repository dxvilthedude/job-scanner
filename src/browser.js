'use strict';

const fs = require('fs');

/**
 * Wspoldzielona przegladarka dla portali, ktore blokuja zwykle zapytania HTTP
 * (pracuj.pl - challenge JS Cloudflare). Uzywamy puppeteer-core, ktory nie pobiera
 * wlasnego Chromium tylko steruje przegladarka juz zainstalowana w systemie.
 *
 * Instancja jest jedna na caly proces i sama sie zamyka po okresie bezczynnosci,
 * zeby nie zostawiac wiszacego procesu miedzy skanami.
 */

const EXECUTABLES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browser = null;
let launching = null;
let idleTimer = null;

function notConfigured(message) {
  const err = new Error(message);
  err.code = 'NOT_CONFIGURED';
  return err;
}

function loadPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (err) {
    throw notConfigured('Brak puppeteer-core - zainstaluj go poleceniem: npm i puppeteer-core');
  }
}

function findExecutable(configured) {
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw notConfigured('Sciezka z config.json nie istnieje: ' + configured);
    }
    return configured;
  }
  for (const p of EXECUTABLES) {
    if (fs.existsSync(p)) return p;
  }
  throw notConfigured('Nie znalazlem Edge ani Chrome - wpisz sciezke w config.json (browser.executablePath)');
}

function scheduleShutdown(idleMs) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(function () { close(); }, idleMs);
  if (idleTimer.unref) idleTimer.unref();
}

async function getBrowser(cfg) {
  if (browser && browser.connected !== false) return browser;
  if (launching) return launching;

  const puppeteer = loadPuppeteer();
  const executablePath = findExecutable(cfg.executablePath);

  launching = puppeteer.launch({
    executablePath: executablePath,
    headless: cfg.headless === false ? false : 'new',
    args: [
      // Bez tego Cloudflare rozpoznaje sterowana przegladarke i zatrzymuje sie na challengu.
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1400,900'
    ]
  }).then(function (b) {
    browser = b;
    launching = null;
    b.on('disconnected', function () { browser = null; });
    return b;
  }).catch(function (err) {
    launching = null;
    throw err;
  });

  return launching;
}

/**
 * Otwiera strone, czeka az na stronie pojawi sie wskazany selektor
 * (challenge Cloudflare potrafi mielic kilka sekund) i zwraca jej tresc.
 */
async function getText(url, selector, cfg) {
  const options = cfg || {};
  const b = await getBrowser(options);
  const page = await b.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1400, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8' });
    // Kosmetyka, po ktorej sterowana przegladarka wyglada jak zwykla.
    await page.evaluateOnNewDocument(function () {
      Object.defineProperty(navigator, 'webdriver', { get: function () { return undefined; } });
      Object.defineProperty(navigator, 'languages', { get: function () { return ['pl-PL', 'pl', 'en-US']; } });
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout || 45000 });
    await page.waitForSelector(selector, { timeout: options.selectorTimeout || 30000 });
    return await page.$eval(selector, function (el) { return el.textContent; });
  } finally {
    await page.close().catch(function () { /* strona mogla juz zniknac */ });
    scheduleShutdown(options.idleTimeoutMs || 120000);
  }
}

async function close() {
  clearTimeout(idleTimer);
  const b = browser;
  browser = null;
  if (b) await b.close().catch(function () { /* juz zamknieta */ });
}

function isAvailable(cfg) {
  try {
    loadPuppeteer();
    findExecutable((cfg || {}).executablePath);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { getText: getText, close: close, isAvailable: isAvailable, UA: UA };
