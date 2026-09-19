import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Playwright session: cookie elfogadás, login, válasz űrlap kitöltés + submit.
 *
 * Megfigyelt oldalstruktúra (2026-09):
 * - Belépés: GET /belepes, form#blp → POST /jquery/belepes.php
 *   mezők: belepes_email, belepes_jelszo, auto
 * - Cookie: cookieok cookie kötelező a loginhoz; UI: „Elfogadom”
 * - Válasz: #valasz konténer; bejelentkezés után form → POST /jquery/valasz.php
 *   (a pontos mezőnevek a bejelentkezett DOM-ból derülnek ki futáskor)
 */

export class GkBrowser {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch() {
    fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
    this.browser = await chromium.launch({ headless: config.headless });
    const opts = {
      locale: 'hu-HU',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    };
    if (fs.existsSync(config.storageStatePath)) {
      opts.storageState = config.storageStatePath;
      logger.info('Meglévő munkamenet betöltve:', config.storageStatePath);
    }
    this.context = await this.browser.newContext(opts);
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(45000);
  }

  async close() {
    try {
      if (this.context) await this.context.close();
    } catch (_) {}
    try {
      if (this.browser) await this.browser.close();
    } catch (_) {}
    this.page = this.context = this.browser = null;
  }

  async saveSession() {
    if (!this.context) return;
    await this.context.storageState({ path: config.storageStatePath });
  }

  async acceptCookies() {
    const page = this.page;
    // Beállítjuk a cookieok cookie-t közvetlenül is (domain: gyakorikerdesek.hu)
    await this.context.addCookies([
      {
        name: 'cookieok',
        value: String(Date.now()),
        domain: 'gyakorikerdesek.hu',
        path: '/',
      },
      {
        name: 'stiok',
        value: '1',
        domain: 'gyakorikerdesek.hu',
        path: '/',
      },
    ]);

    await page.goto(`${config.siteBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    // Ha megjelenik a banner, kattintsunk Elfogadom-ra
    const accept = page.locator('#stialert button', { hasText: 'Elfogadom' });
    try {
      if (await accept.isVisible({ timeout: 2500 })) {
        await accept.click();
        logger.debug('Cookie banner elfogadva');
      }
    } catch (_) {
      // nincs banner
    }
  }

  async isLoggedIn() {
    await this.page.goto(`${config.siteBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    // Bejelentkezve a /belepes link helyett saját menü jelenik meg
    const loginLink = this.page.locator('a[href="/belepes"]');
    const count = await loginLink.count();
    if (count === 0) return true;
    // Ha van belepes, de van „kijelentkezés” / saját profil link is
    const logout = this.page.locator('a[href*="kilepes"], a[href*="kijelentkez"]');
    if (await logout.count()) return true;
    // Ellenőrizzük egy kérdésoldalon, hogy a válasz textarea nem redirectel-e
    return false;
  }

  async login() {
    const { username, password } = config.gk;
    if (!username || !password) {
      throw new Error('GK_USERNAME / GK_PASSWORD hiányzik');
    }

    await this.acceptCookies();

    if (await this.isLoggedIn()) {
      logger.info('Már be vagyunk jelentkezve (session).');
      return;
    }

    logger.info('Bejelentkezés…');
    await this.page.goto(`${config.siteBaseUrl}/belepes`, { waitUntil: 'domcontentloaded' });

    // Cookie banner a belépés oldalon is
    const accept = this.page.locator('#stialert button', { hasText: 'Elfogadom' });
    try {
      if (await accept.isVisible({ timeout: 2000 })) await accept.click();
    } catch (_) {}

    await this.page.fill('input[name="belepes_email"]', username);
    await this.page.fill('input[name="belepes_jelszo"]', password);
    const auto = this.page.locator('input[name="auto"]');
    if (await auto.count()) {
      try {
        await auto.check({ force: true });
      } catch (_) {}
    }

    // A form AJAX-ot használ (postform → /jquery/belepes.php)
    await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes('/jquery/belepes.php') && r.request().method() === 'POST',
        { timeout: 30000 },
      ).catch(() => null),
      this.page.click('#blp_sbmt'),
    ]);

