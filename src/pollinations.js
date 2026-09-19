import { config } from './config.js';
import { logger } from './logger.js';

const SYSTEM_PROMPT = `Te egy segítőkész, gyakorlati tanácsokat adó magyar válaszadó vagy a gyakorikerdesek.hu közösségi kérdés-válasz oldalon.

Stílusod:
- Természetes, hétköznapi magyar (nem hivatalos, nem robotos).
- Rövid–közepes hossz (kb. 4–12 mondat), lényegre törő.
- Empatikus, konkrét tippekkel; ha kell, jelezd a bizonytalanságot.
- NE írj spam tölteléket, üdvözlő sablont ("Szia!", "Remélem segíthettem!"), AI-utalást, linkfarmot.
- NE használd a markdown formázást (nincs **félkövér**, nincs felsorolás-jel ha nem indokolt).
- Orvosi/jogi témánál hangsúlyozd, hogy ez nem szakvélemény, érdemes szakemberhez fordulni.
- Csak a választ írd, semmi meta-kommentárt.`;

/**
 * Válasz generálása Pollinations (OpenAI-kompatibilis) chat API-n.
 */
export async function generateAnswer({ title, body, category }) {
  const { baseUrl, apiKey, model } = config.pollinations;
  if (process.env.MOCK_AI === 'true' || process.env.MOCK_AI === '1') {
    logger.warn('MOCK_AI aktív – helyettesítő válasz.');
    return (
      'Szerintem a kérdésedre a legjobb első lépés, ha pontosan leírod, mit látsz a képernyőn, ' +
      'és milyen böngészőt használsz. Általában ha a „Várjon” gombra nem kattintasz, a böngésző ' +
      'egy idő után magától dönt (sok esetben bezárja a lapot vagy megszakítja a folyamatot). ' +
      'Ha fontos az adatvesztés elkerülése, inkább kattints a várakozásra, amíg a művelet befejeződik.'
    );
  }
  if (!apiKey) throw new Error('POLLINATIONS_API_KEY hiányzik');

  const userContent = [
    category ? `Kategória: ${category}` : null,
    `Kérdés címe: ${title}`,
    body ? `Kérdés szövege:\n${body}` : null,
    'Írj egy természetes magyar választ a fenti kérdésre.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const url = `${baseUrl}/v1/chat/completions`;
  logger.debug('Pollinations kérés:', model, title.slice(0, 60));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pollinations hiba ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('Üres válasz érkezett a Pollinations API-tól.');
  }
  return sanitizeAnswer(answer);
}

function sanitizeAnswer(text) {
  return text
    .replace(/^```[\s\S]*?```$/gm, (m) => m.replace(/```\w*/g, '').trim())
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
