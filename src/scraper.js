import { config } from './config.js';
import { logger } from './logger.js';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function fetchHtml(pathOrUrl) {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${config.siteBaseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'hu-HU,hu;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return { url: res.url, html: await res.text() };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * Kérdéslista kinyerése kategória / válasz-nélkül oldalról.
 * HTML struktúra: div#k{ID}.kerdeslista + a[href] + .kerdeslista_valasz
 */
export function parseQuestionList(html, pageUrl) {
  const questions = [];
  const re =
    /id="k(\d+)"[\s\S]*?<a\s+[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>([\s\S]*?)kerdeslista_valasz[^>]*>(\d+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    let href = m[2];
    if (href.startsWith('/')) href = `${config.siteBaseUrl}${href}`;
    const title = stripTags(m[3]);
    const snippetMatch = m[4].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';
    const answerCount = Number(m[5]);
    const catMatch = m[4].match(/kerdes_alatt[^>]*>([\s\S]*?)<\/span>/i);
    const category = catMatch ? stripTags(catMatch[1]) : '';
    questions.push({
      id,
      url: href,
      title,
      snippet,
      answerCount,
      category,
      listUrl: pageUrl,
    });
  }
  return questions;
}

/**
 * Egy kérdés oldalának részletei (cím + törzs).
 */
export function parseQuestionPage(html, url) {
  const idMatch = url.match(/__(\d+)-/) || html.match(/id="k(\d+)"/);
  const id = idMatch ? idMatch[1] : null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? stripTags(h1[1]) : '';
  const bodyMatch = html.match(/class="kerdes_kerdes"[^>]*>([\s\S]*?)<\/div>\s*<br>/i)
    || html.match(/class="kerdes_kerdes"[^>]*>([\s\S]*?)<div class="kerdes_kulcsszo"/i);
  let body = '';
  if (bodyMatch) {
    body = stripTags(
      bodyMatch[1]
        .replace(/<div[^>]*>[\s\S]*?Figyelt kérdés[\s\S]*?<\/div>/gi, '')
        .replace(/<input[\s\S]*?>/gi, ''),
    );
  }
  let category = '';
  const morzsa = html.match(/class="morzsamenu"[^>]*>([\s\S]*?)<\/div>/i);
  if (morzsa) {
    const links = [...morzsa[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((x) => stripTags(x[1]));
    // tipikusan: Kezdőoldal » Kategória » Alkategória » cím
    if (links.length >= 3) category = `${links[1]} » ${links[2]}`;
    else if (links.length >= 2) category = `${links[0]} » ${links[1]}`;
    else if (links.length === 1) category = links[0];
  }
  const ans = html.match(/kerdeslista_valasz[^>]*>(\d+)/i);
  // On detail page answer count may be elsewhere; keep optional
  return { id, url, title, body, category, answerCount: ans ? Number(ans[1]) : undefined };
}

function matchesKeywords(q, keywords) {
  if (!keywords.length) return true;
  const hay = `${q.title} ${q.snippet} ${q.body || ''}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

/**
 * Kérdések összegyűjtése a konfigurált kategóriákból.
 */
export async function findCandidateQuestions(store) {
  const cats = config.categories.length ? config.categories : ['szamitastechnika'];
  const seen = new Set();
  const out = [];

  for (const cat of cats) {
    const paths = config.onlyUnanswered
      ? [`/${cat}__valasz-nelkul`, `/${cat}`]
      : [`/${cat}`];

    for (const p of paths) {
      try {
        const { url, html } = await fetchHtml(p);
        const list = parseQuestionList(html, url);
        logger.debug(`${p}: ${list.length} kérdés a listában`);
        for (const q of list) {
          if (seen.has(q.id)) continue;
          seen.add(q.id);
          if (store.has(q.id)) continue;
          if (q.answerCount > config.maxExistingAnswers) continue;
          if (!matchesKeywords(q, config.keywords)) continue;
          out.push(q);
        }
      } catch (err) {
        logger.warn(`Lista hiba (${p}):`, err.message);
      }
    }
  }

  // Prefer fewer answers, then newer-looking (higher id)
  out.sort((a, b) => a.answerCount - b.answerCount || Number(b.id) - Number(a.id));
  return out;
}

export async function loadQuestionDetails(q) {
  const { html, url } = await fetchHtml(q.url);
  const details = parseQuestionPage(html, url);
  return {
    ...q,
    ...details,
    id: details.id || q.id,
    title: details.title || q.title,
    body: details.body || q.snippet || '',
    category: details.category || q.category || '',
    url: details.url || q.url,
  };
}
