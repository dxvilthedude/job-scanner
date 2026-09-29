# Azure Job Scanner

Lokalna aplikacja do skanowania ofert pracy z wielu portali naraz, przygotowana pod ścieżkę
**junior Azure developer / administrator / cloud support**. Zero zależności npm — wystarczy Node 18+.

## Uruchomienie

```bash
node server.js
```

Potem otwórz **http://localhost:4321** (albo kliknij dwukrotnie `start.bat`).

## Profile: Azure, Unity / GameDev albo dowolna fraza

Lista w nagłówku przełącza **ścieżkę kariery**. Każdy profil ma własne presety zapytań, słowa
podbijające trafność, słowa filtra „musi być w tytule” i dodatkowe portale branżowe w sekcji
linków (dla Unity: Hitmarker, GameJobs.co, Games Jobs Direct, Work With Indies, JustJoin.it
kategoria Game, NoFluffJobs Gamedev, Unity Careers). Każdy profil pamięta swoją ostatnią frazę.

Profil **Dowolna fraza** nie ma presetów ani podbić — filtr tytułu używa wtedy słów z wpisanej frazy.

Nowy profil (np. Python, QA, Data) = kolejny wpis w `config.json` → `profiles`:

```json
{
  "key": "python", "label": "Python", "defaultQuery": "python",
  "presets": [{ "label": "Python Junior", "q": "python", "seniority": ["junior"] }],
  "boostTerms": ["python", "django", "fastapi", "pandas"],
  "titleWords": ["python"],
  "extraLinks": [{ "portal": "Python.org Jobs", "url": "https://www.python.org/jobs/", "note": "" }]
}
```

`{q}` w `extraLinks[].url` zamienia się na wpisaną frazę. Źródła bez własnej wyszukiwarki
(Remotive, Himalayas, Jobicy, Arbeitnow) filtrują po słowach frazy **z pominięciem ogólników**
(developer, engineer, junior, administrator…) — „unity developer” szuka po „unity”, a nie po
każdej ofercie z „developer” w treści.

## Co jest skanowane automatycznie

| Źródło | Zasięg | Co daje |
|---|---|---|
| **NoFluffJobs** | Polska | Najlepsze źródło dla PL: jawny poziom stanowiska, widełki, wymagania, praca zdalna |
| **pracuj.pl** *(tryb przeglądarki)* | Polska | Największy polski portal: widełki, technologie, poziom, tryb pracy. Wymaga `puppeteer-core` |
| **LinkedIn** | Polska (konfigurowalne) | Największy wolumen; karty publiczne bez logowania — stanowisko, firma, miasto, data, link |
| **Remotive** | zdalne / globalnie | Oferty w 100% zdalne, głównie EN |
| **Himalayas** | zdalne / globalnie | Zdalne z jawnym poziomem i widełkami |
| **Jobicy** | zdalne / globalnie | Zdalne, dużo ról cloud/DevOps |
| **Arbeitnow** | Europa | Rynek DE + zdalne, sporo firm rekrutujących też w PL |
| **Adzuna** *(opcjonalnie, wymaga klucza)* | Polska | Agregator (źródłem m.in. praca.pl). **Dla Azure bezużyteczny** — patrz niżej |

### Adzuna — po co i dlaczego raczej nie

Sprawdzone 06.09.2026 na adzuna.pl dla Polski: **`azure` → 0 wyników, `devops` → 1**, przy 11 811 dla
`programista` i 12 870 ofertach zdalnych. Polski indeks Adzuny to głównie role nietechniczne, a źródłem
ofert jest **praca.pl, nie pracuj.pl**. Dla ścieżki Azure nie warto tam zakładać konta.

Jeśli mimo to chcesz go włączyć (role nietechniczne albo inny kraj przez pole `country`):

1. Darmowy klucz: https://developer.adzuna.com/ (limit ~250 zapytań/dzień).
2. Wklej `app_id` i `app_key` do `config.json` i ustaw `"enabled": true`.
3. Zrestartuj serwer — źródło zrobi się klikalne na liście.

### Jak działa źródło pracuj.pl (tryb przeglądarki)

