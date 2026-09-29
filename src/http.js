'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** fetch z timeoutem i naglowkami przegladarki - portale odrzucaja goly agent. */
async function getJson(url, options) {
  const opts = options || {};
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, opts.timeout || 20000);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8'
      }, opts.headers || {}),
      body: opts.body,
      signal: ac.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(function () { return ''; });
      const err = new Error('HTTP ' + res.status + ' ' + res.statusText + (text ? ' :: ' + text.slice(0, 120) : ''));
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { getJson, stripHtml, UA };
