/**
 * Top-level kategóriák a gyakorikerdesek.hu bal oldali menüjéből (#alkategoria).
 * Forrás: élő oldal scrape (2026-09-19). A UI opcionálisan frissítheti.
 */
export const DEFAULT_CATEGORIES = [
  { slug: 'allatok', name: 'Állatok' },
  { slug: 'csaladi-kapcsolatok', name: 'Családi kapcsolatok' },
  { slug: 'egeszseg', name: 'Egészség' },
  { slug: 'elektronikus-eszkozok', name: 'Elektronikus eszközök' },
  { slug: 'emberek', name: 'Emberek' },
  { slug: 'etelek-italok', name: 'Ételek, italok' },
  { slug: 'ezoteria', name: 'Ezotéria' },
  { slug: 'felnott-parkapcsolatok', name: 'Felnőtt párkapcsolatok' },
  { slug: 'fogyokurak', name: 'Fogyókúrák' },
  { slug: 'gyerekvallalas-neveles', name: 'Gyerekvállalás, nevelés' },
  { slug: 'ismerkedes', name: 'Ismerkedés' },
  { slug: 'kozlekedes', name: 'Közlekedés' },
  { slug: 'kozoktatas-tanfolyamok', name: 'Közoktatás, tanfolyamok' },
  { slug: 'kultura-es-kozosseg', name: 'Kultúra és közösség' },
  { slug: 'otthon', name: 'Otthon' },
  { slug: 'politika', name: 'Politika' },
  { slug: 'sport-mozgas', name: 'Sport, mozgás' },
  { slug: 'szamitastechnika', name: 'Számítástechnika' },
  { slug: 'szepseg-es-divat', name: 'Szépség és divat' },
  { slug: 'szexualitas', name: 'Szexualitás' },
  { slug: 'szorakozas', name: 'Szórakozás' },
  { slug: 'tini-parkapcsolatok', name: 'Tini párkapcsolatok' },
  { slug: 'tudomanyok', name: 'Tudományok' },
  { slug: 'utazas', name: 'Utazás' },
  { slug: 'unnepek', name: 'Ünnepek' },
  { slug: 'uzlet-es-penzugyek', name: 'Üzlet és pénzügyek' },
  { slug: 'egyeb-kerdesek', name: 'Egyéb kérdések' },
];

/**
 * Élő menü scrape a kezdőoldalról. Hibánál null.
 */
export async function fetchLiveCategories(siteBaseUrl) {
  const base = (siteBaseUrl || 'https://www.gyakorikerdesek.hu').replace(/\/$/, '');
  const res = await fetch(base + '/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html',
      'Accept-Language': 'hu-HU,hu;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const blockMatch = html.match(/id="alkategoria"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
  if (!blockMatch) return null;
  const pairs = [];
  const re = /href=['"]\/([a-z0-9-]+)['"][^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(blockMatch[1]))) {
    pairs.push({ slug: m[1], name: m[2].trim() });
  }
  return pairs.length ? pairs : null;
}
