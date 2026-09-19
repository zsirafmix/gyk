import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[config.logLevel] ?? LEVELS.info;

function ts() {
  return new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
}

function log(level, ...args) {
  if ((LEVELS[level] ?? 99) > current) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}]`;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](prefix, ...args);
}

export const logger = {
  error: (...a) => log('error', ...a),
  warn: (...a) => log('warn', ...a),
  info: (...a) => log('info', ...a),
  debug: (...a) => log('debug', ...a),
};
