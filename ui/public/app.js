const $ = (id) => document.getElementById(id);

let allCategories = [];
let logCursor = 0;
let pollTimer = null;

function collectForm() {
  const categories = [...document.querySelectorAll('#categoryList input:checked')].map(
    (el) => el.value,
  );
  return {
    categories,
    dryRun: $('dryRun').checked,
    maxQuestionsPerRun: Number($('maxQuestions').value) || 0,
  };
}

function renderCategories(list, selected) {
  const sel = new Set(selected || []);
  const box = $('categoryList');
  box.innerHTML = '';
  for (const c of list) {
    const label = document.createElement('label');
    label.className = 'cat-item';
    label.innerHTML = `
      <input type="checkbox" value="${c.slug}" ${sel.has(c.slug) ? 'checked' : ''} />
      <span>
        ${escapeHtml(c.name)}
        <span class="slug">${escapeHtml(c.slug)}</span>
      </span>`;
    box.appendChild(label);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applySettings(settings) {
  $('dryRun').checked = Boolean(settings.dryRun);
  $('maxQuestions').value =
    settings.maxQuestionsPerRun > 0 ? settings.maxQuestionsPerRun : 0;
  renderCategories(allCategories, settings.categories || []);
  $('credHint').textContent = settings.hasCredentials
    ? 'Bejelentkezési adatok megadva a .env-ben.'
    : 'Figyelem: GK_USERNAME / GK_PASSWORD hiányzik — éles mód nem fog működni.';
}

function setStatus(bot) {
  const badge = $('statusBadge');
  const detail = $('statusDetail');
  const startBtn = $('btnStart');
  const stopBtn = $('btnStop');
  if (bot.running) {
    badge.className = 'badge running';
    badge.textContent = 'Fut';
    detail.textContent = `PID ${bot.pid}` + (bot.startedAt ? ` · indítva: ${formatTime(bot.startedAt)}` : '');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    badge.className = bot.exitCode && bot.exitCode !== 0 ? 'badge error' : 'badge stopped';
    badge.textContent = bot.exitCode && bot.exitCode !== 0 ? 'Hibával leállt' : 'Leállítva';
    detail.textContent =
      bot.exitCode != null
        ? `Kilépési kód: ${bot.exitCode}`
        : 'A bot jelenleg nem fut.';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('hu-HU');
  } catch {
    return iso;
  }
}

function showMsg(text, isErr) {
  const el = $('saveMsg');
  el.textContent = text;
  el.className = 'msg' + (isErr ? ' err' : '');
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

function appendLogLines(lines) {
  if (!lines.length) return;
  const view = $('logView');
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 24;
  view.textContent += (view.textContent ? '\n' : '') + lines.join('\n');
  if (atBottom) view.scrollTop = view.scrollHeight;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function loadCategories(live) {
  const q = live ? '?live=1' : '';
  const data = await api('/api/categories' + q);
  allCategories = data.categories || [];
  $('catSource').textContent =
    data.source === 'live'
      ? 'Forrás: élő oldal menü'
      : 'Forrás: beépített lista (élő scrape)';
  if (data.warning) $('catSource').textContent += ` · figyelmeztetés: ${data.warning}`;
}

async function refreshAll() {
  const [catsOk, settingsData] = await Promise.all([
    loadCategories(false).then(() => true).catch((e) => { showMsg(e.message, true); return false; }),
    api('/api/settings'),
  ]);
  if (catsOk) applySettings(settingsData.settings);
  else renderCategories(allCategories, settingsData.settings.categories);
  setStatus(settingsData.bot);
}

async function pollLogs() {
  try {
    const data = await api('/api/bot/logs?since=' + logCursor);
    logCursor = data.next;
    appendLogLines(data.lines || []);
    setStatus(data.bot);
  } catch {
    /* ignore transient */
  }
}

$('btnSelectAll').onclick = () => {
  document.querySelectorAll('#categoryList input').forEach((el) => { el.checked = true; });
};
$('btnSelectNone').onclick = () => {
  document.querySelectorAll('#categoryList input').forEach((el) => { el.checked = false; });
};
$('btnRefreshCats').onclick = async () => {
  try {
    const selected = collectForm().categories;
    await loadCategories(true);
    renderCategories(allCategories, selected);
    showMsg('Kategóriák frissítve.');
  } catch (e) {
    showMsg(e.message, true);
  }
};
$('btnSave').onclick = async () => {
  try {
    const body = collectForm();
    const data = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    applySettings(data.settings);
    showMsg('Mentve a .env fájlba.');
  } catch (e) {
    showMsg(e.message, true);
  }
};
$('btnStart').onclick = async () => {
  try {
    const body = collectForm();
    logCursor = 0;
    $('logView').textContent = '';
    const data = await api('/api/bot/start', { method: 'POST', body: JSON.stringify(body) });
    applySettings(data.settings);
    setStatus(data.bot);
    showMsg('Bot elindítva.');
  } catch (e) {
    showMsg(e.message, true);
  }
};
$('btnStop').onclick = async () => {
  try {
    const data = await api('/api/bot/stop', { method: 'POST', body: '{}' });
    setStatus(data.bot);
    showMsg('Leállítás kérve.');
  } catch (e) {
    showMsg(e.message, true);
  }
};
$('btnClearLog').onclick = () => {
  $('logView').textContent = '';
};

refreshAll().then(() => {
  pollTimer = setInterval(pollLogs, 1000);
});
