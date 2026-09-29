'use strict';

const { getJson, stripHtml } = require('../http');
const { makeJob, norm, hasWord } = require('../normalize');

/**
 * Himalayas - zdalne oferty z jawnym poziomem stanowiska i widelkami.
 * API nie ma wyszukiwarki pelnotekstowej, wiec pobieramy kilka stron
 * (kursorem) i filtrujemy fraze lokalnie.
 */
async function fetchJobs(params) {
  const pages = Math.max(1, Math.min(params.pages || 2, 6));
  const terms = (params.terms && params.terms.length ? params.terms : []).map(norm);
  const collected = [];
  let cursor = null;
  let total = 0;

  for (let i = 0; i < pages; i++) {
    const url = 'https://himalayas.app/jobs/api?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const data = await getJson(url, { timeout: 25000 });
    total = data.totalCount || total;
    const jobs = data.jobs || [];
    collected.push.apply(collected, jobs);
    cursor = data.nextCursor;
    if (!cursor || jobs.length === 0) break;
  }

  const matches = collected.filter(function (j) {
    if (!terms.length) return true;
    const blob = norm([j.title, j.excerpt, (j.categories || []).join(' '), j.companyName].join(' '));
    return terms.some(function (t) { return hasWord(blob, t); });
  });

  return {
    total: matches.length,
    scanned: collected.length,
    jobs: matches.map(function (j) {
      return makeJob({
        source: 'himalayas',
        sourceLabel: 'Himalayas',
        id: j.guid || j.applicationLink,
        title: j.title,
        company: j.companyName,
        companyLogo: j.companyLogo || null,
        url: j.applicationLink || j.guid,
        locations: (j.locationRestrictions && j.locationRestrictions.length)
          ? j.locationRestrictions : ['Remote'],
        remote: true,
        seniorityRaw: j.seniority || [],
        salary: (j.minSalary || j.maxSalary) ? {
          from: j.minSalary,
          to: j.maxSalary,
          currency: j.currency || 'USD',
          period: j.salaryPeriod || 'annual'
        } : null,
        contract: j.employmentType || null,
        tags: (j.parentCategories || []).concat((j.categories || []).slice(0, 4)),
        excerpt: stripHtml(j.excerpt || j.description).slice(0, 300),
        postedAt: j.pubDate ? j.pubDate * 1000 : null,
        country: null
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'himalayas',
  label: 'Himalayas',
  region: 'Zdalne / globalne',
  homepage: 'https://himalayas.app',
  fetchJobs: fetchJobs
};
