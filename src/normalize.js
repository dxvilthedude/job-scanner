'use strict';

/**
 * Wspolna warstwa normalizacji: kazde zrodlo zwraca ten sam ksztalt oferty,
 * dzieki czemu filtry we frontendzie dzialaja tak samo dla wszystkich portali.
 */

const JUNIOR_MARKERS = [
  'junior', 'jr.', 'jr ', 'mlodszy', 'intern', 'internship', 'staz',
  'stazysta', 'praktyk', 'trainee', 'graduate', 'entry level',
  'entry-level', 'poczatkujacy', 'apprentice', 'associate',
  'assistant', 'asystent', 'no experience', 'bez doswiadczenia',
  'academy', 'akademia', 'bootcamp', 'starter'
];

const SENIOR_MARKERS = [
  'senior', 'sr.', 'sr ', 'lead', 'principal', 'staff engineer', 'architect',
  'architekt', 'head of', 'manager', 'kierownik', 'dyrektor', 'expert', 'ekspert',
  'chief', 'cto'
];

const MID_MARKERS = ['mid', 'regular', 'medior', 'specialist', 'specjalista'];

// Domyslne slowa podbijajace trafnosc (profil Azure), gdy config.json nie ma profili.
// Kazdy profil w config.json podaje wlasne "boostTerms".
const AZURE_TERMS = [
  'azure', 'az-104', 'az-900', 'az-204', 'az-305', 'az-500', 'entra', 'active directory',
  'microsoft 365', 'm365', 'office 365', 'intune', 'aks', 'bicep',
  'azure devops', 'powershell', 'terraform', 'cloud', 'chmur', 'devops', 'sccm',
  'sharepoint', 'exchange online', 'fabric', 'synapse', 'data factory'
];

const REMOTE_TERMS = ['remote', 'zdaln', 'fully remote', '100% remote', 'home office', 'anywhere', 'worldwide'];
const HYBRID_TERMS = ['hybrid', 'hybryd', 'part remote', 'czesciowo zdalnie'];

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Czy w (znormalizowanym) tekscie jest slowo ZACZYNAJACE sie od term.
 * Granica tylko z lewej: "chmur" trafia w "chmurze", ale "unity" nie trafia
 * w "opportunity"/"community", a "aks" w "breaks".
 */
function hasWord(normalizedText, term) {
  const t = norm(term);
  if (!t) return false;
  let i = normalizedText.indexOf(t);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(normalizedText.charAt(i - 1))) return true;
    i = normalizedText.indexOf(t, i + 1);
  }
  return false;
}

function hasAny(haystack, needles) {
  const h = norm(haystack);
  return needles.some(function (n) { return h.includes(norm(n)); });
}

/**
 * Poziom stanowiska. Jesli portal poda go wprost (NoFluffJobs, Himalayas),
 * ufamy portalowi; w przeciwnym razie zgadujemy z tytulu.
 */
function detectSeniority(title, explicit) {
  const t = norm(title);
  const jr = hasAny(t, JUNIOR_MARKERS);
  const sr = hasAny(t, SENIOR_MARKERS);

  // Jednoznaczny tytul bije etykiete portalu. Powod: pracodawcy notorycznie
  // oznaczaja poziom byle jak - na pracuj.pl "Azure Cloud Architect" za 200 zl/h
  // potrafi byc otagowany jako junior, a na LinkedInie odwrotnie.
  if (jr && !sr) return 'junior';
  if (sr && !jr) return 'senior';

  if (Array.isArray(explicit) && explicit.length) {
    const e = explicit.map(norm).join(' ');
    if (/(trainee|junior|intern|entry|graduate)/.test(e)) return 'junior';
    if (/(senior|expert|lead|principal|architect|director|manager|c-level)/.test(e)) return 'senior';
    if (/(mid|regular|medior)/.test(e)) return 'mid';
  }

  // Tytul typu "Junior Cloud Architect" - slowo juniorskie wygrywa.
  if (jr) return 'junior';
  if (sr) return 'senior';
  if (hasAny(t, MID_MARKERS)) return 'mid';
  return 'unknown';
}

/** 'remote' | 'hybrid' | 'onsite' | 'unknown' */
function detectWorkMode(explicitRemote, locations, extraText) {
  const locBlob = Array.isArray(locations) ? locations.join(' ') : String(locations || '');
  if (explicitRemote === true) return 'remote';
  if (hasAny(locBlob, HYBRID_TERMS)) return 'hybrid';
  if (hasAny(locBlob, REMOTE_TERMS)) return 'remote';
  if (hasAny(extraText || '', HYBRID_TERMS)) return 'hybrid';
  // "onsite" tylko wtedy, gdy portal wprost powiedzial, ze oferta nie jest zdalna.
  // Zrodla bez tej informacji (np. karty gosci LinkedIna) zostaja jako "unknown",
  // zeby filtr trybu pracy nie odrzucal ich niesluszne.
  if (explicitRemote === false && locBlob) return 'onsite';
  return 'unknown';
}