    await this.page.waitForTimeout(1500);

    const errBox = this.page.locator('#blp_res .hiba');
    if (await errBox.isVisible().catch(() => false)) {
      const msg = (await errBox.innerText()).trim();
      throw new Error(`Belépés sikertelen: ${msg}`);
    }

    // Sikeres login után általában átirányít / újratölt
    await this.page.goto(`${config.siteBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    const stillLogin = await this.page.locator('a[href="/belepes"]').count();
    // Ha még mindig látszik a Belépés, ellenőrizzük a válasz űrlapot egy oldalon
    if (stillLogin > 0) {
      logger.warn('A Belépés link még látszik – session ellenőrzés kérdésoldalon…');
    }

    await this.saveSession();
    logger.info('Belépés kész, session mentve.');
  }

  /**
   * Bejelentkezett DOM-ból kinyeri a válasz form mezőit (debug / robusztusság).
   */
  async inspectAnswerForm(questionUrl) {
    await this.page.goto(questionUrl, { waitUntil: 'domcontentloaded' });
    return this.page.evaluate(() => {
      const root = document.querySelector('#valasz') || document.body;
      const form = root.querySelector('form') || document.querySelector('form[onsubmit*="valasz"]');
      if (!form) {
        const ta = root.querySelector('textarea');
        return {
          found: false,
          placeholder: ta ? ta.getAttribute('onclick') || ta.value?.slice?.(0, 80) : null,
          htmlSnippet: root.innerHTML?.slice(0, 1500) || '',
        };
      }
      const fields = [...form.elements].map((el) => ({
        tag: el.tagName,
        name: el.name,
        type: el.type,
        id: el.id,
      }));
      return {
        found: true,
        formId: form.id,
        onsubmit: form.getAttribute('onsubmit'),
        fields,
        htmlSnippet: form.outerHTML.slice(0, 2000),
      };
    });
  }

  /**
   * Válasz beküldése a kérdés oldalán.
   * @returns {{ ok: boolean, detail: string }}
   */
  async postAnswer(questionUrl, answerText) {
    const page = this.page;
    await page.goto(questionUrl, { waitUntil: 'domcontentloaded' });

    // Ha a placeholder még loginra küld, nem vagyunk bejelentkezve
    const loginTa = page.locator('#valasz textarea[onclick*="belepes"], #valasz textarea[onfocus*="belepes"]');
    if (await loginTa.count()) {
      throw new Error('Nincs bejelentkezve: a válasz mező a /belepes oldalra irányít.');
    }

    // A valódi form AJAX-szal töltődik: kattints a placeholder textarea-ra (getscript valasz.php)
    const placeholder = page.locator('#valasz textarea[onclick*="valasz.php"], #valasz textarea[onfocus*="valasz.php"]').first();
    if (await placeholder.count()) {
      await placeholder.click();
      await page.waitForSelector('#valaszok, #valasz form#valaszok, form#valaszok textarea[name="valasz"]', {
        timeout: 20000,
      });
      await page.waitForTimeout(400);
    }

    // Keressük a valódi formot
    let form = page.locator('form#valaszok').first();
    if (!(await form.count())) {
      form = page.locator('#valasz form').first();
    }
    if (!(await form.count())) {
      form = page.locator('form[onsubmit*="valasz"]').first();
    }
    if (!(await form.count())) {
      // Mentés debughoz
      const dumpPath = path.join(config.root, 'storage', 'answer-form-dump.html');
      fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
      const snippet = await page.locator('#valasz').innerHTML().catch(() => page.content());
      fs.writeFileSync(dumpPath, typeof snippet === 'string' ? snippet : await page.content(), 'utf8');
      throw new Error(
        `Nem található válasz űrlap a bejelentkezett oldalon. Dump: ${dumpPath}`,
      );
    }

    const textarea = form.locator('textarea[name="valasz"], textarea#aktiv, textarea').first();
    if (!(await textarea.count())) {
      throw new Error('A válasz formban nincs textarea.');
    }

    await textarea.click({ clickCount: 3 }).catch(() => {});
    await textarea.fill(answerText);

    // Submit gomb
    const submit = form.locator('#valaszok_sbmt, button[type="submit"], button[id$="_sbmt"], input[type="submit"], button').first();

    const responsePromise = page
      .waitForResponse(
        (r) => r.url().includes('/jquery/valasz.php') && r.request().method() === 'POST',
        { timeout: 30000 },
      )
      .catch(() => null);

    await submit.click();
    const resp = await responsePromise;
    await page.waitForTimeout(1200);

    if (resp) {
      const body = await resp.text().catch(() => '');
      logger.debug('valasz.php válasz:', body.slice(0, 300));
      if (/hiba/i.test(body) && !/ok|sikeres|köszön/i.test(body)) {
        // Lehet JS ami hibát ír a DOM-ba
        const domErr = page.locator('#valasz .hiba, [id$="_res"] .hiba');
        if (await domErr.isVisible().catch(() => false)) {
          const msg = (await domErr.innerText()).trim();
          return { ok: false, detail: msg };
        }
      }
    }

    // Sikerkritérium: a saját válasz szövege megjelenik, vagy eltűnik az űrlap hiba nélkül
    const escaped = answerText.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const appeared = await page.locator('#valasz, .valasz_valasz, .valasz').filter({ hasText: answerText.slice(0, 30) }).count();
    if (appeared > 0) {
      return { ok: true, detail: 'A válasz megjelent az oldalon.' };
    }

    // Alternatív: form eltűnt / disabled
    const stillEditable = await textarea.isEditable().catch(() => false);
    if (!stillEditable) {
      return { ok: true, detail: 'Űrlap többé nem szerkeszthető (valószínűleg sikeres).' };
    }

    // Ha van hibaüzenet
    const domErr = page.locator('#valasz .hiba, [id$="_res"] .hiba');
    if (await domErr.isVisible().catch(() => false)) {
      return { ok: false, detail: (await domErr.innerText()).trim() };
    }

    // Fallback: közvetlen FormData POST a felfedezett mezőkkel
    const posted = await this.#postViaFormData(questionUrl, answerText);
    if (posted.ok) return posted;

    return {
      ok: Boolean(resp),
      detail: resp
        ? `valasz.php válasz érkezett (${resp.status()}), de a siker nem egyértelmű.`
        : 'Nem érkezett egyértelmű visszajelzés a beküldésről.',
    };
  }

  async #postViaFormData(questionUrl, answerText) {
    const page = this.page;
    const info = await this.inspectAnswerForm(questionUrl);
    if (!info.found) return { ok: false, detail: 'FormData fallback: nincs form' };

    const result = await page.evaluate(
      async ({ answerText, questionUrl }) => {
        const root = document.querySelector('#valasz') || document;
        const form = root.querySelector('form') || document.querySelector('form[onsubmit*="valasz"]');
        if (!form) return { ok: false, detail: 'nincs form' };
        const fd = new FormData(form);
        // Írjuk felül a textarea mezőt
        for (const [k, v] of [...fd.entries()]) {
          if (typeof v === 'string' && (k.toLowerCase().includes('valasz') || k === 'szoveg' || k === 'text')) {
            fd.set(k, answerText);
          }
        }
        // Ha nincs szövegmező a FormData-ban, tipikus nevek
        const hasText = [...fd.keys()].some((k) =>
          ['valasz', 'szoveg', 'text', 'valasz_szoveg', 'uzenet'].includes(k.toLowerCase()),
        );
        if (!hasText) {
          const ta = form.querySelector('textarea');
          if (ta?.name) fd.set(ta.name, answerText);
          else fd.set('valasz', answerText);
        }
        const res = await fetch('/jquery/valasz.php', { method: 'POST', body: fd, credentials: 'same-origin' });
        const body = await res.text();
        return { ok: res.ok, detail: body.slice(0, 400), status: res.status };
      },
      { answerText, questionUrl },
    );
    logger.debug('FormData fallback:', result);
    return {
      ok: result.ok && !/hiba/i.test(result.detail || ''),
      detail: result.detail || `status ${result.status}`,
    };
  }
}
