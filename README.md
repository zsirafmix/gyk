# GYK Auto-Answer

Automatikus válaszoló a [gyakorikerdesek.hu](https://www.gyakorikerdesek.hu/) oldalhoz **Pollinations AI** segítségével.

A program:

1. bejelentkezik (Playwright),
2. megkeresi a megválaszolatlan / kevés válaszos kérdéseket,
3. természetes magyar választ generál a Pollinations chat API-n,
4. dry-run módban kiírja, éles módban beküldi a választ,
5. helyi JSON-ban nyilvántartja a már kezelt kérdés-ID-ket,
6. rate limitel (késleltetés + max válasz/óra).

> **Figyelem:** Az automatikus posztolás a oldal felhasználási feltételeibe ütközhet. Saját felelősségre, saját fiókkal, mértékkel használd. A dry-run mód ajánlott teszteléshez.

## Telepítés

```bash
cd /workspace/gyk
npm install
npx playwright install chromium
cp .env.example .env
# Szerkeszd a .env-et: POLLINATIONS_API_KEY, GK_USERNAME, GK_PASSWORD
```

## Futtatás

```bash
# Dry-run: kérdés lekérés → AI válasz → konzolra írás (NEM posztol)
npm run dry-run

# Egyetlen dry-run kör
npm run once:dry

# Éles mód (bejelentkezés + automatikus poszt)
npm start

# Egy éles kör
npm run once
```


## Grafikus beállítások (UI)

Helyi webes felület a kategóriák, dry-run és a futásonkénti kérdéslimit állításához, valamint a bot indításához/leállításához:

```bash
npm run ui
```

Megnyílik a böngészőben: `http://127.0.0.1:3847/` (port: `UI_PORT`).

A UI magyar feliratú. A kiválasztott kategóriák a `.env` `CATEGORIES` mezőjébe, a kérdéslimit a `MAX_QUESTIONS_PER_RUN` mezőbe kerül. A bot naplója élőben látszik. A meglévő CLI scripteket (`npm start`, `npm run dry-run`, stb.) nem változtatja.

## Környezeti változók

Lásd `.env.example`. Legfontosabbak:

| Változó | Jelentés |
|--------|----------|
| `POLLINATIONS_API_KEY` | Pollinations API kulcs (`sk_…`) |
| `GK_USERNAME` | gyakorikerdesek.hu e-mail |
| `GK_PASSWORD` | jelszó |
| `DRY_RUN` | `true` = nem posztol |
| `CATEGORIES` | pl. `szamitastechnika,otthon` |
| `MAX_QUESTIONS_PER_RUN` | futásonkénti max. válasz (0 = korlátlan) |
| `ONLY_UNANSWERED` | `true` = `/{kat}__valasz-nelkul` lista |
| `MAX_EXISTING_ANSWERS` | max. meglévő válasz (alap: 2) |
| `DELAY_MIN_SEC` / `DELAY_MAX_SEC` | késleltetés válaszok között (60–120) |
| `MAX_ANSWERS_PER_HOUR` | óránkénti limit |
| `POLL_INTERVAL_SEC` | várakozás, ha nincs új kérdés |
| `HEADLESS` | Playwright headless mód |
| `MOCK_AI` | `true` = Pollinations helyett helyettesítő válasz (offline teszt) |

**Titkokat soha ne commitolj** — a `.env` a `.gitignore`-ban van.

## Fájlok

```
gyk/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── data/answered.json      # futás közben (gitignored)
├── storage/gk-session.json # Playwright session (gitignored)
├── ui/public/              # beállítások UI (HTML/CSS/JS)
└── src/
    ├── index.js            # fő ciklus
    ├── config.js           # env betöltés
    ├── categories.js       # kategória lista (+ élő scrape)
    ├── envFile.js          # .env olvasás/írás (UI)
    ├── ui-server.js        # Express UI szerver (npm run ui)
    ├── logger.js
    ├── store.js            # megválaszolt ID-k + rate limit
    ├── scraper.js          # kérdéslista / részletek (HTTP)
    ├── pollinations.js     # AI válaszgenerálás
    ├── browser.js          # login + űrlapkitöltés (Playwright)
    └── rateLimit.js
```

## Oldalstruktúra (implementáció alapja)

Ellenőrizve élő oldalon (curl):

- **Belépés:** `GET /belepes`, form `#blp` → AJAX `POST /jquery/belepes.php`  
  mezők: `belepes_email`, `belepes_jelszo`, `auto`  
  Cookie hozzájárulás (`cookieok`) kötelező a belépéshez.
- **Válasz nélküli lista:** `/{kategoria}__valasz-nelkul` (pl. `/szamitastechnika__valasz-nelkul`)
- **Kérdés URL:** `/{kat}__{alkat}__{id}-{slug}`
- **Válasz beküldés:** bejelentkezés után `#valasz` form → `POST /jquery/valasz.php`  
  (a pontos mezőnevek a bejelentkezett DOM-ból derülnek ki; a kód rugalmasan kezeli)

## Pollinations

- Base: `https://gen.pollinations.ai`
- `POST /v1/chat/completions`
- Header: `Authorization: Bearer $POLLINATIONS_API_KEY`
- Alap modell: `openai`

## Naplózás

A posztolt / dry-run válaszok a konzolra és a `data/answered.json` fájlba kerülnek (ID, cím, URL, időbélyeg, előnézet).

## Hibaelhárítás

- **Belépés cookie hibával:** a böngésző modul beállítja a `cookieok` cookie-t és rákattint az „Elfogadom” gombra.
- **Nincs válasz űrlap éles módban:** ellenőrizd a belépést; a `#valasz` HTML dump a `storage/answer-form-dump.html` fájlba kerül.
- **Pollinations 401:** ellenőrizd a `POLLINATIONS_API_KEY` értéket az [enter.pollinations.ai](https://enter.pollinations.ai/keys) oldalon.
