import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Helyi JSON tároló a megválaszolt kérdés-ID-khez + óránkénti rate limithez.
 */
export class AnswerStore {
  constructor(filePath = config.answeredDbPath) {
    this.filePath = filePath;
    this.data = { answered: {}, hourly: [] };
    this.#load();
  }

  #load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data.answered ||= {};
        this.data.hourly ||= [];
      }
    } catch (err) {
      logger.warn('Answer store betöltési hiba, üres store-ral indulunk:', err.message);
      this.data = { answered: {}, hourly: [] };
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  has(questionId) {
    return Boolean(this.data.answered[String(questionId)]);
  }

  mark(questionId, meta = {}) {
    const id = String(questionId);
    this.data.answered[id] = {
      at: new Date().toISOString(),
      dryRun: Boolean(meta.dryRun),
      title: meta.title || '',
      url: meta.url || '',
      preview: (meta.answerPreview || '').slice(0, 200),
    };
    if (!meta.dryRun) {
      this.data.hourly.push(Date.now());
      this.#pruneHourly();
    }
    this.#save();
  }

  #pruneHourly() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.data.hourly = this.data.hourly.filter((t) => t >= cutoff);
  }

  answersInLastHour() {
    this.#pruneHourly();
    return this.data.hourly.length;
  }

  canAnswerMore(maxPerHour) {
    return this.answersInLastHour() < maxPerHour;
  }
}
