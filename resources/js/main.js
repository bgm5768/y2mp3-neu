/**
 * resources/js/main.js
 * 통합 변환 화면 UI 이벤트 바인딩 및 앱 초기화
 */

'use strict';

// ── Toast ─────────────────────────────────────────────────────────────
const Toast = {
  show(msg, type = 'info', duration = 4000, action = null) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = msg;
    el.appendChild(body);

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    if (action && action.label) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', async () => {
        try {
          if (typeof action.onClick === 'function') await action.onClick();
        } finally {
          dismiss();
        }
      });
      el.appendChild(btn);
    }

    document.getElementById('toast-container').appendChild(el);
    if (duration > 0) {
      setTimeout(dismiss, action ? Math.max(duration, 8000) : duration);
    }
  }
};

let cancelController = null;
let cancelRequested = false;
let currentItemId = null;
let isQueueRunning = false;
let currentUrlAnalysis = {
  valid: [],
  duplicateCount: 0,
  invalid: []
};

// ── UI helpers ─────────────────────────────────────────────────────────
const UI = {
  updateDepsStatus({ ffmpeg, ytdlp }) {
    const ffmpegSidebar = document.getElementById('ffmpeg-status');
    const ytdlpSidebar  = document.getElementById('ytdlp-status');
    const ffmpegVer     = document.getElementById('ffmpeg-version');
    const ytdlpVer      = document.getElementById('ytdlp-version');

    if (ffmpeg) {
      const ver = ffmpeg.ok ? (ffmpeg.version.match(/([\d.]+)/)?.[1] || '설치됨') : null;
      ffmpegSidebar.className = `status-badge ${ffmpeg.ok ? 'status-ok' : 'status-error'}`;
      ffmpegSidebar.innerHTML = `<span class="dot"></span> ffmpeg ${ffmpeg.ok ? ver : '미설치'}`;
      if (ffmpegVer) ffmpegVer.textContent = ffmpeg.ok ? (ffmpeg.version || '설치됨') : '설치되지 않음';
    }
    if (ytdlp) {
      ytdlpSidebar.className = `status-badge ${ytdlp.ok ? 'status-ok' : 'status-error'}`;
      ytdlpSidebar.innerHTML = `<span class="dot"></span> yt-dlp ${ytdlp.ok ? ytdlp.version : '미설치'}`;
      if (ytdlpVer) ytdlpVer.textContent = ytdlp.ok ? ytdlp.version : '설치되지 않음';
    }

    try {
      localStorage.setItem('yt_mp3_dep_status', JSON.stringify({
        ffmpeg: ffmpeg ? { ok: !!ffmpeg.ok, version: ffmpeg.version || '' } : null,
        ytdlp:  ytdlp  ? { ok: !!ytdlp.ok,  version: ytdlp.version  || '' } : null
      }));
    } catch {}
  },

  restoreDepsStatus() {
    try {
      const raw = localStorage.getItem('yt_mp3_dep_status');
      if (!raw) return false;
      const cached = JSON.parse(raw);
      if (cached && (cached.ffmpeg || cached.ytdlp)) {
        this.updateDepsStatus(cached);
        return true;
      }
    } catch {}
    return false;
  }
};

