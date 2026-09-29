'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { scan, clearCache } = require('./src/scanner');
const { sources } = require('./src/sources');
const deeplinks = require('./src/deeplinks');
const browser = require('./src/browser');
const { AZURE_TERMS } = require('./src/normalize');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.warn('[config] nie moge wczytac config.json:', err.message);
    return { port: 4321, cacheMinutes: 10, defaultQuery: 'azure' };
  }
}

/**
 * Profile wyszukiwania (Azure, Unity/gamedev, dowolna fraza...) z config.json.
 * Stary config bez "profiles" dalej dziala - robimy z niego jeden profil Azure.
 */
function getProfiles(config) {
  if (Array.isArray(config.profiles) && config.profiles.length) return config.profiles;
  return [{
    key: 'azure',
    label: 'Azure / Cloud',
    defaultQuery: config.defaultQuery || 'azure',
    presets: config.queryPresets || [],
    boostTerms: AZURE_TERMS,
    titleWords: []
  }];
}

function pickProfile(config, key) {
  const all = getProfiles(config);
  return all.find(function (p) { return p.key === key; })
    || all.find(function (p) { return p.key === config.defaultProfile; })
    || all[0];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(path.join(ROOT, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Nie znaleziono: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function list(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return [];
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p === '/api/sources') {
      const config = loadConfig();
      return sendJson(res, 200, {
        scannable: sources.map(function (s) {
          return {
            key: s.key, label: s.label, region: s.region, homepage: s.homepage,
            needsKey: !!s.needsKey,
            needsBrowser: !!s.needsBrowser,
            ready: s.needsBrowser
              ? ((config.browser || {}).enabled !== false && browser.isAvailable(config.browser))
              : (!s.needsKey || !!(config.adzuna && config.adzuna.enabled && config.adzuna.app_id))
          };
        }),
        profiles: getProfiles(config).map(function (p) {
          return {
            key: p.key, label: p.label, subtitle: p.subtitle || '',
            defaultQuery: p.defaultQuery || '', placeholder: p.placeholder || '',
            presets: p.presets || [], titleWords: p.titleWords || [],
            titleFilterLabel: p.titleFilterLabel || ''
          };
        }),
        defaultProfile: pickProfile(config, null).key
      });
    }

    if (p === '/api/scan') {
      const config = loadConfig();
      const profile = pickProfile(config, url.searchParams.get('profile'));
      const params = {
        query: url.searchParams.get('q') || profile.defaultQuery || '',
        profile: profile,
        sources: list(url, 'sources'),
        seniority: list(url, 'seniority'),
        workMode: url.searchParams.get('workMode') || '',
        location: url.searchParams.get('location') || (config.linkedin && config.linkedin.location) || '',
        pages: Number(url.searchParams.get('pages') || 1),
        noCache: url.searchParams.get('fresh') === '1',
        config: config
      };
      const started = Date.now();
      const out = await scan(params);
      out.ms = Date.now() - started;
      return sendJson(res, 200, out);
    }

    if (p === '/api/deeplinks') {
      const profile = pickProfile(loadConfig(), url.searchParams.get('profile'));
      return sendJson(res, 200, {
        links: deeplinks.build({
          profile: profile,
          query: url.searchParams.get('q') || profile.defaultQuery || '',
          seniority: list(url, 'seniority'),
          workMode: url.searchParams.get('workMode') || '',
          location: url.searchParams.get('location') || '',
          days: url.searchParams.get('days') || 0
        })
      });
    }

    if (p === '/api/cache' && req.method === 'DELETE') {
      clearCache();
      return sendJson(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Nieznany endpoint' });

    return serveStatic(req, res, p);
  } catch (err) {
    console.error('[server]', err);
    return sendJson(res, 500, { error: err.message });
  }
});

// Przy wyjsciu domykamy sterowana przegladarke, zeby nie zostawal proces w tle.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, function () {
    browser.close().finally(function () { process.exit(0); });
  });
}

const config = loadConfig();
const PORT = process.env.PORT || config.port || 4321;
server.listen(PORT, function () {
  console.log('');
  console.log('  Job Scanner dziala:  http://localhost:' + PORT);
  console.log('  Profile: ' + getProfiles(config).map(function (p) { return p.label; }).join(', '));
  console.log('  Zrodla skanowane automatycznie: ' + sources.map(function (s) { return s.label; }).join(', '));
  console.log('  Ctrl+C konczy prace.');
  console.log('');
});