pracuj.pl odrzuca zwykłe zapytania HTTP stroną „Just a moment…" (challenge JS Cloudflare), ale oferty
siedzą server-side w `<script id="__NEXT_DATA__">` na stronie wyników. Dlatego to jedno źródło
otwiera adres w **prawdziwej przeglądarce** i czyta ten sam JSON, którego używa ich własny frontend.

Wymaga jednorazowo:

```bash
npm i puppeteer-core
```

To ~3 MB — `puppeteer-core` **nie pobiera własnego Chromium**, tylko steruje Edge/Chrome już
zainstalowanym w systemie (ścieżka wykrywana automatycznie; ręcznie ustawisz ją w
`config.json` → `browser.executablePath`).

Szczegóły:

- Przeglądarka startuje dopiero przy pierwszym skanie i **sama się zamyka po 2 minutach bezczynności**
  (`browser.idleTimeoutMs`), a serwer domyka ją na Ctrl+C. Żadnego procesu w tle.
- Kosztuje ok. 4 s na skan — reszta źródeł leci równolegle, więc całość mieści się w ~5 s.
- Filtry poziomu i trybu pracy nakładamy po stronie portalu (`et`, `wm` — kody pobrane z ich
  własnych słowników), reszta filtruje się lokalnie.
- Widełki portal podaje tekstem („110–160 zł netto (+ VAT) / godz."). Pokazujemy oryginał, ale
  parsujemy liczby, żeby działał suwak minimalnej stawki i sortowanie (godzinowe przeliczamy ×168).
- `config.json` → `pracuj.service`: `"all"` = www.pracuj.pl (szerzej, ~1050 wyników na „azure"),
  `"it"` = it.pracuj.pl (tylko IT, ~49 wyników, za to trafniej).

Gdyby Cloudflare kiedyś zatrzymał headless, ustaw `"headless": false` w `config.json` — wtedy
zobaczysz okno przeglądarki i challenge przechodzi na pewno.

### Jak działa źródło LinkedIn

Używamy publicznego endpointu `jobs-guest/jobs/api/seeMoreJobPostings/search` — tego samego,
z którego korzysta strona wyników LinkedIna dla niezalogowanych. Jedno zapytanie = 10 kart,
więc jeden „poziom głębokości" to trzy zapytania (max 10, z odstępem 250 ms).

Dwa ograniczenia wynikające z tego, co jest na kartach gościa:

- **Brak widełek i listy technologii** — LinkedIn ich publicznie nie pokazuje. Filtr wynagrodzenia
  odrzuci te oferty, bo nie mają danych.
- **Karta nie mówi, czy oferta jest zdalna** (pokazuje miasto firmy). Dlatego wybór *Tylko zdalna*
  odpala ponowny skan z filtrem `f_WT=2` po stronie LinkedIna — i dopiero wtedy te oferty są
  oznaczone jako zdalne. Tak samo poziom stanowiska zawężamy przez `f_E`, ale pracodawcy notorycznie
  go zawyżają, więc dodatkowo wykrywamy poziom z tytułu.

Lokalizację wysyłaną do LinkedIna ustawisz w `config.json` (`linkedin.location`, domyślnie `Poland`).
Pole *Lokalizacja* w panelu filtruje już pobrane wyniki, nie zmienia zapytania.

## Czego NIE da się skanować automatycznie

**justjoin.it i rocketjobs.pl** — `api.justjoin.it` odrzuca każde zapytanie z Node/curl błędem 503,
niezależnie od nagłówków (blokada po odcisku TLS klienta, nie po User-Agent). HTML strony zawiera
tylko szkielet filtrów, oferty doładowuje ten sam zablokowany API. Sprawdzone też: `/api/*` na
domenie głównej, dane `_next`, RSS, sitemap — wszystko 404.

**Glassdoor** — zwraca 403 ze stroną „Security | Glassdoor" (bot manager Cloudflare).

**theProtocol.it** — 403 ze stroną „Just a moment…" (challenge JS Cloudflare), niezależnie od nagłówków.
Da się go dołożyć tym samym trybem przeglądarki co pracuj.pl — po prostu jeszcze tego nie zrobiliśmy.

**pracuj.pl** blokuje tak samo, ale **jest już obsłużony** trybem przeglądarki (patrz wyżej).

Dla justjoin.it nie pomoże nawet tryb przeglądarki bez dodatkowej pracy: strona pobiera oferty
z zablokowanego API po stronie klienta, więc trzeba by przechwytywać jej własne odpowiedzi sieciowe.
Aplikacja buduje dla nich
**gotowe linki wyszukiwania z już nałożonymi filtrami** — sekcja na dole strony. Zmieniasz frazę /
poziom / tryb pracy w panelu, linki aktualizują się same, klikasz i portal otwiera się z właściwymi
wynikami. Formaty URL są sprawdzone w przeglądarce (m.in. theProtocol filtruje przez `azure;t`,
a nie przez frazę; bulldogjob przez `skills,Azure`).

## Filtry (działają lokalnie, natychmiast)

- **poziom stanowiska** — junior / mid / senior / nieokreślony; poziom bierzemy z portalu, a jeśli
  go nie poda, zgadujemy z tytułu (junior, młodszy, trainee, staż, praktykant, graduate, associate…)
- **„tylko junior friendly”** — odsiewa tytuły z senior / lead / architekt / manager
- **tryb pracy** — zdalna / zdalna lub hybrydowa / stacjonarna
- **lokalizacja** — dowolny fragment (Warszawa, Kraków, Poland…)
- **wynagrodzenie** — tylko oferty z widełkami + suwak minimum (waluty i okresy przeliczane na PLN/mies.)
- **świeżość** — 24h / 3 / 7 / 14 / 30 dni
- **słowa kluczowe** — „musi zawierać” i „wyklucz” (np. wyklucz: `senior, sap, java`)
- **Azure/cloud w tytule** — twardy odsiew ofert, gdzie Azure to tylko wzmianka w opisie
- **widok** — wszystkie / zapisane ⭐ / nowe od ostatniego skanu / kosz

Dodatkowo: sortowanie (trafność, data, wynagrodzenie, firma), zapisywanie i ukrywanie ofert,
znacznik **NOWE**, eksport wyników do CSV, deduplikacja ofert powtarzających się między portalami
i między miastami (NoFluffJobs publikuje tę samą ofertę osobno dla każdego miasta).

## Jak z tego korzystać na co dzień

1. Zacznij od presetu **Azure Junior** — pokaże realny stan rynku juniorskiego.
2. Rozszerz zapytanie: `cloud engineer`, `helpdesk support`, `azure administrator`, `.net azure` —
   junior-Azure to wąska nisza, więc role wejściowe często nazywają się inaczej.
3. Ustaw świeżość na 3–7 dni i skanuj raz dziennie; nowe oferty dostaną znacznik **NOWE**.
4. Przejrzyj sekcję linków — pracuj.pl i justjoin.it mają sporo ofert adminowych,
   których nie ma na portalach objętych skanem.
5. Ciekawe oferty oznacz gwiazdką, resztę wyrzuć do kosza — filtry pamiętają stan między sesjami.

## Struktura

```
server.js              serwer HTTP + API (bez zależności)
config.json            port, cache, presety zapytań, klucz Adzuny
src/scanner.js         równoległy skan źródeł, cache, deduplikacja
src/normalize.js       wspólny kształt oferty, wykrywanie poziomu i trybu pracy, trafność
src/deeplinks.js       budowanie linków do portali blokujących roboty
src/sources/*.js       po jednym pliku na portal
public/                interfejs (bez frameworków)
```

Dodanie kolejnego portalu = jeden plik w `src/sources/` eksportujący `fetchJobs(params)`
zwracające `{ total, jobs }` z ofertami przepuszczonymi przez `makeJob()`, plus wpis w `src/sources/index.js`.

## Uwagi

- Wszystko działa lokalnie; żadne dane nie wychodzą poza Twój komputer (poza zapytaniami do publicznych API portali).
- Wyniki są cache'owane przez 10 minut (zmienisz w `config.json`); przycisk ↻ wymusza świeże pobranie.
- Portale potrafią zmienić swoje API bez zapowiedzi — jeśli któreś źródło zapali się na czerwono,
  najedź na nie kursorem, żeby zobaczyć treść błędu.