// ── URL parsing ────────────────────────────────────────────────────────
function splitUrlTokens(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function stripUrlToken(token) {
  return String(token || '')
    .trim()
    .replace(/^[<"']+/, '')
    .replace(/[>"'.,;]+$/g, '');
}

function extractVideoIdFromPath(pathname, segmentName) {
  const parts = pathname.split('/').filter(Boolean);
  const index = parts.findIndex(part => part.toLowerCase() === segmentName);
  return index >= 0 ? parts[index + 1] : '';
}

function isLikelyVideoId(id) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(id || '');
}

function normalizeYouTubeUrl(rawValue) {
  let value = stripUrlToken(rawValue);
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    if (/^((www|m|music)\.)?youtube\.com\//i.test(value) || /^youtu\.be\//i.test(value)) {
      value = `https://${value}`;
    } else {
      return null;
    }
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let videoId = '';

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const path = parsed.pathname.toLowerCase();
    if (path === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    } else if (path.startsWith('/shorts/')) {
      videoId = extractVideoIdFromPath(parsed.pathname, 'shorts');
    } else if (path.startsWith('/embed/')) {
      videoId = extractVideoIdFromPath(parsed.pathname, 'embed');
    } else if (path.startsWith('/live/')) {
      videoId = extractVideoIdFromPath(parsed.pathname, 'live');
    }
  }

  if (!isLikelyVideoId(videoId)) return null;

  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    key: `youtube:${videoId}`,
    raw: rawValue
  };
}

function analyzeUrlInput() {
  const input = document.getElementById('url-input');
  const existingKeys = new Set(Queue.getAll().map(item => item.urlKey || item.url));
  const seenKeys = new Set();
  const valid = [];
  const invalid = [];
  let duplicateCount = 0;

  splitUrlTokens(input.value).forEach(token => {
    const normalized = normalizeYouTubeUrl(token);
    if (!normalized) {
      invalid.push(stripUrlToken(token));
      return;
    }

    if (seenKeys.has(normalized.key) || existingKeys.has(normalized.key)) {
      duplicateCount += 1;
      return;
    }

    seenKeys.add(normalized.key);
    valid.push(normalized);
  });

  currentUrlAnalysis = { valid, duplicateCount, invalid };
  return currentUrlAnalysis;
}

function updateUrlAnalysisView() {
  const analysis = analyzeUrlInput();
  const el = document.getElementById('url-analysis');
  const parts = [`유효한 URL ${analysis.valid.length}개`];
  if (analysis.duplicateCount > 0) parts.push(`중복 ${analysis.duplicateCount}개 제외`);
  if (analysis.invalid.length > 0) parts.push(`잘못된 URL ${analysis.invalid.length}개`);
  el.textContent = parts.join(' · ');
  el.classList.toggle('has-invalid', analysis.invalid.length > 0);
  el.classList.toggle('has-valid', analysis.valid.length > 0);
  updateConvertButton();
}

function updateConvertButton() {
  const btn = document.getElementById('convert-btn');
  const count = currentUrlAnalysis.valid.length;

  if (isQueueRunning) {
    btn.textContent = '변환 진행 중…';
    btn.disabled = true;
    return;
  }

  if (count === 0) {
    btn.textContent = 'URL을 입력해주세요';
    btn.disabled = true;
  } else if (count === 1) {
    btn.textContent = 'MP3 변환';
    btn.disabled = false;
  } else {
    btn.textContent = `${count}개 변환 시작`;
    btn.disabled = false;
  }
}

function resizeUrlInput() {
  const input = document.getElementById('url-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

// ── Queue UI ──────────────────────────────────────────────────────────
const QueueUI = {
  render() {
    const panel = document.getElementById('queue-panel');
    const list = document.getElementById('queue-list');
    const empty = document.getElementById('queue-empty');
    const items = Queue.getAll();

    panel.classList.toggle('hidden', items.length === 0);
    empty.classList.toggle('hidden', items.length > 0);
    list.innerHTML = '';
    items.forEach(item => list.appendChild(this.createItemEl(item)));

    this.updateSummary();
    this.updateToolbar();
  },

  createItemEl(item) {
    const el = document.createElement('div');
    el.className = `queue-item queue-item-${item.status}`;
    el.id = `queue-item-${item.id}`;

    const thumb = document.createElement('div');
    thumb.className = `queue-thumb ${item.thumbnail ? '' : 'queue-thumb-empty'}`;
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = '';
      thumb.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'queue-info';

    const title = document.createElement('div');
    title.className = 'queue-title';
    title.textContent = item.title || item.url;

    const url = document.createElement('div');
    url.className = 'queue-url';
    url.textContent = item.url;

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    meta.textContent = [item.uploader, item.duration].filter(Boolean).join(' · ');
    meta.classList.toggle('hidden', !meta.textContent);

    const progress = document.createElement('div');
    progress.className = 'queue-progress-wrap';
    const progressBar = document.createElement('div');
    progressBar.className = 'queue-progress-bar';
    progressBar.style.width = `${Math.max(0, Math.min(100, Number(item.pct) || 0))}%`;
    progress.appendChild(progressBar);
    progress.classList.toggle('hidden', !['loading', 'running', 'done'].includes(item.status));

    const detail = document.createElement('div');
    detail.className = 'queue-detail';
    detail.textContent = [item.speed ? `속도: ${item.speed}` : '', item.eta ? `상태: ${item.eta}` : '']
      .filter(Boolean)
      .join(' · ');
    detail.classList.toggle('hidden', !detail.textContent || !['loading', 'running'].includes(item.status));

    const error = document.createElement('div');
    error.className = 'queue-error';
    error.textContent = item.errorMsg || '';
    error.classList.toggle('hidden', !item.errorMsg);

    info.append(title, url, meta, progress, detail, error);

    const status = document.createElement('span');
    status.className = `queue-status ${item.status}`;
    status.textContent = statusLabel(item.status);

    const actions = document.createElement('div');
    actions.className = 'queue-item-actions';
    this.appendItemActions(actions, item);

    el.append(thumb, info, status, actions);
    return el;
  },

  appendItemActions(container, item) {
    if (item.status === 'running' || item.status === 'loading') {
      container.appendChild(itemButton('cancel', item.id, '취소', 'btn-danger'));
      return;
    }

    if (item.status === 'error' || item.status === 'cancelled') {
      container.appendChild(itemButton('retry', item.id, '재시도', 'btn-secondary'));
    }

    if (item.status === 'done' && item.filePath) {
      container.appendChild(itemButton('open', item.id, '파일 열기', 'btn-secondary'));
    }

    container.appendChild(itemButton('remove', item.id, '항목 지우기', 'btn-ghost'));
  },

  updateItem(id, patch) {
    Queue.update(id, patch);
    this.render();
  },

  updateSummary() {
    const summary = document.getElementById('queue-summary');
    const items = Queue.getAll();
    if (!items.length) {
      summary.textContent = '대기 중인 항목이 없습니다.';
      return;
    }

    const counts = items.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const parts = [`총 ${items.length}개`];
    [
      ['waiting', '대기 중'],
      ['loading', '정보 불러오는 중'],
      ['running', '변환 중'],
      ['done', '완료'],
      ['error', '실패'],
      ['cancelled', '취소됨']
    ].forEach(([key, label]) => {
      if (counts[key]) parts.push(`${label} ${counts[key]}개`);
    });

    summary.textContent = parts.join(' · ');
  },

  updateToolbar() {
    const startBtn = document.getElementById('start-all-btn');
    const clearDoneBtn = document.getElementById('clear-completed-btn');
    const clearBtn = document.getElementById('clear-queue-btn');
    const runnable = Queue.getRunnable();
    const hasErrors = Queue.getAll().some(item => item.status === 'error' || item.status === 'cancelled');
    const hasDone = Queue.getAll().some(item => item.status === 'done');

    startBtn.textContent = hasErrors && !Queue.getAll().some(item => item.status === 'waiting')
      ? '전체 재시도'
      : '전체 시작';
    startBtn.disabled = isQueueRunning || runnable.length === 0;
    clearDoneBtn.disabled = isQueueRunning || !hasDone;
    clearBtn.disabled = isQueueRunning || Queue.getAll().length === 0;
  }
};

function itemButton(action, id, label, className) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${className} btn-sm`;
  btn.dataset.action = action;
  btn.dataset.id = id;
  btn.textContent = label;
  return btn;
}

function statusLabel(status) {
  return ({
    waiting: '대기 중',
    loading: '정보 불러오는 중',
    running: '변환 중',
    done: '완료',
    error: '실패',
    cancelled: '취소됨'
  })[status] || status;
}

// ── Conversion flow ───────────────────────────────────────────────────
function getConversionOptions() {
  const settings = Settings.get();
  return {
    quality: document.getElementById('quality-select').value,
    format: document.getElementById('format-select').value,
    embedThumb: document.getElementById('embed-thumb').checked,
    embedMeta: document.getElementById('embed-meta').checked,
    savePath: Settings.getActiveSavePath(),
    proxy: settings.useProxy ? settings.proxy : '',
    rateLimit: settings.useRateLimit ? `${settings.rateLimitVal}${settings.rateLimitUnit}` : ''
  };
}

function clearAcceptedInput(analysis) {
  const input = document.getElementById('url-input');
  input.value = analysis.invalid.length > 0 ? analysis.invalid.join('\n') : '';
  resizeUrlInput();
  updateUrlAnalysisView();
}

function beginConvert() {
  if (isQueueRunning) {
    Toast.show('현재 변환이 진행 중입니다.', 'warning');
    return;
  }

  const analysis = analyzeUrlInput();
  if (analysis.valid.length === 0) {
    Toast.show('변환할 YouTube URL을 입력하세요.', 'warning');
    updateUrlAnalysisView();
    return;
  }

  if (!Settings.getActiveSavePath()) {
    Toast.show('저장 위치를 먼저 선택하세요.', 'warning');
    return;
  }

  const added = Queue.add(analysis.valid.map(item => ({
    url: item.url,
    urlKey: item.key
  })));

  QueueUI.render();
  clearAcceptedInput(analysis);

  if (analysis.duplicateCount > 0 && analysis.invalid.length === 0) {
    Toast.show(`중복 URL ${analysis.duplicateCount}개는 제외했습니다.`, 'info');
  }
  if (analysis.invalid.length > 0) {
    Toast.show(`잘못된 URL ${analysis.invalid.length}개는 입력창에 남겨두었습니다.`, 'warning', 6000);
  }

  void runQueue(added.map(item => item.id));
}

async function loadItemInfo(item) {
  QueueUI.updateItem(item.id, { status: 'loading', pct: 2, eta: '정보 불러오는 중', errorMsg: '' });

  try {
    const info = await YTDlp.getVideoInfo(item.url);
    QueueUI.updateItem(item.id, {
      title: info.title || item.title,
      thumbnail: info.thumbnail || item.thumbnail,
      duration: info.duration || '',
      uploader: info.uploader || ''
    });
  } catch {
    QueueUI.updateItem(item.id, {
      title: item.title || item.url,
      eta: '정보 없이 변환 준비 중'
    });
  }
}

async function runQueueItem(id, options) {
  const initial = Queue.getById(id);
  if (!initial) return 'skipped';

  await loadItemInfo(initial);

  const afterInfo = Queue.getById(id);
  if (!afterInfo || afterInfo.status === 'cancelled') return 'cancelled';

  cancelRequested = false;
  cancelController = new AbortController();
  currentItemId = id;
  QueueUI.updateItem(id, {
    status: 'running',
    pct: Math.max(afterInfo.pct || 0, 3),
    speed: '',
    eta: '변환 시작 중',
    errorMsg: ''
  });

  try {
    const filePath = await YTDlp.download({
      url: afterInfo.url,
      quality: options.quality,
      format: options.format,
      savePath: options.savePath,
      embedThumb: options.embedThumb,
      embedMeta: options.embedMeta,
      proxy: options.proxy,
      rateLimit: options.rateLimit,
      signal: cancelController.signal,
      onProgress: (pct, speed, eta, phase) => {
        const statusText = phase === 'convert' ? 'MP3 변환 중' : (eta || '다운로드 중');
        QueueUI.updateItem(id, {
          status: 'running',
          pct,
          speed: speed || '',
          eta: statusText
        });
      }
    });

    QueueUI.updateItem(id, {
      status: 'done',
      pct: 100,
      speed: '',
      eta: '',
      errorMsg: '',
      filePath
    });
    return 'done';
  } catch (e) {
    if (e.message === 'CANCELLED' || cancelRequested) {
      QueueUI.updateItem(id, {
        status: 'cancelled',
        pct: 0,
        speed: '',
        eta: '',
        errorMsg: '사용자가 취소했습니다.'
      });
      return 'cancelled';
    }

    QueueUI.updateItem(id, {
      status: 'error',
      speed: '',
      eta: '',
      errorMsg: e.message || '변환에 실패했습니다.'
    });
    return 'error';
  } finally {
    cancelController = null;
    cancelRequested = false;
    currentItemId = null;
  }
}

async function runQueue(ids = null) {
  if (isQueueRunning) {
    Toast.show('이미 변환이 진행 중입니다.', 'warning');
    return;
  }

  const targets = ids
    ? ids.map(id => Queue.getById(id)).filter(Boolean)
    : Queue.getRunnable();

  if (!targets.length) {
    Toast.show('변환할 대기열 항목이 없습니다.', 'warning');
    return;
  }

  const options = getConversionOptions();
  if (!options.savePath) {
    Toast.show('저장 위치를 먼저 선택하세요.', 'warning');
    return;
  }

  try { await Neutralino.filesystem.createDirectory(options.savePath); } catch {}

  isQueueRunning = true;
  updateConvertButton();
  QueueUI.updateToolbar();

  let doneCount = 0;
  let errorCount = 0;
  let cancelledCount = 0;
  let lastFilePath = '';

  try {
    for (const target of targets) {
      const item = Queue.getById(target.id);
      if (!item || !['waiting', 'error', 'cancelled'].includes(item.status)) continue;

      const result = await runQueueItem(item.id, options);
      const latest = Queue.getById(item.id);
      if (result === 'done') {
        doneCount += 1;
        lastFilePath = latest?.filePath || lastFilePath;
      } else if (result === 'cancelled') {
        cancelledCount += 1;
      } else if (result === 'error') {
        errorCount += 1;
      }
    }
  } finally {
    isQueueRunning = false;
    updateUrlAnalysisView();
    QueueUI.render();
  }

  if (doneCount > 0) {
    Toast.show(
      doneCount === 1 ? '다운로드 완료' : `${doneCount}개 다운로드 완료`,
      'success',
      3000,
      lastFilePath ? { label: '저장 폴더 열기', onClick: () => openContainingFolder(lastFilePath) } : null
    );
  }

  if (errorCount > 0) {
    Toast.show(`실패한 항목 ${errorCount}개가 있습니다.`, 'warning', 6000);
  }
  if (cancelledCount > 0 && doneCount === 0 && errorCount === 0) {
    Toast.show('변환이 취소되었습니다.', 'warning');
  }
}

async function openDownloadedFile(filePath) {
  if (!filePath) {
    Toast.show('열 수 있는 파일 경로가 없습니다.', 'warning');
    return;
  }

  try {
    await Neutralino.os.open(filePath);
  } catch {
    await openContainingFolder(filePath);
  }
}

async function openContainingFolder(filePath) {
  const dir = String(filePath || '').replace(/[\\/][^\\/]+$/, '');
  if (!dir) return;
  try {
    await Neutralino.os.open(dir);
  } catch {
    Toast.show('저장 폴더를 열 수 없습니다.', 'error');
  }
}

function handleQueueAction(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const item = Queue.getById(id);
  const action = btn.dataset.action;

  if (action === 'cancel') {
    if (currentItemId === id && cancelController) {
      cancelRequested = true;
      cancelController.abort();
      void YTDlp.cancelActiveDownload();
    } else {
      QueueUI.updateItem(id, { status: 'cancelled', errorMsg: '사용자가 취소했습니다.' });
    }
    return;
  }

  if (!item) return;

  if (action === 'retry') {
    Queue.resetForRetry(id);
    QueueUI.render();
    if (!isQueueRunning) void runQueue([id]);
  } else if (action === 'open') {
    void openDownloadedFile(item.filePath);
  } else if (action === 'remove') {
    Queue.remove(id);
    QueueUI.render();
    updateUrlAnalysisView();
  }
}

// ── Event binding ─────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

function initConvertScreen() {
  const input = document.getElementById('url-input');

  input.addEventListener('input', () => {
    resizeUrlInput();
    updateUrlAnalysisView();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      beginConvert();
    }
  });

  document.getElementById('paste-btn').addEventListener('click', async () => {
    try {
      const text = (await Neutralino.clipboard.readText()).trim();
      if (!text) return;
      input.value = input.value.trim() ? `${input.value.trim()}\n${text}` : text;
      resizeUrlInput();
      updateUrlAnalysisView();
    } catch {
      Toast.show('클립보드 읽기 실패', 'error');
    }
  });

  document.getElementById('convert-btn').addEventListener('click', beginConvert);
  document.getElementById('queue-list').addEventListener('click', handleQueueAction);
  document.getElementById('start-all-btn').addEventListener('click', () => void runQueue());
  document.getElementById('clear-completed-btn').addEventListener('click', () => {
    Queue.removeByStatus(['done']);
    QueueUI.render();
    updateUrlAnalysisView();
  });
  document.getElementById('clear-queue-btn').addEventListener('click', () => {
    if (isQueueRunning) return;
    Queue.clear();
    QueueUI.render();
    updateUrlAnalysisView();
  });

  resizeUrlInput();
  updateUrlAnalysisView();
  QueueUI.render();
}

function initSettingsTab() {
  const folderBtns = [
    { btn: 'local-path-btn',  display: 'local-path-display',  key: 'localPath',  title: '저장 폴더 선택' },
    { btn: 'pcloud-path-btn', display: 'pcloud-path-display', key: 'pcloudPath', title: 'pCloud 폴더 선택' },
    { btn: 'gdrive-path-btn', display: 'gdrive-path-display', key: 'gdrivePath', title: 'Google Drive 폴더 선택' }
  ];

  folderBtns.forEach(({ btn, display, key, title }) => {
    document.getElementById(btn).addEventListener('click', async () => {
      try {
        const p = await Neutralino.os.showFolderDialog(title);
        if (p) {
          document.getElementById(display).textContent = p;
          await Settings.save({ [key]: p });
        }
      } catch {}
    });
  });

  document.querySelectorAll('input[name="save-dest"]').forEach(r => {
    r.addEventListener('change', () => Settings.save({ saveDest: r.value }));
  });

  document.getElementById('install-ffmpeg-btn').addEventListener('click', async () => {
    Toast.show('ffmpeg 확인 중…', 'info');
    const deps = await YTDlp.checkDeps({ refresh: true });
    UI.updateDepsStatus(deps);
    Toast.show(
      deps.ffmpeg.ok ? `ffmpeg ${deps.ffmpeg.version}` : 'ffmpeg를 찾을 수 없습니다. npm install을 실행하세요.',
      deps.ffmpeg.ok ? 'success' : 'error'
    );
  });

  document.getElementById('update-ytdlp-btn').addEventListener('click', async () => {
    document.getElementById('update-ytdlp-btn').disabled = true;
    await YTDlp.updateYtdlp(msg => Toast.show(msg, 'info'));
    document.getElementById('update-ytdlp-btn').disabled = false;
    const deps = await YTDlp.checkDeps({ refresh: true });
    UI.updateDepsStatus(deps);
  });

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const dest = document.querySelector('input[name="save-dest"]:checked')?.value || 'local';
    const quality = document.getElementById('quality-select')?.value || '192';
    const format  = document.getElementById('format-select')?.value || 'mp3';
    const embedThumb = document.getElementById('embed-thumb')?.checked ?? true;
    const embedMeta  = document.getElementById('embed-meta')?.checked ?? true;
    await Settings.save({ saveDest: dest, quality, format, embedThumb, embedMeta });
    Toast.show('설정이 저장되었습니다.', 'success');
  });
}

function applySettingsToUI(s) {
  if (s.localPath)  document.getElementById('local-path-display').textContent  = s.localPath;
  if (s.pcloudPath) document.getElementById('pcloud-path-display').textContent = s.pcloudPath;
  if (s.gdrivePath) document.getElementById('gdrive-path-display').textContent = s.gdrivePath;

  const radio = document.querySelector(`input[name="save-dest"][value="${s.saveDest}"]`);
  if (radio) radio.checked = true;
  if (s.quality) document.getElementById('quality-select').value = s.quality;
  if (s.format) document.getElementById('format-select').value = s.format;
  document.getElementById('embed-thumb').checked = !!s.embedThumb;
  document.getElementById('embed-meta').checked  = !!s.embedMeta;
}

async function ensureDefaultLocalPath(s) {
  if (s.localPath) return s;

  const preferredPaths = ['music', 'downloads', 'documents'];
  for (const name of preferredPaths) {
    try {
      const path = await Neutralino.os.getPath(name);
      if (path) return await Settings.save({ localPath: path });
    } catch {}
  }
  return s;
}

// ── App init ──────────────────────────────────────────────────────────
Neutralino.init();
Neutralino.events.on('windowClose', () => Neutralino.app.exit());

(async () => {
  let hadDepCache = false;
  try {
    hadDepCache = UI.restoreDepsStatus();
    let s = await Settings.load();
    s = await ensureDefaultLocalPath(s);
    applySettingsToUI(s);
  } catch {}

  initTabs();
  initConvertScreen();
  initSettingsTab();

  if (!hadDepCache) {
    try {
      const deps = await YTDlp.checkDeps();
      UI.updateDepsStatus(deps);
      if (!deps.ytdlp.ok) {
        Toast.show('yt-dlp를 찾을 수 없습니다. 설정 탭에서 업데이트하세요.', 'warning', 6000);
      }
    } catch {
      // Dependency status is non-blocking.
    }
  }
})();
