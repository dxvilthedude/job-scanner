'use strict';

const { UA } = require('../http');
const { makeJob } = require('../normalize');

/**
 * LinkedIn - publiczny endpoint wyszukiwarki dla niezalogowanych gosci
 * (ten sam, ktorego uzywa strona /jobs/search przy doladowywaniu wynikow).
 * Zwraca fragment HTML z kartami ofert - 10 sztuk na zapytanie.
 *
 * Karty gosci nie zawieraja widelek ani listy technologii, wiec z LinkedIna
 * mamy: stanowisko, firme, lokalizacje, date i link. Poziom stanowiska
 * zawezamy po stronie portalu (f_E), a dodatkowo wykrywamy go z tytulu.
 */

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

// f_E: 1 = staz, 2 = entry level, 3 = associate, 4 = mid-senior, 5 = dyrektor, 6 = zarzad
const EXPERIENCE = { junior: ['1', '2', '3'], mid: ['4'], senior: ['4', '5', '6'] };
// f_WT: 1 = stacjonarnie, 2 = zdalnie, 3 = hybrydowo
const WORK_TYPE = { remote: '2', hybrid: '3', onsite: '1' };

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function decode(s) {
  return String(s || '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, function (m) { return ENTITIES[m]; })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(html, re) {
  const m = html.match(re);
  return m ? decode(m[1]) : '';
}

function buildUrl(params, start) {
  const qs = new URLSearchParams();
  qs.set('keywords', params.query || 'azure');
  qs.set('location', params.location || 'Poland');
  qs.set('sortBy', 'DD');            // najnowsze najpierw
  qs.set('start', String(start));

  const levels = [];
  for (const s of (params.seniority || [])) {
    if (EXPERIENCE[s]) levels.push.apply(levels, EXPERIENCE[s]);
  }
  if (levels.length) qs.set('f_E', Array.from(new Set(levels)).join(','));

  const wt = WORK_TYPE[params.workMode];
  if (wt) qs.set('f_WT', wt);

  return BASE + '?' + qs.toString();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
    }
  });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + (res.status === 429 ? ' - LinkedIn chwilowo ogranicza zapytania, zmniejsz glebokosc skanu' : ''));
    err.status = res.status;
    throw err;
  }
  return res.text();
}

function parseCards(html, params) {
  const chunks = html.split('<li>').slice(1);
  const jobs = [];

  for (const chunk of chunks) {
    const id = (chunk.match(/urn:li:jobPosting:(\d+)/) || [])[1];
    const title = pick(chunk, /base-search-card__title">([\s\S]*?)<\/h3>/);
    if (!id || !title) continue;

    const rawUrl = pick(chunk, /class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/);
    const company = pick(chunk, /base-search-card__subtitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const location = pick(chunk, /job-search-card__location">([\s\S]*?)<\/span>/);
    const date = (chunk.match(/datetime="([\d-]+)"/) || [])[1];
    const logo = (chunk.match(/data-delayed-url="(https:\/\/media\.licdn\.com[^"]+)"/) || [])[1];

    jobs.push(makeJob({
      source: 'linkedin',
      sourceLabel: 'LinkedIn',
      id: id,
      title: title,
      company: company,
      companyLogo: logo ? decode(logo) : null,
      // Link gosca ma dlugi ogon parametrow sledzacych - obcinamy.
      url: (rawUrl || 'https://www.linkedin.com/jobs/view/' + id).split('?')[0],
      locations: location ? [location] : [],
      // Gdy filtrujemy po stronie LinkedIna, tryb pracy znamy na pewno;
      // inaczej zostawiamy wykrywanie z tekstu lokalizacji.
      remote: params.workMode === 'remote' ? true : undefined,
      salary: null,
      tags: [],
      excerpt: params.workMode === 'hybrid' ? 'hybrydowa' : '',
      postedAt: date ? Date.parse(date) : null,
      country: null
    }, params.terms));
  }
  return jobs;
}

async function fetchJobs(params) {
  // Jedno zapytanie = 10 ofert, wiec na jeden "poziom glebokosci" robimy trzy.
  const requests = Math.max(1, Math.min((params.pages || 1) * 3, 10));
  const seen = new Set();
  const jobs = [];
  let firstError = null;

  for (let i = 0; i < requests; i++) {
    try {
      const html = await fetchPage(buildUrl(params, i * 10));
      const batch = parseCards(html, params);
      if (!batch.length) break;                   // koniec wynikow
      for (const job of batch) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        jobs.push(job);
      }
    } catch (err) {
      firstError = firstError || err;
      break;                                      // np. 429 - konczymy tym, co mamy
    }
    if (i < requests - 1) await new Promise(function (r) { setTimeout(r, 250); });
  }

  if (!jobs.length && firstError) throw firstError;
  return { total: jobs.length, jobs: jobs, partialError: firstError ? firstError.message : null };
}

module.exports = {
  key: 'linkedin',
  label: 'LinkedIn',
  region: 'Polska (konfigurowalne)',
  homepage: 'https://www.linkedin.com/jobs',
  fetchJobs: fetchJobs
};
