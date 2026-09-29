'use strict';

const { sources, byKey } = require('./sources');
const { relevance, norm, hasWord } = require('./normalize');

/** Prosty cache w pamieci - nie meczymy portali przy kazdym przelaczeniu filtra. */
const cache = new Map();

function cacheKey(sourceKey, params) {
  return [sourceKey, params.query, (params.seniority || []).join(','), params.workMode, params.location, params.pages].join('|');
}

function splitTerms(query) {
  return String(query || '')
    .split(/[\s,]+/)
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 1; });
}

// Slowa, ktore same w sobie nie mowia, czego szukamy. Zrodla bez wlasnej wyszukiwarki
// (Remotive, Himalayas, Jobicy, Arbeitnow) filtruja lokalnie "ktorekolwiek slowo pasuje",
// wiec "unity developer" bez tego zwracaloby kazda oferte z "developer" w tresci.
const GENERIC_WORDS = [
  'developer', 'dev', 'programmer', 'programista', 'engineer', 'inzynier', 'junior', 'mid',
  'senior', 'regular', 'specialist', 'specjalista', 'administrator', 'admin', 'support',
  'remote', 'zdalna', 'praca', 'job', 'jobs', 'stanowisko', 'and', 'or'
];

/** Slowa wysylane do filtrowania w zrodlach: bez ogolnikow, chyba ze nic innego nie zostalo. */
function keyTerms(terms) {
  const specific = terms.filter(function (t) { return GENERIC_WORDS.indexOf(norm(t)) === -1; });
  return specific.length ? specific : terms;
}

/**
 * Odpala wszystkie wybrane zrodla rownolegle. Padniete zrodlo nie psuje
 * calego skanu - wraca jako wpis z bledem w polu "sources".
 */
async function scan(params) {
  const config = params.config || {};
  const ttl = (config.cacheMinutes != null ? config.cacheMinutes : 10) * 60000;
  const wanted = (params.sources && params.sources.length)
    ? params.sources.filter(function (k) { return byKey[k]; })
    : sources.map(function (s) { return s.key; });

  const terms = splitTerms(params.query);
  const profile = params.profile || {};
  const shared = {
    query: params.query,
    terms: keyTerms(terms),
    seniority: params.seniority || [],
    // LinkedIn potrafi zawezic tryb pracy i lokalizacje po swojej stronie,
    // pozostale zrodla te pola ignoruja i filtrujemy je lokalnie.
    workMode: params.workMode || '',
    location: params.location || '',
    pages: params.pages || 1,
    config: config
  };

  const results = await Promise.all(wanted.map(async function (key) {
    const src = byKey[key];
    const ck = cacheKey(key, shared);
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < ttl && !params.noCache) {
      return { key: key, label: src.label, status: 'cache', count: hit.jobs.length, total: hit.total, jobs: hit.jobs, ms: 0 };
    }
    const started = Date.now();
    try {
      const out = await src.fetchJobs(shared);
      cache.set(ck, { at: Date.now(), jobs: out.jobs, total: out.total });
      return {
        key: key, label: src.label, status: 'ok',
        count: out.jobs.length, total: out.total, scanned: out.scanned || null,
        warning: out.partialError || null,
        jobs: out.jobs, ms: Date.now() - started
      };
    } catch (err) {
      return {
        key: key, label: src.label,
        status: err.code === 'NOT_CONFIGURED' ? 'skipped' : 'error',
        error: err.message, count: 0, jobs: [], ms: Date.now() - started
      };
    }
  }));

  // Deduplikacja: ta sama oferta potrafi byc na kilku portalach.
  // excludeTerms z profilu: myla sie z fraza, np. "Unity Catalog" (Databricks) przy profilu Unity.
  const exclude = profile.excludeTerms || [];
  const seen = new Map();
  for (const r of results) {
    for (const job of r.jobs) {
      if (exclude.some(function (t) { return hasWord(job.searchBlob || '', t); })) continue;
      // strictMatch: portale szukajace po pelnym opisie (NoFluffJobs) oddaja oferty, w ktorych
      // fraza pada tylko w opisie ("Unity Catalog" u data engineerow). Zostawiamy tylko te,
      // gdzie fraza jest w tytule, tagach albo zajawce.
      if (profile.strictMatch && !shared.terms.some(function (t) { return hasWord(job.searchBlob || '', t); })) continue;
      // Liczone przy kazdym skanie, bo cache jest wspolny dla profili, a trafnosc od profilu zalezy.
      job.relevance = relevance(job, terms, profile.boostTerms);
      const fingerprint = (job.title + '|' + job.company).toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = seen.get(fingerprint);
      if (!existing) {
        job.alsoOn = [];
        seen.set(fingerprint, job);
      } else if (existing.source !== job.source) {
        existing.alsoOn.push({ source: job.source, label: job.sourceLabel, url: job.url });
      }
    }
  }

  const jobs = Array.from(seen.values()).sort(function (a, b) { return b.relevance - a.relevance; });

  return {
    scannedAt: Date.now(),
    query: params.query,
    profile: profile.key || null,
    jobs: jobs,
    sources: results.map(function (r) {
      const copy = Object.assign({}, r);
      delete copy.jobs;
      return copy;
    })
  };
}

module.exports = { scan: scan, clearCache: function () { cache.clear(); } };
