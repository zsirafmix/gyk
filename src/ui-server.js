import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readEnvFile, upsertEnvKeys } from './envFile.js';
import { DEFAULT_CATEGORIES, fetchLiveCategories } from './categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const publicDir = path.join(root, 'ui', 'public');
const PORT = Number(process.env.UI_PORT) || 3847;

const LOG_MAX = 800;
const botState = {
  proc: null,
  startedAt: null,
  exitCode: null,
  logs: [],
};

function appendLog(line) {
  const text = String(line).replace(/\r/g, '');
  for (const part of text.split('\n')) {
    botState.logs.push(part);
  }
  if (botState.logs.length > LOG_MAX) {
    botState.logs = botState.logs.slice(-LOG_MAX);
  }
}

function boolFromEnv(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function getUiSettings() {
  const env = readEnvFile(envPath);
  const cats = (env.CATEGORIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const maxQ = Number(env.MAX_QUESTIONS_PER_RUN);
  return {
    categories: cats,
    dryRun: boolFromEnv(env.DRY_RUN, true),
    maxQuestionsPerRun: Number.isFinite(maxQ) && maxQ > 0 ? maxQ : 0,
    once: boolFromEnv(env.ONCE, false),
    hasCredentials: Boolean(env.GK_USERNAME && env.GK_PASSWORD),
  };
}

function botStatus() {
  const running = Boolean(botState.proc && botState.proc.exitCode === null);
  return {
    running,
    pid: running ? botState.proc.pid : null,
    startedAt: botState.startedAt,
    exitCode: botState.exitCode,
    logLines: botState.logs.length,
  };
}

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDir));

app.get('/api/settings', (_req, res) => {
  res.json({ ok: true, settings: getUiSettings(), bot: botStatus() });
});

app.post('/api/settings', (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};

    if (Array.isArray(body.categories)) {
      const slugs = body.categories
        .map((s) => String(s).trim().toLowerCase())
        .filter((s) => /^[a-z0-9-]+$/.test(s));
      updates.CATEGORIES = slugs.join(',');
    }

    if (body.dryRun !== undefined) {
      updates.DRY_RUN = body.dryRun ? 'true' : 'false';
    }

    if (body.maxQuestionsPerRun !== undefined) {
      const n = Number(body.maxQuestionsPerRun);
      updates.MAX_QUESTIONS_PER_RUN =
        Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '0';
    }

    if (body.once !== undefined) {
      updates.ONCE = body.once ? 'true' : 'false';
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ ok: false, error: 'Nincs mentendő mező.' });
    }

    upsertEnvKeys(envPath, updates);
    res.json({ ok: true, settings: getUiSettings() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  const live = req.query.live === '1' || req.query.live === 'true';
  if (live) {
    try {
      const env = readEnvFile(envPath);
      const base = env.SITE_BASE_URL || 'https://www.gyakorikerdesek.hu';
      const fetched = await fetchLiveCategories(base);
      if (fetched && fetched.length) {
        return res.json({ ok: true, source: 'live', categories: fetched });
      }
    } catch (err) {
      return res.json({
        ok: true,
        source: 'default',
        warning: err.message,
        categories: DEFAULT_CATEGORIES,
      });
    }
  }
  res.json({ ok: true, source: 'default', categories: DEFAULT_CATEGORIES });
});

app.get('/api/bot/status', (_req, res) => {
  res.json({ ok: true, bot: botStatus(), settings: getUiSettings() });
});

app.get('/api/bot/logs', (req, res) => {
  const since = Math.max(0, Number(req.query.since) || 0);
  const lines = botState.logs.slice(since);
  res.json({
    ok: true,
    since,
    next: botState.logs.length,
    lines,
    bot: botStatus(),
  });
});

app.post('/api/bot/start', (req, res) => {
  if (botState.proc && botState.proc.exitCode === null) {
    return res.status(409).json({ ok: false, error: 'A bot már fut.' });
  }

  try {
    const body = req.body || {};
    if (
      body.categories ||
      body.dryRun !== undefined ||
      body.maxQuestionsPerRun !== undefined
    ) {
      const updates = {};
      if (Array.isArray(body.categories)) {
        updates.CATEGORIES = body.categories
          .map((s) => String(s).trim().toLowerCase())
          .filter((s) => /^[a-z0-9-]+$/.test(s))
          .join(',');
      }
      if (body.dryRun !== undefined) {
        updates.DRY_RUN = body.dryRun ? 'true' : 'false';
      }
      if (body.maxQuestionsPerRun !== undefined) {
        const n = Number(body.maxQuestionsPerRun);
        updates.MAX_QUESTIONS_PER_RUN =
          Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '0';
      }
      // UI-ból indítva: folyamatos futás, a MAX_QUESTIONS_PER_RUN állítja meg
      updates.ONCE = 'false';
      upsertEnvKeys(envPath, updates);
    } else {
      upsertEnvKeys(envPath, { ONCE: 'false' });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }

  botState.logs = [];
  botState.exitCode = null;
  botState.startedAt = new Date().toISOString();
  appendLog(`[UI] Bot indítása: node src/index.js (${new Date().toLocaleString('hu-HU')})`);

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  botState.proc = child;

  child.stdout.on('data', (buf) => appendLog(buf.toString()));
  child.stderr.on('data', (buf) => appendLog(buf.toString()));
  child.on('exit', (code, signal) => {
    botState.exitCode = code;
    appendLog(
      `[UI] Bot leállt (kód: ${code}${signal ? `, jel: ${signal}` : ''})`,
    );
    botState.proc = null;
  });
  child.on('error', (err) => {
    appendLog(`[UI] Indítási hiba: ${err.message}`);
    botState.proc = null;
    botState.exitCode = 1;
  });

  res.json({ ok: true, bot: botStatus(), settings: getUiSettings() });
});

app.post('/api/bot/stop', (_req, res) => {
  if (!botState.proc || botState.proc.exitCode !== null) {
    return res.json({ ok: true, message: 'A bot nem fut.', bot: botStatus() });
  }
  appendLog('[UI] Leállítás kérése…');
  try {
    botState.proc.kill('SIGTERM');
    setTimeout(() => {
      if (botState.proc && botState.proc.exitCode === null) {
        try {
          botState.proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }, 4000);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
  res.json({ ok: true, bot: botStatus() });
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`GYK beállítások UI: ${url}`);
  const opener =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}" 2>/dev/null || true`;
  exec(opener);
});
