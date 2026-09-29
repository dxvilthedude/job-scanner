'use strict';

const browser = require('../browser');
const { makeJob } = require('../normalize');

/**
 * pracuj.pl - najwiekszy polski portal.
 *
 * Zwykle zapytanie HTTP dostaje 403 (challenge JS Cloudflare), ale oferty sa
 * server-side w <script id="__NEXT_DATA__"> na stronie wynikow. Wystarczy wiec
 * otworzyc adres w prawdziwej przegladarce (puppeteer-core + Edge/Chrome
 * zainstalowany w systemie) i odczytac ten sam JSON, ktorego uzywa ich frontend.
 *
 * Kody filtrow pobrane ze slownikow samego portalu:
 *   poziom (et): 1 praktykant/staz, 3 asystent, 17 junior, 4 mid, 18 senior, 19 ekspert
 *   tryb pracy (wm): full-office, hybrid, home-office, mobile
 */

const LEVEL_CODES = { junior: ['1', '3', '17'], mid: ['4'], senior: ['18', '19'] };
const WORK_MODE_CODES = { remote: 'home-office', hybrid: 'hybrid', onsite: 'full-office' };

// Nazwy poziomow ze slownika portalu -> nasze kategorie.
function mapLevels(levels) {
  return (levels || []).map(function (name) {
    const n = String(name).toLowerCase();
    if (n.includes('praktyk') || n.includes('staż') || n.includes('staz') || n.includes('asystent') || n.includes('junior') || n.includes('młodszy') || n.includes('mlodszy')) return 'Junior';
    if (n.includes('senior') || n.includes('starszy') || n.includes('ekspert') || n.includes('kierownik') || n.includes('dyrektor') || n.includes('menedżer') || n.includes('menedzer') || n.includes('prezes')) return 'Senior';
    if (n.includes('mid') || n.includes('regular') || n.includes('specjalista')) return 'Mid';
    return name;
  });
}

function buildUrl(params, page) {
  const service = (params.config && params.config.pracuj && params.config.pracuj.service) || 'all';
  const host = service === 'it' ? 'https://it.pracuj.pl' : 'https://www.pracuj.pl';
  const keyword = encodeURIComponent(String(params.query || 'azure').trim());

  const qs = [];
  const levels = [];
  for (const s of (params.seniority || [])) {
    if (LEVEL_CODES[s]) levels.push.apply(levels, LEVEL_CODES[s]);
  }
  if (levels.length) qs.push('et=' + Array.from(new Set(levels)).join('%2C'));

  const wm = WORK_MODE_CODES[params.workMode];
  if (wm) qs.push('wm=' + wm);
  if (page > 1) qs.push('pn=' + page);

  return host + '/praca/' + keyword + ';kw' + (qs.length ? '?' + qs.join('&') : '');
}

function extractOffers(nextDataText) {
  const data = JSON.parse(nextDataText);
  const queries = ((data.props || {}).pageProps || {}).dehydratedState;
  const list = (queries && queries.queries) || [];
  const offers = list.find(function (q) { return q.queryKey && q.queryKey[0] === 'jobOffers'; });
  if (!offers || !offers.state || !offers.state.data) return { total: 0, groups: [] };
  return {
    total: offers.state.data.offersTotalCount || 0,
    groups: offers.state.data.groupedOffers || []
  };
}

/**
 * pracuj.pl podaje widelki jako gotowy tekst, np.:
 *   "110–200 zl netto (+ VAT) / godz."   "8 000–14 000 zl / mies. (zal. od umowy)"
 * Wyciagamy z tego liczby, zeby dzialal filtr minimalnej stawki i sortowanie,
 * ale w interfejsie i tak pokazujemy oryginalny tekst pracodawcy.
 */
function parseSalary(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/ /g, ' ');
  const numbers = (cleaned.match(/\d[\d ]*/g) || [])
    .map(function (n) { return Number(n.replace(/ /g, '')); })
    .filter(function (n) { return n > 0; });
  if (!numbers.length) return null;

  const period = /godz/i.test(cleaned) ? 'Hour' : /dzie/i.test(cleaned) ? 'Day' : /rok|rocznie/i.test(cleaned) ? 'Year' : 'Month';
  // Stawki godzinowe bywaja podane obok kwot miesiecznych w tym samym tekscie -
  // bierzemy pierwsze dwie liczby, bo to zawsze wlasciwe widelki.
  return {
    from: numbers[0],
    to: numbers.length > 1 ? numbers[1] : null,
    currency: 'PLN',
    period: period,
    type: /netto/i.test(cleaned) ? 'b2b' : /brutto/i.test(cleaned) ? 'uop' : null
  };
}

function toJob(group, params) {
  // Jedna oferta moze byc opublikowana w kilku miastach - zbieramy je razem.
  const places = (group.offers || []).map(function (o) { return o.displayWorkplace; }).filter(Boolean);
  const first = (group.offers || [])[0] || {};
  const workModes = group.workModes || [];
  const isRemote = group.isRemoteWorkAllowed === true ||
    workModes.some(function (m) { return /zdaln/i.test(m); });
  const isHybrid = workModes.some(function (m) { return /hybryd/i.test(m); });

  return makeJob({
    source: 'pracuj',
    sourceLabel: 'pracuj.pl',
    id: group.groupId || first.partitionId,
    title: group.jobTitle,
    company: group.companyName,
    companyLogo: group.companyLogoUri || null,
    url: first.offerAbsoluteUri || group.companyProfileAbsoluteUri,
    locations: places.length ? places : (first.isWholePoland ? ['Cała Polska'] : []),
    remote: isRemote,
    seniorityRaw: mapLevels(group.positionLevels),
    salary: parseSalary(group.salaryDisplayText),
    contract: (group.typesOfContract || []).join(', ') || null,
    tags: (group.technologies || []).slice(0, 12),
    excerpt: [isHybrid ? 'hybrydowa' : '', group.aboutProjectShortDescription || ''].filter(Boolean).join(' '),
    postedAt: group.lastPublicated ? Date.parse(group.lastPublicated) : null,
    country: 'PL'
  }, params.terms);
}

async function fetchJobs(params) {
  const cfg = (params.config && params.config.browser) || {};
  if (cfg.enabled === false) {
    const err = new Error('Tryb przegladarki wylaczony - ustaw browser.enabled = true w config.json');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const pages = Math.max(1, Math.min(params.pages || 1, 5));
  const jobs = [];
  const seen = new Set();
  let total = 0;

  for (let page = 1; page <= pages; page++) {
    const text = await browser.getText(buildUrl(params, page), '#__NEXT_DATA__', cfg);
    const out = extractOffers(text);
    total = out.total || total;
    if (!out.groups.length) break;

    for (const group of out.groups) {
      const job = toJob(group, params);
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      // W interfejsie pokazujemy oryginalny tekst pracodawcy, nie nasza rekonstrukcje.
      if (group.salaryDisplayText) job.salaryText = group.salaryDisplayText;
      jobs.push(job);
    }
    if (jobs.length >= total) break;
  }

  return { total: total, jobs: jobs };
}

module.exports = {
  key: 'pracuj',
  label: 'pracuj.pl',
  region: 'Polska',
  homepage: 'https://www.pracuj.pl',
  needsBrowser: true,
  fetchJobs: fetchJobs
};
