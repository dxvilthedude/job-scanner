'use strict';

const { getJson } = require('../http');
const { makeJob } = require('../normalize');

/**
 * NoFluffJobs - najlepsze zrodlo dla polskiego rynku IT.
 * Publiczne API wyszukiwarki przyjmuje skladnie kryteriow w polu rawSearch,
 * np. "azure seniority=junior,trainee city=warszawa".
 */
const SENIORITY_MAP = {
  junior: ['trainee', 'junior'],
  mid: ['mid'],
  senior: ['senior', 'expert']
};

function buildRawSearch(query, seniority) {
  const parts = [];
  if (query) parts.push(query.trim());
  if (Array.isArray(seniority) && seniority.length) {
    const levels = [];
    for (const s of seniority) {
      if (SENIORITY_MAP[s]) levels.push.apply(levels, SENIORITY_MAP[s]);
    }
    // "unknown" nie ma odpowiednika w NFJ - pomijamy, filtr i tak dziala lokalnie.
    if (levels.length && !seniority.includes('unknown')) {
      parts.push('seniority=' + Array.from(new Set(levels)).join(','));
    }
  }
  return parts.join(' ');
}

async function fetchJobs(params) {
  const pages = Math.max(1, Math.min(params.pages || 1, 5));
  const all = [];
  let total = 0;

  for (let page = 1; page <= pages; page++) {
    const url = 'https://nofluffjobs.com/api/search/posting?page=' + page +
      '&salaryCurrency=PLN&salaryPeriod=month&region=pl&language=pl-PL';
    const data = await getJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://nofluffjobs.com',
        'Referer': 'https://nofluffjobs.com/'
      },
      body: JSON.stringify({ rawSearch: buildRawSearch(params.query, params.seniority) }),
      timeout: 25000
    });
    total = data.totalCount || total;
    const postings = data.postings || [];
    all.push.apply(all, postings);
    if (postings.length === 0 || all.length >= total) break;
  }

  return {
    total: total,
    jobs: all.map(function (p) {
      const places = (p.location && p.location.places) || [];
      const cities = places
        .filter(function (pl) { return pl.city && !pl.provinceOnly; })
        .map(function (pl) { return pl.city; });
      const isRemote = p.fullyRemote === true ||
        cities.some(function (c) { return /remote|zdaln/i.test(c); });
      const tags = ((p.tiles && p.tiles.values) || [])
        .filter(function (t) { return t.type === 'requirement'; })
        .map(function (t) { return t.value; });
      if (p.technology && tags.indexOf(p.technology) === -1) tags.unshift(p.technology);

      return makeJob({
        source: 'nofluffjobs',
        sourceLabel: 'NoFluffJobs',
        id: p.id,
        title: p.title,
        company: p.name,
        companyLogo: p.logo && p.logo.jobs_listing
          ? 'https://static.nofluffjobs.com/' + p.logo.jobs_listing
          : null,
        url: 'https://nofluffjobs.com/pl/job/' + p.url,
        locations: Array.from(new Set(cities)),
        remote: isRemote,
        seniorityRaw: p.seniority || [],
        salary: p.salary && (p.salary.from || p.salary.to) ? {
          from: p.salary.from,
          to: p.salary.to,
          currency: p.salary.currency,
          period: p.salary.period,
          type: p.salary.type
        } : null,
        contract: p.salary && p.salary.type ? p.salary.type : null,
        tags: tags,
        excerpt: p.category ? 'Kategoria: ' + p.category : '',
        postedAt: p.renewed || p.posted || null,
        country: 'PL'
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'nofluffjobs',
  label: 'NoFluffJobs',
  region: 'Polska',
  homepage: 'https://nofluffjobs.com',
  fetchJobs: fetchJobs
};
