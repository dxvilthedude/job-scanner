'use strict';

/* =========================================================================
   Job Scanner - warstwa przegladarki.
   Serwer zwraca surowa liste ofert; wszystkie filtry ponizej dzialaja
   lokalnie, wiec przelaczanie ich jest natychmiastowe i nie meczy portali.
   ========================================================================= */

const $ = function (sel) { return document.querySelector(sel); };
const store = {
  get: function (k, fallback) {
    try { const v = localStorage.getItem('ajs.' + k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set: function (k, v) {
    try { localStorage.setItem('ajs.' + k, JSON.stringify(v)); } catch (e) { /* tryb prywatny */ }
  }
};

let JOBS = [];                                  // ostatni wynik skanu
let SOURCES = [];                               // metadane zrodel
let PROFILES = [];                              // sciezki kariery z config.json (Azure, Unity...)
let profile = null;                             // aktywny profil
let saved = new Set(store.get('saved', []));
let hidden = new Set(store.get('hidden', []));
let seen = new Set(store.get('seen', []));      // wszystko, co juz widzielismy
let seenSnapshot = new Set(seen);               // stan sprzed biezacego skanu -> znacznik NOWE

/* ------------------------- odczyt stanu filtrow ------------------------- */

function checkedValues(container) {
  return Array.from(container.querySelectorAll('input:checked')).map(function (i) { return i.value; });
}

function readFilters() {
  return {
    query: $('#query').value.trim(),
    pages: $('#pages').value,
    sources: checkedValues($('#sourceList')),
    seniority: checkedValues($('#seniorityChips')),
    juniorFriendly: $('#juniorFriendly').checked,
    workMode: (document.querySelector('input[name="wm"]:checked') || {}).value || '',
    location: $('#location').value.trim().toLowerCase(),
    salaryOnly: $('#salaryOnly').checked,
    salaryMin: Number($('#salaryMin').value),
    days: Number($('#days').value),
    mustHave: $('#mustHave').value.toLowerCase().split(/[\s,]+/).filter(Boolean),
    exclude: $('#exclude').value.toLowerCase().split(/[\s,]+/).filter(Boolean),
    topicInTitle: $('#topicInTitle').checked,
    view: (document.querySelector('input[name="vm"]:checked') || {}).value || 'all',
    sortBy: $('#sortBy').value
  };
}

const SENIOR_WORDS = ['senior', 'lead', 'principal', 'architect', 'architekt', 'head of', 'manager', 'kierownik', 'expert', 'ekspert', 'staff'];
function norm(s) {
  return String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Slowo zaczynajace sie od w (jak hasWord na serwerze): "vr" nie trafi w "server". */
function hasWord(text, w) {
  let i = text.indexOf(w);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(text.charAt(i - 1))) return true;
    i = text.indexOf(w, i + 1);
  }
  return false;
}

/** Slowa dla filtra "musi byc w tytule": z profilu, a gdy profil ich nie ma - z wpisanej frazy. */
function titleWords(query) {
  if (profile && profile.titleWords && profile.titleWords.length) return profile.titleWords.map(norm);
  return norm(query).split(/[\s,]+/).filter(function (w) { return w.length > 1; });
}

/* ------------------------------ filtrowanie ----------------------------- */

function applyFilters() {
  const f = readFilters();
  const now = Date.now();
  const topicWords = titleWords(f.query);

  let out = JOBS.filter(function (job) {
    if (f.view === 'hidden') return hidden.has(job.id);
    if (hidden.has(job.id)) return false;
    if (f.view === 'saved' && !saved.has(job.id)) return false;
    if (f.view === 'new' && seenSnapshot.has(job.id)) return false;

    if (f.sources.length && f.sources.indexOf(job.source) === -1) return false;
    if (f.seniority.length && f.seniority.indexOf(job.seniority) === -1) return false;

    if (f.juniorFriendly) {
      const t = norm(job.title);
      if (SENIOR_WORDS.some(function (w) { return t.includes(w); })) return false;
    }

    if (f.workMode === 'remote' && job.workMode !== 'remote') return false;
    if (f.workMode === 'remote_hybrid' && job.workMode !== 'remote' && job.workMode !== 'hybrid') return false;
    if (f.workMode === 'onsite' && job.workMode === 'remote') return false;

    if (f.location) {
      const loc = norm(job.locations.join(' ') + ' ' + (job.country || ''));
      if (!loc.includes(norm(f.location))) return false;
    }

    if (f.salaryOnly && !job.salary) return false;
    if (f.salaryMin > 0 && (!job.salaryPln || job.salaryPln < f.salaryMin)) return false;

    if (f.days > 0) {
      if (!job.postedAt) return false;
      if (now - job.postedAt > f.days * 86400000) return false;
    }

    if (f.topicInTitle && topicWords.length) {
      const t = norm(job.title);
      if (!topicWords.some(function (w) { return hasWord(t, w); })) return false;
    }

    if (f.mustHave.length) {
      const blob = job.searchBlob || norm(job.title + ' ' + job.tags.join(' '));
      if (!f.mustHave.every(function (w) { return blob.includes(norm(w)); })) return false;
    }
    if (f.exclude.length) {
      const blob = job.searchBlob || norm(job.title + ' ' + job.tags.join(' '));
      if (f.exclude.some(function (w) { return blob.includes(norm(w)); })) return false;
    }
    return true;
  });

  out.sort(function (a, b) {
    if (f.sortBy === 'date') return (b.postedAt || 0) - (a.postedAt || 0);
    if (f.sortBy === 'salary') return (b.salaryPln || -1) - (a.salaryPln || -1);
    if (f.sortBy === 'company') return a.company.localeCompare(b.company, 'pl');
    return b.relevance - a.relevance;
  });

  render(out);
  saveFilterState(f);
  refreshDeepLinks(f);
}

/* ------------------------------- render --------------------------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function timeAgo(ts) {
  if (!ts) return 'brak daty';
  const h = Math.floor((Date.now() - ts) / 3600000);
  if (h < 1) return 'przed chwilą';
  if (h < 24) return h + ' godz. temu';
  const d = Math.floor(h / 24);
  if (d === 1) return 'wczoraj';
  if (d < 31) return d + ' dni temu';
  return Math.floor(d / 30) + ' mies. temu';
}

const MODE_LABEL = { remote: 'zdalna', hybrid: 'hybrydowa', onsite: 'stacjonarna', unknown: 'tryb ?' };
const SEN_LABEL = { junior: 'junior', mid: 'mid', senior: 'senior', unknown: 'poziom ?' };

function jobCard(job) {
  const isNew = !seenSnapshot.has(job.id);
  const isSaved = saved.has(job.id);
  const logo = job.companyLogo
    ? '<img class="logo" src="' + esc(job.companyLogo) + '" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'logo-fallback\',textContent:\'' + esc(job.company.charAt(0).toUpperCase()) + '\'}))">'
    : '<div class="logo-fallback">' + esc(job.company.charAt(0).toUpperCase()) + '</div>';

  const badges = [];
  if (isNew) badges.push('<span class="badge new">NOWE</span>');
  badges.push('<span class="badge ' + (job.seniority === 'junior' ? 'junior' : job.seniority === 'senior' ? 'senior' : '') + '">' + SEN_LABEL[job.seniority] + '</span>');
  badges.push('<span class="badge ' + (job.workMode === 'remote' ? 'remote' : job.workMode === 'hybrid' ? 'hybrid' : '') + '">' + MODE_LABEL[job.workMode] + '</span>');
  badges.push('<span class="badge">' + esc(job.locationText) + '</span>');
  if (job.salaryText) badges.push('<span class="badge salary">' + esc(job.salaryText) + '</span>');
  if (job.contract) badges.push('<span class="badge">' + esc(job.contract) + '</span>');
  badges.push('<span class="badge src">' + esc(job.sourceLabel) + '</span>');

  const tags = job.tags.slice(0, 8).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
  const also = (job.alsoOn && job.alsoOn.length)
    ? '<div class="also-on">Także na: ' + job.alsoOn.map(function (a) { return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.label) + '</a>'; }).join(', ') + '</div>'
    : '';

  return '<article class="job' + (isNew ? ' is-new' : '') + (isSaved ? ' is-saved' : '') + '" data-id="' + esc(job.id) + '">' +
    logo +
    '<div class="job-main">' +
      '<h3 class="job-title"><a href="' + esc(job.url) + '" target="_blank" rel="noopener">' + esc(job.title) + '</a></h3>' +
      '<div class="job-company">' + esc(job.company) + '</div>' +
      '<div class="job-meta">' + badges.join('') + '</div>' +
      '<div class="job-tags">' + tags + '</div>' + also +
    '</div>' +
    '<div class="job-side">' +
      '<span class="job-date">' + timeAgo(job.postedAt) + '</span>' +
      '<button class="icon-btn' + (isSaved ? ' active' : '') + '" data-act="save" title="Zapisz ofertę">&#9733;</button>' +
      '<button class="icon-btn" data-act="hide" title="' + (hidden.has(job.id) ? 'Przywróć' : 'Ukryj ofertę') + '">' + (hidden.has(job.id) ? '&#8630;' : '&#10005;') + '</button>' +
    '</div>' +
  '</article>';
}

function render(list) {
  $('#resultCount').textContent = list.length;
  $('#resultTotal').textContent = JOBS.length ? '(pobrano ' + JOBS.length + ' unikalnych ofert)' : '';
  $('#jobList').innerHTML = list.length
    ? list.map(jobCard).join('')
    : '<div class="empty">Brak ofert dla tych filtrów. Poluzuj kryteria albo zwiększ głębokość skanu.</div>';
  window.__visible = list;
}

/* --------------------------------- skan --------------------------------- */

async function scan(fresh) {
  const f = readFilters();
  if (!f.query) {
    $('#statusStrip').innerHTML = '<span class="src-status"><span class="dot skipped"></span>Wpisz frazę, np. stanowisko albo technologię.</span>';
    $('#query').focus();
    return;
  }
  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Skanuję...';
  $('#statusStrip').innerHTML = '';

  try {
    const params = new URLSearchParams({ q: f.query, pages: f.pages, profile: profile.key });
    if (f.sources.length && f.sources.length < SOURCES.length) params.set('sources', f.sources.join(','));
    // Poziom przekazujemy do NoFluffJobs, zeby portal zawezil wyniki po swojej stronie -
    // bez tego oferty juniorskie gina pod setkami ofert senior w pierwszych stronach wynikow.
    const sen = f.seniority.filter(function (s) { return s !== 'unknown'; });
    if (sen.length && sen.length < 3) params.set('seniority', sen.join(','));
    // LinkedIn potrafi zawezic tryb pracy po swojej stronie - karty gosci
    // nie mowia wprost, czy oferta jest zdalna, wiec bez tego byloby to nie do wykrycia.
    if (f.workMode === 'remote') params.set('workMode', 'remote');
    if (fresh) params.set('fresh', '1');

    const res = await fetch('/api/scan?' + params.toString());
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    JOBS = data.jobs;
    seenSnapshot = new Set(seen);
    JOBS.forEach(function (j) { seen.add(j.id); });
    store.set('seen', Array.from(seen).slice(-4000));
    renderStatus(data);
    applyFilters();
    store.set('lastScan', Date.now());
  } catch (err) {
    $('#statusStrip').innerHTML = '<span class="src-status"><span class="dot error"></span>Błąd skanu: ' + esc(err.message) + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Skanuj';
  }
}

function renderStatus(data) {
  const strip = data.sources.map(function (s) {
    const label = s.status === 'ok' ? s.count + ' ofert'
      : s.status === 'cache' ? s.count + ' ofert (cache)'
        : s.status === 'skipped' ? 'pominięte'
          : 'błąd';
    const note = s.error || s.warning;
    const title = note ? ' title="' + esc(note) + '"' : '';
    // Zrodlo, ktore oddalo tylko czesc wynikow, oznaczamy na bursztynowo.
    const dot = s.warning && s.status === 'ok' ? 'skipped' : s.status;
    return '<span class="src-status"' + title + '><span class="dot ' + dot + '"></span>' +
      esc(s.label) + ' — ' + label + (s.ms ? ' <span class="muted">' + (s.ms / 1000).toFixed(1) + 's</span>' : '') + '</span>';
  }).join('');
  $('#statusStrip').innerHTML = strip +
    '<span class="src-status"><span class="dot cache"></span>razem ' + data.jobs.length + ' unikalnych · ' + (data.ms / 1000).toFixed(1) + 's</span>';
}

/* ------------------------------ deep linki ------------------------------ */

async function refreshDeepLinks(f) {
  const params = new URLSearchParams({
    profile: profile ? profile.key : '',
    q: f.query,
    seniority: f.seniority.join(','),
    workMode: f.workMode === 'remote' ? 'remote' : '',
    location: $('#location').value.trim(),
    days: String(f.days || 0)
  });
  const res = await fetch('/api/deeplinks?' + params.toString());
  const data = await res.json();
  $('#linkGrid').innerHTML = data.links.map(function (l) {
    return '<a class="link-card" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
      '<span class="region">' + esc(l.region) + '</span>' +
      '<b>' + esc(l.portal) + '</b>' +
      '<small>' + esc(l.note) + '</small></a>';
  }).join('');
}

/* ------------------------------- eksport -------------------------------- */

function exportCsv() {
  const rows = (window.__visible || []);
  if (!rows.length) return;
  const head = ['Stanowisko', 'Firma', 'Poziom', 'Tryb', 'Lokalizacja', 'Wynagrodzenie', 'Portal', 'Opublikowano', 'Link'];
  const body = rows.map(function (j) {
    return [
      j.title, j.company, j.seniority, j.workMode, j.locationText,
      j.salaryText || '', j.sourceLabel,
      j.postedAt ? new Date(j.postedAt).toISOString().slice(0, 10) : '',
      j.url
    ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
  });
  const csv = '﻿' + [head.join(';')].concat(body).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'oferty-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------- stan i zdarzenia --------------------------- */

const FILTER_IDS = ['query', 'pages', 'location', 'salaryOnly', 'salaryMin', 'days', 'mustHave', 'exclude', 'topicInTitle', 'juniorFriendly', 'sortBy'];

function saveFilterState(f) {
  const state = {};
  FILTER_IDS.forEach(function (id) {
    const el = $('#' + id);
    state[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  state.seniority = f.seniority;
  state.sources = f.sources;
  state.workMode = f.workMode;
  store.set('filters', state);
}

function restoreFilterState() {
  const s = store.get('filters', null);
  if (!s) return;
  FILTER_IDS.forEach(function (id) {
    const el = $('#' + id);
    if (!el || s[id] === undefined) return;
    if (el.type === 'checkbox') el.checked = s[id]; else el.value = s[id];
  });
  if (s.seniority) {
    $('#seniorityChips').querySelectorAll('input').forEach(function (i) { i.checked = s.seniority.indexOf(i.value) !== -1; });
  }
  if (s.workMode !== undefined) {
    const r = document.querySelector('input[name="wm"][value="' + s.workMode + '"]');
    if (r) r.checked = true;
  }
  $('#salaryMinLabel').textContent = Number($('#salaryMin').value).toLocaleString('pl-PL');
  return s;
}

/* -------------------------------- profile ------------------------------- */

/** Ustawia presety, podpisy i placeholder pod wybrana sciezke kariery. */
function applyProfile(p) {
  profile = p;
  $('#profile').value = p.key;
  $('#brandSub').textContent = p.subtitle || p.label;
  $('#query').placeholder = p.placeholder || 'wpisz stanowisko lub technologię';
  $('#topicInTitleLabel').textContent = p.titleFilterLabel || 'Szukana fraza musi być w tytule';
  $('#presets').innerHTML = (p.presets || []).map(function (preset, i) {
    return '<button type="button" class="preset" data-i="' + i + '">' + esc(preset.label) + '</button>';
  }).join('');
  store.set('profile', p.key);
}

/** Przelaczenie profilu: kazdy pamieta swoja ostatnia fraze. */
function switchProfile(key) {
  const next = PROFILES.find(function (p) { return p.key === key; });
  if (!next || next === profile) return;
  if (profile) store.set('query.' + profile.key, $('#query').value.trim());
  applyProfile(next);
  $('#query').value = store.get('query.' + next.key, null) || next.defaultQuery || '';
  JOBS = [];
  applyFilters();
  scan(false);
}

async function init() {
  const res = await fetch('/api/sources');
  const meta = await res.json();
  SOURCES = meta.scannable;

  $('#sourceList').innerHTML = SOURCES.map(function (s) {
    return '<label class="source-item' + (s.ready ? '' : ' disabled') + '">' +
      '<input type="checkbox" value="' + esc(s.key) + '"' + (s.ready ? ' checked' : '') + '>' +
      '<span>' + esc(s.label) + '<small>' + esc(s.region) + (s.ready ? '' : ' · wymaga klucza w config.json') + '</small></span></label>';
  }).join('');

  PROFILES = meta.profiles || [];
  $('#profile').innerHTML = PROFILES.map(function (p) {
    return '<option value="' + esc(p.key) + '">' + esc(p.label) + '</option>';
  }).join('');
  const savedKey = store.get('profile', null);
  applyProfile(PROFILES.find(function (p) { return p.key === savedKey; })
    || PROFILES.find(function (p) { return p.key === meta.defaultProfile; })
    || PROFILES[0]);
  $('#profile').addEventListener('change', function () { switchProfile(this.value); });

  $('#presets').addEventListener('click', function (e) {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    const p = profile.presets[Number(btn.dataset.i)];
    $('#query').value = p.q;
    if (p.seniority) {
      $('#seniorityChips').querySelectorAll('input').forEach(function (i) {
        i.checked = p.seniority.indexOf(i.value) !== -1 || i.value === 'unknown';
      });
    }
    scan(false);
  });

  const restored = restoreFilterState();
  if (restored && restored.sources) {
    $('#sourceList').querySelectorAll('input').forEach(function (i) { i.checked = restored.sources.indexOf(i.value) !== -1; });
  }
  if (!$('#query').value) $('#query').value = profile.defaultQuery || '';

  // zdarzenia
  $('#searchForm').addEventListener('submit', function (e) { e.preventDefault(); scan(false); });
  $('#freshBtn').addEventListener('click', function () { scan(true); });
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#salaryMin').addEventListener('input', function () {
    $('#salaryMinLabel').textContent = Number(this.value).toLocaleString('pl-PL');
  });
  $('#resetFilters').addEventListener('click', function () {
    store.set('filters', null);
    location.reload();
  });

  // Poziom stanowiska i lista zrodel wchodza do zapytania wysylanego do portali,
  // wiec ich zmiana wymaga ponownego skanu (cache sprawia, ze jest tani).
  // Pozostale filtry dzialaja wylacznie lokalnie.
  const rescan = debounce(function () { scan(false); }, 500);
  $('#filters').addEventListener('change', function (e) {
    applyFilters();
    if (e.target.closest('#sourceList') || e.target.closest('#seniorityChips') || e.target.closest('#workMode')) rescan();
  });
  ['location', 'mustHave', 'exclude'].forEach(function (id) {
    $('#' + id).addEventListener('input', debounce(applyFilters, 220));
  });
  $('#sortBy').addEventListener('change', applyFilters);
  $('#salaryMin').addEventListener('change', applyFilters);

  $('#jobList').addEventListener('click', function (e) {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    const id = e.target.closest('.job').dataset.id;
    if (btn.dataset.act === 'save') {
      if (saved.has(id)) saved.delete(id); else saved.add(id);
      store.set('saved', Array.from(saved));
    } else {
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      store.set('hidden', Array.from(hidden));
    }
    applyFilters();
  });

  await refreshDeepLinks(readFilters());
  scan(false);
}

function debounce(fn, ms) {
  let t;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}

init();
