import { config } from './config.js';

export function randomDelayMs() {
  const min = Math.min(config.delayMinSec, config.delayMaxSec) * 1000;
  const max = Math.max(config.delayMinSec, config.delayMaxSec) * 1000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