// Przelicznik na PLN/miesiac, zeby sortowanie po widelkach mialo sens.
const FX = { PLN: 1, EUR: 4.3, USD: 4.0, GBP: 5.0, CHF: 4.5 };

function monthlyPln(salary) {
  if (!salary || (!salary.from && !salary.to)) return null;
  const rate = FX[String(salary.currency || 'PLN').toUpperCase()] || 1;
  const period = norm(salary.period);
  let factor = 1;
  if (period.includes('year') || period.includes('annual') || period.includes('rok')) factor = 1 / 12;
  else if (period.includes('day') || period.includes('dzien')) factor = 21;
  else if (period.includes('hour') || period.includes('godz')) factor = 168;
  const base = salary.to || salary.from;
  return Math.round(base * rate * factor);
}

function salaryText(salary) {
  if (!salary || (!salary.from && !salary.to)) return null;
  const cur = salary.currency || 'PLN';
  const per = String(salary.period || 'Month');
  const fmt = function (n) { return n == null ? '?' : Number(n).toLocaleString('pl-PL'); };
  const range = salary.from && salary.to
    ? fmt(salary.from) + ' - ' + fmt(salary.to)
    : fmt(salary.from || salary.to);
  const perLabel = /year|annual|rok/i.test(per) ? 'rok'
    : /hour|godz/i.test(per) ? 'godz.'
      : /day|dzien/i.test(per) ? 'dzien' : 'mies.';
  return range + ' ' + cur + '/' + perLabel + (salary.type ? ' · ' + String(salary.type).toUpperCase() : '');
}

/**
 * Trafnosc: tytul wazy najwiecej, potem tagi, na koncu reszta tekstu.
 * boostTerms pochodza z wybranego profilu (Azure, Unity, ...).
 */
function relevance(job, queryTerms, boostTerms) {
  const terms = (queryTerms || []).map(norm).filter(Boolean);
  const title = norm(job.title);
  const tags = norm((job.tags || []).join(' '));
  const rest = norm([job.company, (job.locations || []).join(' '), job.excerpt].join(' '));
  let score = 0;
  for (const t of terms) {
    if (hasWord(title, t)) score += 30;
    if (hasWord(tags, t)) score += 15;
    if (hasWord(rest, t)) score += 5;
  }
  for (const t of (boostTerms || [])) {
    if (hasWord(title, t)) score += 8;
    else if (hasWord(tags, t)) score += 4;
  }
  if (job.seniority === 'junior') score += 12;
  if (job.salary) score += 4;
  if (job.postedAt) {
    const days = (Date.now() - job.postedAt) / 86400000;
    if (days < 3) score += 10;
    else if (days < 7) score += 6;
    else if (days < 14) score += 3;
  }
  return score;
}

/** Jedyne miejsce znajace docelowy ksztalt oferty. */
function makeJob(raw, queryTerms) {
  const locations = (raw.locations || []).filter(Boolean);
  const job = {
    id: raw.source + ':' + raw.id,
    source: raw.source,
    sourceLabel: raw.sourceLabel,
    title: String(raw.title || '').trim(),
    company: String(raw.company || '').trim() || 'Nieznana firma',
    companyLogo: raw.companyLogo || null,
    url: raw.url,
    locations: locations,
    locationText: locations.length
      ? locations.slice(0, 3).join(', ') + (locations.length > 3 ? ' +' + (locations.length - 3) : '')
      : 'brak danych',
    workMode: detectWorkMode(raw.remote, locations, raw.excerpt),
    seniority: detectSeniority(raw.title, raw.seniorityRaw),
    seniorityRaw: raw.seniorityRaw || [],
    salary: raw.salary || null,
    salaryText: salaryText(raw.salary),
    salaryPln: monthlyPln(raw.salary),
    contract: raw.contract || null,
    tags: (raw.tags || []).filter(Boolean).slice(0, 12),
    excerpt: String(raw.excerpt || '').replace(/\s+/g, ' ').slice(0, 260),
    postedAt: raw.postedAt || null,
    country: raw.country || null
  };
  job.relevance = relevance(job, queryTerms);
  job.searchBlob = norm([job.title, job.company, job.tags.join(' '), job.locationText, job.excerpt].join(' '));
  return job;
}

/** Czy tekst zawiera ktorakolwiek z szukanych fraz (uzywane przez zrodla bez wyszukiwarki). */
function matchesTerms(text, terms) {
  if (!terms || !terms.length) return true;
  const blob = norm(text);
  return terms.some(function (t) { return hasWord(blob, t); });
}

module.exports = { matchesTerms, makeJob, relevance, norm, hasWord, hasAny, detectSeniority, detectWorkMode, AZURE_TERMS };
