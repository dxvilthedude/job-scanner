'use strict';

const { getJson, stripHtml } = require('../http');
const { makeJob, norm, hasWord } = require('../normalize');

/**
 * Arbeitnow - oferty z Europy (duzo DE + zdalne, sporo firm rekrutujacych w PL).
 * Feed nie ma wyszukiwarki, wiec przechodzimy kilka stron i filtrujemy lokalnie.
 */
async function fetchJobs(params) {
  const pages = Math.max(1, Math.min(params.pages || 3, 8));
  const terms = (params.terms && params.terms.length ? params.terms : []).map(norm);
  const collected = [];

  for (let page = 1; page <= pages; page++) {
    const data = await getJson('https://www.arbeitnow.com/api/job-board-api?page=' + page, { timeout: 25000 });
    const rows = data.data || [];
    collected.push.apply(collected, rows);
    if (rows.length === 0) break;
  }

  const matches = collected.filter(function (j) {
    if (!terms.length) return true;
    const blob = norm([j.title, j.tags && j.tags.join(' '), j.company_name, stripHtml(j.description).slice(0, 1200)].join(' '));
    return terms.some(function (t) { return hasWord(blob, t); });
  });

  return {
    total: matches.length,
    scanned: collected.length,
    jobs: matches.map(function (j) {
      return makeJob({
        source: 'arbeitnow',
        sourceLabel: 'Arbeitnow',
        id: j.slug,
        title: j.title,
        company: j.company_name,
        url: j.url,
        locations: [j.location || (j.remote ? 'Remote' : '')].filter(Boolean),
        remote: !!j.remote,
        salary: null,
        contract: (j.job_types || []).join(', ') || null,
        tags: j.tags || [],
        excerpt: stripHtml(j.description).slice(0, 300),
        postedAt: j.created_at ? j.created_at * 1000 : null,
        country: null
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'arbeitnow',
  label: 'Arbeitnow',
  region: 'Europa / zdalne',
  homepage: 'https://www.arbeitnow.com',
  fetchJobs: fetchJobs
};
