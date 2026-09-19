import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function list(v) {
  if (!v || !String(v).trim()) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  root,
  siteBaseUrl: (process.env.SITE_BASE_URL || 'https://www.gyakorikerdesek.hu').replace(/\/$/, ''),
  pollinations: {
    baseUrl: (process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai').replace(/\/$/, ''),
    apiKey: process.env.POLLINATIONS_API_KEY || '',
    model: process.env.POLLINATIONS_MODEL || 'openai',
  },
  gk: {
    username: process.env.GK_USERNAME || '',
    password: process.env.GK_PASSWORD || '',
  },
  dryRun: bool(process.env.DRY_RUN, false),
  once: bool(process.env.ONCE, false),
  categories: list(process.env.CATEGORIES),
  keywords: list(process.env.KEYWORDS).map((k) => k.toLowerCase()),
  maxExistingAnswers: num(process.env.MAX_EXISTING_ANSWERS, 2),
  onlyUnanswered: bool(process.env.ONLY_UNANSWERED, true),
  delayMinSec: num(process.env.DELAY_MIN_SEC, 60),
  delayMaxSec: num(process.env.DELAY_MAX_SEC, 120),
  maxAnswersPerHour: num(process.env.MAX_ANSWERS_PER_HOUR, 8),
  pollIntervalSec: num(process.env.POLL_INTERVAL_SEC, 300),
  headless: bool(process.env.HEADLESS, true),
  storageStatePath: path.resolve(root, process.env.STORAGE_STATE_PATH || 'storage/gk-session.json'),
  answeredDbPath: path.resolve(root, process.env.ANSWERED_DB_PATH || 'data/answered.json'),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
};

export function assertConfigForMode() {
  const mockAi = ['1', 'true', 'yes', 'on'].includes(String(process.env.MOCK_AI || '').trim().toLowerCase());
  if (!config.pollinations.apiKey && !mockAi) {
    throw new Error('Hiányzik a POLLINATIONS_API_KEY a .env fájlból (vagy állítsd MOCK_AI=true teszteléshez).');
  }
  if (!config.dryRun) {
    if (!config.gk.username || !config.gk.password) {
      throw new Error('Éles módban kötelező a GK_USERNAME és GK_PASSWORD (soha ne hardkódold).');
    }
  }
}
