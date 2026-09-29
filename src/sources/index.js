'use strict';

const sources = [
  require('./nofluffjobs'),
  require('./pracuj'),
  require('./linkedin'),
  require('./adzuna'),
  require('./remotive'),
  require('./himalayas'),
  require('./jobicy'),
  require('./arbeitnow')
];

const byKey = {};
for (const s of sources) byKey[s.key] = s;

module.exports = { sources: sources, byKey: byKey };
