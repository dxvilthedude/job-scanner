'use strict';

const { getJson, stripHtml } = require('../http');
const { makeJob, matchesTerms } = require('../normalize');

/** Remotive - oferty w 100% zdalne, glownie EN/globalne. Publiczne API z parametrem search. */
async function fetchJobs(params) {
  const url = 'https://remotive.com/api/remote-jobs?limit=200' +
    (params.query ? '&search=' + encodeURIComponent(params.query) : '');
  const data = await getJson(url, { timeout: 25000 });
  // Wyszukiwarka Remotive dopasowuje bardzo luzno - odsiewamy oferty
  // bez naszej frazy w tytule, tagach lub opisie.
  const jobs = (data.jobs || []).filter(function (j) {
    return matchesTerms([j.title, (j.tags || []).join(' '), stripHtml(j.description).slice(0, 1500)].join(' '), params.terms);
  });
  return {
    total: data['total-job-count'] || jobs.length,
    jobs: jobs.map(function (j) {
      return makeJob({
        source: 'remotive',
        sourceLabel: 'Remotive',
        id: j.id,
        title: j.title,
        company: j.company_name,
        companyLogo: j.company_logo_url || j.company_logo || null,
        url: j.url,
        locations: [j.candidate_required_location || 'Remote'],
        remote: true,
        salary: null,
        contract: j.job_type ? String(j.job_type).replace(/_/g, ' ') : null,
        tags: j.tags || [],
        excerpt: stripHtml(j.description).slice(0, 300),
        postedAt: j.publication_date ? Date.parse(j.publication_date) : null,
        country: null
      }, params.terms);
    })
  };
}

module.exports = {
  key: 'remotive',
  label: 'Remotive',
  region: 'Zdalne / globalne',
  homepage: 'https://remotive.com',
  fetchJobs: fetchJobs
};
