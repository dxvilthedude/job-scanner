'use strict';

const { getJson, stripHtml } = require('../http');
const { makeJob, matchesTerms } = require('../normalize');

/** Jobicy - zdalne oferty, filtr po tagu (slowo kluczowe) i regionie. */
async function fetchJobs(params) {
  const url = 'https://jobicy.com/api/v2/remote-jobs?count=50' +
    (params.query ? '&tag=' + encodeURIComponent(params.query) : '');
  const data = await getJson(url, { timeout: 25000 });
  // Parametr tag bywa ignorowany przez API - filtrujemy fraze lokalnie.
  const jobs = (data.jobs || []).filter(function (x) {
    return matchesTerms([x.jobTitle, (x.jobIndustry || []).join(' '), stripHtml(x.jobExcerpt || x.jobDescription).slice(0, 1500)].join(' '), params.terms);
  });
  return {
    total: data.jobCount || jobs.length,
    jobs: jobs.map(function (j) {
      return makeJob({
        source: 'jobicy',
        sourceLabel: 'Jobicy',
        id: j.id,
        title: j.jobTitle,
        company: j.companyName,
        companyLogo: j.companyLogo || null,
        url: j.url,
        locations: [j.jobGeo || 'Remote'],
        remote: true,
        seniorityRaw: j.jobLevel ? [j.jobLevel] : [],
        salary: (j.annualSalaryMin || j.annualSalaryMax) ? {
          from: j.annualSalaryMin,
          to: j.annualSalaryMax,
          currency: j.salaryCurrency || 'USD',
          period: 'annual'
        } : null,
        contract: (j.jobType || []).join(', ') || null,
        tags: (j.jobIndustry || []).concat(j.jobType || []),
        excerpt: stripHtml(j.jobExcerpt || j.jobDescription).slice(0, 300),
        postedAt: j.pubDate ? Date.parse(j.pubDate) : null,
        country: null
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'jobicy',
  label: 'Jobicy',
  region: 'Zdalne / globalne',
  homepage: 'https://jobicy.com',
  fetchJobs: fetchJobs
};
