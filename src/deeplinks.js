'use strict';

/**
 * Gotowe linki wyszukiwania z juz nalozonymi filtrami - jedno klikniecie
 * i portal otwiera sie z wlasciwymi wynikami.
 *
 * Dla justjoin.it, Glassdoora i theProtocol to jedyna droga (blokuja ruch
 * automatyczny). LinkedIn i pracuj.pl sa skanowane w aplikacji, ale zostaja
 * tu jako skrot do pelnej wyszukiwarki portalu.
 */

function enc(s) { return encodeURIComponent(String(s || '')); }

function build(params) {
  const q = String(params.query || '').trim();
  const junior = (params.seniority || []).length === 1 && params.seniority[0] === 'junior';
  const juniorish = (params.seniority || []).includes('junior');
  const remote = params.workMode === 'remote';
  const days = Number(params.days || 0);

  const links = [];

  // --- LinkedIn ---
  var li = 'https://www.linkedin.com/jobs/search/?keywords=' + enc(q) + '&location=' + enc(params.location || 'Polska');
  if (juniorish) li += '&f_E=1%2C2%2C3';           // internship, entry level, associate
  if (remote) li += '&f_WT=2';                      // tylko zdalne
  if (days) li += '&f_TPR=r' + (days * 86400);
  li += '&sortBy=DD';
  links.push({ portal: 'LinkedIn', region: 'Polska / globalnie', url: li, note: 'Skanowany automatycznie - link otwiera pelna wyszukiwarke portalu' });

  // --- pracuj.pl ---
  var pr = 'https://it.pracuj.pl/praca/' + enc(q) + ';kw';
  const prParams = [];
  if (juniorish) prParams.push('et=1%2C3%2C17');    // praktykant/staz, asystent, mlodszy specjalista (junior)
  if (remote) prParams.push('wm=home-office');
  else prParams.push('wm=hybrid%2Chome-office%2Cfull-office');
  if (days) prParams.push('its=' + (days <= 1 ? '1' : days <= 3 ? '3' : days <= 7 ? '7' : '30'));
  if (prParams.length) pr += '?' + prParams.join('&');
  links.push({ portal: 'pracuj.pl (IT)', region: 'Polska', url: pr, note: 'Skanowany automatycznie - link otwiera wyszukiwarke portalu' });

  // --- justjoin.it ---
  var jj = 'https://justjoin.it/job-offers/all-locations?keyword=' + enc(q);
  if (junior) jj += '&experience-level=junior';
  else if (juniorish) jj += '&experience-level=junior%2Cmid';
  if (remote) jj += '&workplace=remote';
  links.push({ portal: 'JustJoin.it', region: 'Polska', url: jj, note: 'Widelki przy kazdej ofercie' });

  // --- theprotocol.it ---
  // Portal filtruje segmentami sciezki: ";t" = technologia, ";p" = poziom, ";rw" = tryb pracy.
  // Wyszukiwanie pelnotekstowe nie dziala w URL, wiec dla frazy jednowyrazowej
  // uzywamy filtra technologii, a dla wielowyrazowej zostawiamy same poziomy.
  const tpSeg = [];
  const singleWord = q.split(/\s+/).length === 1;
  if (singleWord) tpSeg.push(enc(q.toLowerCase()) + ';t');
  if (juniorish) tpSeg.push('trainee,assistant,junior;p');
  if (remote) tpSeg.push('zdalna;rw');
  links.push({
    portal: 'theProtocol.it',
    region: 'Polska',
    url: 'https://theprotocol.it/filtry/' + tpSeg.join('/'),
    note: singleWord ? 'Filtr technologii + poziomu' : 'Fraza wielowyrazowa: filtruje tylko poziom'
  });

  // --- Glassdoor ---
  var gd = 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword=' + enc(q) + '&locT=N&locId=193';
  if (juniorish) gd += '&seniorityType=entrylevel';
  if (remote) gd += '&remoteWorkType=1';
  links.push({ portal: 'Glassdoor', region: 'Polska / globalnie', url: gd, note: 'Oferty + opinie o firmach' });

  // --- Indeed ---
  var ind = 'https://pl.indeed.com/jobs?q=' + enc(q + (juniorish ? ' junior' : ''));
  if (params.location) ind += '&l=' + enc(params.location);
  if (days) ind += '&fromage=' + (days <= 1 ? 1 : days <= 3 ? 3 : days <= 7 ? 7 : 14);
  if (remote) ind += '&sc=0kf%3Aattr(DSQF7)%3B';
  links.push({ portal: 'Indeed PL', region: 'Polska', url: ind, note: 'Agreguje male firmy i helpdesk' });

  // --- Bulldogjob ---
  // Dziala filtr umiejetnosci: /s/skills,Azure (nazwa z wielkiej litery).
  const skill = q.split(/\s+/)[0].replace(/^./, function (c) { return c.toUpperCase(); });
  links.push({
    portal: 'Bulldogjob',
    region: 'Polska',
    url: 'https://bulldogjob.pl/companies/jobs/s/skills,' + enc(skill),
    note: 'Mniejszy portal = mniejsza konkurencja'
  });

  // --- RocketJobs ---
  links.push({
    portal: 'RocketJobs.pl',
    region: 'Polska',
    url: 'https://rocketjobs.pl/oferty-pracy/wszystkie-lokalizacje?keyword=' + enc(q) + (juniorish ? '&experience-level=junior' : ''),
    note: 'Role okoloIT i wsparcie - dobre wejscie dla juniora'
  });

  // --- Solid.jobs ---
  // Portal renderuje wyniki dopiero po zaakceptowaniu cookies, wiec frazy nie da sie
  // przekazac w linku - otwieramy liste IT i szukamy juz na miejscu.
  links.push({
    portal: 'Solid.jobs',
    region: 'Polska',
    url: 'https://solid.jobs/offers/it',
    note: 'Zawsze podane widelki; fraze wpisz w wyszukiwarce portalu'
  });

  // --- Talent Days (dawniej absolvent.pl) ---
  links.push({
    portal: 'Talent Days',
    region: 'Polska',
    url: 'https://talentdays.pl/oferty-pracy-i-stazy',
    note: 'Staze i oferty dla absolwentow - najlatwiejsze wejscie bez doswiadczenia'
  });

  // --- praca.pl ---
  links.push({
    portal: 'Praca.pl',
    region: 'Polska',
    url: 'https://www.praca.pl/s-' + enc(q.replace(/\s+/g, '-')) + '.html' + (remote ? '?rt=zdalna' : ''),
    note: 'Duzo ofert 1st line support / admin'
  });

  // --- Portale branzowe z profilu (config.json -> profiles[].extraLinks) ---
  // Ida na poczatek listy, bo dla danej sciezki (Azure, gamedev...) sa najtrafniejsze.
  // "{q}" w adresie zamieniamy na fraze, "juniorParam" doklejamy przy filtrze juniora.
  const extra = ((params.profile && params.profile.extraLinks) || []).map(function (l) {
    return {
      portal: l.portal,
      region: l.region || '',
      url: String(l.url).replace(/\{q\}/g, enc(q)) + (juniorish && l.juniorParam ? l.juniorParam : ''),
      note: l.note || ''
    };
  });

  return extra.concat(links);
}

module.exports = { build: build };
