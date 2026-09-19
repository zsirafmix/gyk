import { config, assertConfigForMode } from './config.js';
import { logger } from './logger.js';
import { AnswerStore } from './store.js';
import { generateAnswer } from './pollinations.js';
import { findCandidateQuestions, loadQuestionDetails } from './scraper.js';
import { GkBrowser } from './browser.js';
import { randomDelayMs, sleep } from './rateLimit.js';

async function processOne(store, browser, question) {
  logger.info('---');
  logger.info(`Kérdés #${question.id} (${question.answerCount} válasz): ${question.title}`);
  logger.info(`URL: ${question.url}`);

  const detailed = await loadQuestionDetails(question);
  logger.debug('Törzs:', (detailed.body || '').slice(0, 200));

  const answer = await generateAnswer({
    title: detailed.title,
    body: detailed.body,
    category: detailed.category,
  });

  logger.info('Generált válasz:\n' + answer);

  if (config.dryRun) {
    logger.info('[DRY-RUN] Nem posztolunk. ID eltárolva dry-run jelöléssel.');
    store.mark(detailed.id, {
      dryRun: true,
      title: detailed.title,
      url: detailed.url,
      answerPreview: answer,
    });
    return { posted: false, dryRun: true, counted: true };
  }

  if (!store.canAnswerMore(config.maxAnswersPerHour)) {
    logger.warn(`Óránkénti limit elérve (${config.maxAnswersPerHour}). Várakozás…`);
    return { posted: false, rateLimited: true, counted: false };
  }

  const result = await browser.postAnswer(detailed.url, answer);
  if (!result.ok) {
    logger.error('Poszt sikertelen:', result.detail);
    return { posted: false, error: result.detail, counted: false };
  }

  store.mark(detailed.id, {
    dryRun: false,
    title: detailed.title,
    url: detailed.url,
    answerPreview: answer,
  });
  logger.info('Válasz elküldve:', result.detail);
  return { posted: true, counted: true };
}

async function runLoop() {
  assertConfigForMode();
  const store = new AnswerStore();

  logger.info('GYK Auto-Answer indul');
  logger.info(
    `Mód: ${config.dryRun ? 'DRY-RUN' : 'ÉLES POSZT'} | kategóriák: ${
      config.categories.join(', ') || '(alap)'
    } | max válasz/kérdés: ≤${config.maxExistingAnswers}` +
      (config.maxQuestionsPerRun > 0
        ? ` | max kérdés/futás: ${config.maxQuestionsPerRun}`
        : ''),
  );

  let browser = null;
  if (!config.dryRun) {
    browser = new GkBrowser();
    await browser.launch();
    await browser.login();
  }

  let answeredThisRun = 0;

  try {
    do {
      if (
        config.maxQuestionsPerRun > 0 &&
        answeredThisRun >= config.maxQuestionsPerRun
      ) {
        logger.info(
          `MAX_QUESTIONS_PER_RUN (${config.maxQuestionsPerRun}) elérve — kilépés.`,
        );
        break;
      }

      if (!config.dryRun && !store.canAnswerMore(config.maxAnswersPerHour)) {
        logger.info('Rate limit: óránkénti max elérve, 10 perc várakozás…');
        await sleep(10 * 60 * 1000);
        continue;
      }

      const candidates = await findCandidateQuestions(store);
      logger.info(`Jelöltek: ${candidates.length}`);

      if (!candidates.length) {
        if (config.once) break;
        logger.info(`Nincs új kérdés, várakozás ${config.pollIntervalSec}s…`);
        await sleep(config.pollIntervalSec * 1000);
        continue;
      }

      const q = candidates[0];
      try {
        const result = await processOne(store, browser, q);
        if (result.rateLimited) {
          await sleep(10 * 60 * 1000);
          continue;
        }
        if (result.counted) {
          answeredThisRun += 1;
          logger.info(
            `Futás számláló: ${answeredThisRun}` +
              (config.maxQuestionsPerRun > 0
                ? ` / ${config.maxQuestionsPerRun}`
                : ''),
          );
        }
      } catch (err) {
        logger.error(`Hiba a #${q.id} feldolgozásakor:`, err.message);
        // Ne cikázzunk ugyanazon a kérdésen végtelenül sikertelen AI/poszt esetén
        store.mark(q.id, {
          dryRun: true,
          title: q.title,
          url: q.url,
          answerPreview: `ERROR: ${err.message}`,
        });
      }

      if (
        config.maxQuestionsPerRun > 0 &&
        answeredThisRun >= config.maxQuestionsPerRun
      ) {
        logger.info(
          `MAX_QUESTIONS_PER_RUN (${config.maxQuestionsPerRun}) elérve — kilépés.`,
        );
        break;
      }

      if (config.once) break;

      const delay = randomDelayMs();
      logger.info(`Következő kör ${Math.round(delay / 1000)}s múlva…`);
      await sleep(delay);
    } while (!config.once);
  } finally {
    if (browser) await browser.close();
  }

  logger.info('Kész.');
}

runLoop().catch((err) => {
  logger.error('Fatális hiba:', err);
  process.exit(1);
});
