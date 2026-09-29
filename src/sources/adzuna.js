'use strict';

const { getJson, stripHtml } = require('../http');
const { makeJob } = require('../normalize');

/**
 * Adzuna - agregator polskich portali (zrodlem jest m.in. praca.pl).
 * Wymaga darmowego klucza (https://developer.adzuna.com/) wpisanego w config.json.
 *
 * UWAGA (sprawdzone 06.09.2026 na adzuna.pl): polski indeks Adzuny prawie nie zawiera
 * ofert IT - "azure" zwraca 0 wynikow, "devops" 1, przy 11 811 dla "programista".
 * Dla sciezki Azure to zrodlo nie ma sensu; zostawione dla rol nietechnicznych
 * i innych krajow (pole country w config.json).
 */
async function fetchJobs(params) {
  const cfg = (params.config && params.config.adzuna) || {};
  if (!cfg.enabled || !cfg.app_id || !cfg.app_key) {
    const err = new Error('Adzuna wylaczone - uzupelnij app_id i app_key w config.json');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const pages = Math.max(1, Math.min(params.pages || 2, 5));
  const country = cfg.country || 'pl';
  const out = [];
  let total = 0;

  for (let page = 1; page <= pages; page++) {
    const url = 'https://api.adzuna.com/v1/api/jobs/' + country + '/search/' + page +
      '?app_id=' + encodeURIComponent(cfg.app_id) +
      '&app_key=' + encodeURIComponent(cfg.app_key) +
      '&results_per_page=50&content-type=application/json' +
      (params.query ? '&what=' + encodeURIComponent(params.query) : '');
    const data = await getJson(url, { timeout: 25000 });
    total = data.count || total;
    const rows = data.results || [];
    out.push.apply(out, rows);
    if (rows.length === 0) break;
  }

  return {
    total: total,
    jobs: out.map(function (j) {
      const loc = (j.location && j.location.display_name) || '';
      return makeJob({
        source: 'adzuna',
        sourceLabel: 'Adzuna',
        id: j.id,
        title: j.title,
        company: j.company && j.company.display_name,
        url: j.redirect_url,
        locations: loc ? [loc] : [],
        remote: /remote|zdaln/i.test(loc + ' ' + j.title),
        salary: (j.salary_min || j.salary_max) ? {
          from: j.salary_min,
          to: j.salary_max,
          currency: country === 'pl' ? 'PLN' : 'EUR',
          period: 'annual'
        } : null,
        contract: [j.contract_type, j.contract_time].filter(Boolean).join(', ') || null,
        tags: j.category && j.category.label ? [j.category.label] : [],
        excerpt: stripHtml(j.description).slice(0, 300),
        postedAt: j.created ? Date.parse(j.created) : null,
        country: String(country).toUpperCase()
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'adzuna',
  label: 'Adzuna (slabe pokrycie IT)',
  region: 'Polska - agregator, glownie role nietechniczne',
  homepage: 'https://www.adzuna.pl',
  needsKey: true,
  fetchJobs: fetchJobs
};
