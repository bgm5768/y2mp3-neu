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
let dependencyInstallPromise = null;
let currentDepsStatus = {
  ffmpeg: { ok: false, version: '' },
  ytdlp: { ok: false, version: '' }
};
let currentUrlAnalysis = {
  valid: [],
  duplicateCount: 0,
  invalid: []
};

// ── UI helpers ─────────────────────────────────────────────────────────
const UI = {
  updateDepsStatus({ ffmpeg, ytdlp }) {
    const ffmpegVer = document.getElementById('ffmpeg-version');
    const ytdlpVer  = document.getElementById('ytdlp-version');
    const ffmpegPath = document.getElementById('ffmpeg-path');
    const ytdlpPath  = document.getElementById('ytdlp-path');

    if (ffmpeg) {
      currentDepsStatus.ffmpeg = { ok: !!ffmpeg.ok, version: ffmpeg.version || '', path: ffmpeg.path || '' };
      if (ffmpegVer) {
        const ver = ffmpeg.ok ? (ffmpeg.version || '버전 확인됨') : '';
        ffmpegVer.className = `dep-version ${ffmpeg.ok ? 'status-ok' : 'status-error'}`;
        ffmpegVer.textContent = ffmpeg.ok ? `정상 설치됨 · ${ver}` : '필수 의존성 없음 · 설치 필요';
      }
      if (ffmpegPath) {
        ffmpegPath.textContent = ffmpeg.ok && ffmpeg.path ? `설치 위치: ${ffmpeg.path}` : '설치 위치: 아직 없음';
        ffmpegPath.title = ffmpeg.path || '';
      }
    }
    if (ytdlp) {
      currentDepsStatus.ytdlp = { ok: !!ytdlp.ok, version: ytdlp.version || '', path: ytdlp.path || '' };
      if (ytdlpVer) {
        const ver = ytdlp.ok ? (ytdlp.version || '버전 확인됨') : '';
        ytdlpVer.className = `dep-version ${ytdlp.ok ? 'status-ok' : 'status-error'}`;
        ytdlpVer.textContent = ytdlp.ok ? `정상 설치됨 · ${ver}` : '필수 의존성 없음 · 설치 필요';
      }
      if (ytdlpPath) {
        ytdlpPath.textContent = ytdlp.ok && ytdlp.path ? `설치 위치: ${ytdlp.path}` : '설치 위치: 아직 없음';
        ytdlpPath.title = ytdlp.path || '';
      }
    }

    updateDependencyGate();

    try {
      localStorage.setItem('yt_mp3_dep_status', JSON.stringify({
        ffmpeg: ffmpeg ? { ok: !!ffmpeg.ok, version: ffmpeg.version || '', path: ffmpeg.path || '' } : null,
        ytdlp:  ytdlp  ? { ok: !!ytdlp.ok,  version: ytdlp.version  || '', path: ytdlp.path || '' } : null
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

function depsReady() {
  return !!(currentDepsStatus.ffmpeg?.ok && currentDepsStatus.ytdlp?.ok);
}

function setDependencyProgress(tool, payload, visible = true) {
  const wrap = document.getElementById(`${tool}-install-progress`);
  const bar = document.getElementById(`${tool}-install-bar`);
  const text = document.getElementById(`${tool}-install-text`);
  if (!wrap || !bar || !text) return;

  const progress = typeof payload === 'object' && payload !== null
    ? payload
    : { message: String(payload || '') };
  const pct = Number.isFinite(Number(progress.pct)) ? Math.max(0, Math.min(100, Number(progress.pct))) : null;

  wrap.classList.toggle('hidden', !visible);
  wrap.classList.toggle('is-indeterminate', pct === null);
  bar.style.width = pct === null ? '35%' : `${pct}%`;
  text.textContent = `${progress.message || '진행 중…'}${pct === null ? '' : ` · ${Math.round(pct)}%`}`;
}

function updateDependencyGate() {
  const ready = depsReady();
  const convertNav = document.querySelector('.nav-btn[data-tab="convert"]');
  const summary = document.getElementById('dependency-summary');
  const reason = '설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.';

  if (convertNav) {
    convertNav.disabled = !ready;
    convertNav.classList.toggle('is-disabled', !ready);
    convertNav.title = ready ? '' : reason;
    convertNav.setAttribute('aria-disabled', ready ? 'false' : 'true');
  }

  if (summary) {
    summary.classList.toggle('status-ok', ready);
    summary.classList.toggle('status-error', !ready);
    summary.textContent = ready
      ? '필수 의존성 도구가 모두 정상 설치되어 변환 기능을 사용할 수 있습니다.'
      : reason;
  }

  updateConvertButton();
}

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
  if (!btn) return;
  if (!depsReady()) {
    btn.textContent = '의존성 도구 설치 필요';
    btn.disabled = true;
    btn.title = '설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.';
    return;
  }
  btn.title = '';

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
    embedThumb: true,
    embedMeta: true,
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
  if (!depsReady()) {
    Toast.show('설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.', 'error', 6000);
    return;
  }

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

  isQueueRunning = true;
  updateConvertButton();
  QueueUI.updateToolbar();

  let doneCount = 0;
  let errorCount = 0;
  let cancelledCount = 0;
  let lastFilePath = '';

  try {
    await ensureRequiredToolsInstalled();
    try { await Neutralino.filesystem.createDirectory(options.savePath); } catch {}

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
  } catch (e) {
    targets.forEach(target => {
      const item = Queue.getById(target.id);
      if (item && ['waiting', 'error', 'cancelled'].includes(item.status)) {
        QueueUI.updateItem(item.id, {
          status: 'error',
          errorMsg: `필수 도구 준비 실패: ${e.message || e}`
        });
      }
    });
    Toast.show(`필수 도구 준비 실패: ${e.message || e}`, 'error', 8000);
  } finally {
    isQueueRunning = false;
    updateUrlAnalysisView();
    QueueUI.render();
  }

  if (doneCount > 0) {
    Player.invalidate();
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

// ── Player ────────────────────────────────────────────────────────────
const Player = (() => {
  const audioExts = /\.(mp3|m4a|wav|ogg|opus|aac|flac)$/i;
  const playableExts = new Set(['mp3', 'm4a', 'wav', 'ogg', 'opus', 'aac', 'flac']);
  const mediaStreamInitialBytes = 512 * 1024;
  const mediaStreamChunkBytes = 1024 * 1024;
  const mediaStreamMaxBufferAhead = 120;
  const mediaStreamKeepBehind = 45;
  const mp3Bitrates = {
    V1L1: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
    V1L2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
    V1L3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
    V2L1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
    V2L2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
    V2L3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
  };
  const state = {
    initialized: false,
    loadedPath: '',
    tracks: [],
    queue: [],
    queuePosition: -1,
    searchQuery: '',
    sortKey: 'title',
    sortDirection: 'asc',
    sortMetricLoading: false,
    durationHydrationToken: 0,
    orderMode: 'normal',
    repeatMode: 'stop-current',
    objectUrl: '',
    coverObjectUrl: '',
    coverTrackId: '',
    sourceTrackId: '',
    streamSession: null,
    streamInfoPromises: new Map(),
    isLoadingTrack: false,
    isSeeking: false,
    isStreamSeeking: false,
    seekPreviewTime: null,
    restoredPreviewTime: null,
    metadataPromises: new Map(),
    lastSavedPositionAt: 0,
    saveTimer: null,
    pendingSave: {},
    restoredLastTrack: false,
    restoringPosition: null,
    openMenuTrackId: ''
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function setPlayerLoading(isLoading) {
    document.querySelector('.player-card')?.classList.toggle('is-loading', !!isLoading);
  }

  function savePlayerSettings(patch, { immediate = false } = {}) {
    state.pendingSave = { ...state.pendingSave, ...patch };

    const flush = () => {
      const next = { ...state.pendingSave };
      state.pendingSave = {};
      state.saveTimer = null;
      void Settings.save(next).catch(() => {});
    };

    if (immediate) {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      flush();
      return;
    }

    if (!state.saveTimer) {
      state.saveTimer = setTimeout(flush, 600);
    }
  }

  function applySavedPlayerSettings() {
    const settings = Settings.get();
    const volume = Number.isFinite(Number(settings.playerVolume))
      ? Math.min(1, Math.max(0, Number(settings.playerVolume)))
      : 0.9;

    state.orderMode = settings.playerOrderMode || state.orderMode;
    state.repeatMode = settings.playerRepeatMode || state.repeatMode;
    state.restoringPosition = Math.max(0, Number(settings.playerLastPosition) || 0);

    const volumeEl = el('player-volume');
    const orderEl = el('player-order-select');
    const repeatEl = el('player-repeat-select');
    const audio = el('audio-player');

    if (volumeEl) volumeEl.value = String(volume);
    if (audio) audio.volume = volume;
    if (orderEl) orderEl.value = state.orderMode;
    if (repeatEl) repeatEl.value = state.repeatMode;
    updateSortControls();
  }

  function ensureListDom() {
    const tab = el('tab-player');

    if (!el('player-summary') && tab) {
      const header = document.createElement('div');
      header.className = 'player-list-header';
      const heading = document.createElement('div');
      heading.className = 'player-list-heading';
      const title = document.createElement('h2');
      title.textContent = '음악 목록';
      const summary = document.createElement('p');
      summary.id = 'player-summary';
      summary.className = 'queue-summary';
      summary.textContent = '음악 파일 0개';
      heading.append(title, summary);
      const toolbar = document.createElement('div');
      toolbar.className = 'player-list-toolbar';
      const searchWrap = document.createElement('div');
      searchWrap.className = 'player-search-wrap';
      const searchIcon = document.createElement('span');
      searchIcon.className = 'player-search-icon';
      searchIcon.setAttribute('aria-hidden', 'true');
      searchIcon.textContent = '⌕';
      const search = document.createElement('input');
      search.id = 'player-search';
      search.className = 'player-search';
      search.type = 'search';
      search.placeholder = '음악 검색';
      search.autocomplete = 'off';
      search.spellcheck = false;
      searchWrap.append(searchIcon, search);
      const tools = document.createElement('div');
      tools.className = 'player-list-tools';
      const sortLabel = document.createElement('label');
      sortLabel.className = 'player-sort-label';
      sortLabel.setAttribute('for', 'player-sort-select');
      sortLabel.textContent = '정렬';
      const sortSelect = document.createElement('select');
      sortSelect.id = 'player-sort-select';
      sortSelect.className = 'player-sort-select';
      [
        ['title', '제목순'],
        ['duration', '재생시간순']
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        sortSelect.appendChild(option);
      });
      const sortDir = document.createElement('button');
      sortDir.id = 'player-sort-dir-btn';
      sortDir.className = 'player-sort-dir-btn';
      sortDir.type = 'button';
      sortDir.title = '정렬 방향 변경';
      sortDir.setAttribute('aria-label', '정렬 방향 변경');
      sortDir.textContent = '오름차순';
      tools.append(sortLabel, sortSelect, sortDir);
      toolbar.append(searchWrap, tools);
      header.append(heading, toolbar);
      tab.appendChild(header);
    }

    if (!el('player-empty') && tab) {
      const empty = document.createElement('div');
      empty.id = 'player-empty';
      empty.className = 'queue-empty hidden';
      empty.textContent = '현재 저장 위치에서 재생 가능한 음악 파일을 찾지 못했습니다.';
      tab.appendChild(empty);
    }

    if (!el('player-list') && tab) {
      const list = document.createElement('div');
      list.id = 'player-list';
      list.className = 'player-list';
      tab.appendChild(list);
    }

    return {
      list: el('player-list'),
      empty: el('player-empty'),
      summary: el('player-summary')
    };
  }

  function joinPath(base, child) {
    return `${String(base || '').replace(/[\\/]+$/, '')}\\${String(child || '').replace(/^[\\/]+/, '')}`;
  }

  function isAbsolutePath(path) {
    return /^[a-zA-Z]:[\\/]/.test(path || '') || /^\\\\/.test(path || '');
  }

  function resolveEntryPath(root, entry) {
    const entryName = entry.entry || '';
    const directPath = entry.path || '';

    if (isAbsolutePath(entryName)) {
      return entryName;
    }

    if (directPath && audioExts.test(directPath)) {
      return isAbsolutePath(directPath) ? directPath : joinPath(root, directPath);
    }

    if (directPath && isAbsolutePath(directPath)) {
      return joinPath(directPath, entryName);
    }

    if (directPath) {
      return joinPath(root, directPath.endsWith(entryName) ? directPath : joinPath(directPath, entryName));
    }

    return joinPath(root, entryName);
  }

  function isAudioEntry(entry) {
    return audioExts.test(entry.entry || '') || audioExts.test(entry.path || '');
  }

  function fileTime(raw) {
    const numeric = Number(raw);
    if (numeric) return numeric < 10000000000 ? numeric * 1000 : numeric;
    return Date.parse(raw) || 0;
  }

  function fileName(path) {
    return String(path || '').split(/[\\/]/).pop() || '';
  }

  function trackTitle(path) {
    return fileName(path).replace(/\.[^.]+$/, '') || '제목 없음';
  }

  function directoryName(path) {
    const value = String(path || '');
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return index >= 0 ? value.slice(0, index) : '';
  }

  function fileExtension(name) {
    const match = String(name || '').match(/(\.[^.]*)$/);
    return match ? match[1] : '';
  }

  function normalizeRenameFileName(input, oldFileName) {
    const oldExt = fileExtension(oldFileName);
    let base = String(input || '').trim().replace(/^["']+|["']+$/g, '');
    if (!base) {
      return { ok: false, message: '새 파일 이름을 입력해 주세요.' };
    }

    if (oldExt && base.toLowerCase().endsWith(oldExt.toLowerCase())) {
      base = base.slice(0, -oldExt.length);
    }

    const nextName = `${base}${oldExt}`;
    const invalidReason = validateFileName(nextName);
    return invalidReason ? { ok: false, message: invalidReason } : { ok: true, name: nextName };
  }

  function validateFileName(name) {
    const value = String(name || '');
    if (!value.trim()) return '새 파일 이름을 입력해 주세요.';
    if (/[<>:"/\\|?*\x00-\x1f]/.test(value)) return '파일 이름에 사용할 수 없는 문자가 포함되어 있습니다.';
    if (/[. ]$/.test(value)) return '파일 이름은 공백이나 점으로 끝날 수 없습니다.';
    if (value === '.' || value === '..') return '사용할 수 없는 파일 이름입니다.';
    const base = value.replace(/\.[^.]*$/, '').toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) return 'Windows 예약어는 파일 이름으로 사용할 수 없습니다.';
    return '';
  }

  async function pathExists(path) {
    try {
      await Neutralino.filesystem.getStats(path);
      return true;
    } catch {
      return false;
    }
  }

  function mimeType(path) {
    const ext = fileName(path).split('.').pop()?.toLowerCase() || '';
    return ({
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      aac: 'audio/aac',
      flac: 'audio/flac'
    })[ext] || 'audio/mpeg';
  }

  function parseMp3FrameHeader(bytes, offset) {
    if (offset + 4 > bytes.length) return null;
    const b1 = bytes[offset];
    const b2 = bytes[offset + 1];
    const b3 = bytes[offset + 2];
    const b4 = bytes[offset + 3];
    if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;

    const versionBits = (b2 >> 3) & 0x03;
    const layerBits = (b2 >> 1) & 0x03;
    const bitrateIndex = (b3 >> 4) & 0x0f;
    const sampleRateIndex = (b3 >> 2) & 0x03;
    const padding = (b3 >> 1) & 0x01;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

    const version = versionBits === 3 ? 1 : 2;
    const layer = 4 - layerBits;
    const bitrateKey = `${version === 1 ? 'V1' : 'V2'}L${layer}`;
    const bitrate = (mp3Bitrates[bitrateKey]?.[bitrateIndex] || 0) * 1000;
    const sampleRateBase = [44100, 48000, 32000][sampleRateIndex];
    const sampleRate = version === 1 ? sampleRateBase : sampleRateBase / (versionBits === 2 ? 2 : 4);
    if (!bitrate || !sampleRate) return null;

    const frameLength = layer === 1
      ? Math.floor(((12 * bitrate / sampleRate) + padding) * 4)
      : Math.floor(((version === 1 && layer === 3 ? 144 : 72) * bitrate / sampleRate) + padding);

    return {
      bitrate,
      sampleRate,
      frameLength,
      offset,
      version,
      layer,
      channelMode: (b4 >> 6) & 0x03,
      samplesPerFrame: layer === 1 ? 384 : (layer === 3 && version !== 1 ? 576 : 1152)
    };
  }

  function findMp3FrameInBytes(bytes, start = 0) {
    for (let i = Math.max(0, start); i + 4 < bytes.length; i += 1) {
      const frame = parseMp3FrameHeader(bytes, i);
      if (!frame || frame.frameLength <= 4 || i + frame.frameLength + 4 >= bytes.length) continue;
      const next = parseMp3FrameHeader(bytes, i + frame.frameLength);
      if (next) return frame;
    }
    return null;
  }

  async function getMp3StreamInfo(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo;
    if (state.streamInfoPromises.has(track.id)) return state.streamInfoPromises.get(track.id);

    const promise = (async () => {
      const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
      let audioStart = 0;
      const id3Header = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: Math.min(10, totalSize) }));
      if (decodeLatin1(id3Header.slice(0, 3)) === 'ID3' && id3Header.length >= 10) {
        audioStart = Math.min(syncSafeToInt(id3Header, 6) + 10, Math.max(0, totalSize - 4));
      }

      const scanSize = Math.min(512 * 1024, totalSize - audioStart);
      if (scanSize <= 0) throw new Error('MP3 오디오 데이터를 찾을 수 없습니다.');
      const scan = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: audioStart, size: scanSize }));
      const firstFrame = findMp3FrameInBytes(scan, 0);
      if (!firstFrame) throw new Error('MP3 프레임 정보를 찾을 수 없습니다.');

      audioStart += firstFrame.offset;
      const audioBytes = Math.max(0, totalSize - audioStart);
      const vbrDuration = mp3VbrDuration(scan, firstFrame);
      const duration = vbrDuration || (audioBytes > 0 ? (audioBytes * 8) / firstFrame.bitrate : 0);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('MP3 재생시간을 계산할 수 없습니다.');
      track.streamInfo = {
        audioStart,
        bitrate: firstFrame.bitrate,
        duration,
        totalSize
      };
      const settings = Settings.get();
      const isLastTrack = track.id === String(settings.playerLastTrackId || '').toLowerCase()
        || track.path.toLowerCase() === String(settings.playerLastTrackPath || '').toLowerCase();
      if (isLastTrack) {
        savePlayerSettings({ playerLastDuration: duration }, { immediate: true });
      }
      return track.streamInfo;
    })().finally(() => {
      state.streamInfoPromises.delete(track.id);
    });

    state.streamInfoPromises.set(track.id, promise);
    return promise;
  }

  async function findFrameOffsetNear(track, approxOffset) {
    const info = await getMp3StreamInfo(track);
    const totalSize = info.totalSize || Number(track.size) || 0;
    const windowStart = Math.max(info.audioStart, Math.floor(approxOffset) - 4096);
    const size = Math.min(256 * 1024, totalSize - windowStart);
    if (size <= 0) return info.audioStart;

    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: windowStart, size }));
    const frame = findMp3FrameInBytes(bytes, windowStart === info.audioStart ? 0 : 4096);
    return frame ? windowStart + frame.offset : Math.max(info.audioStart, Math.floor(approxOffset));
  }

  function clearAudioSource(audio) {
    if (state.streamSession) {
      state.streamSession.cancelled = true;
      state.streamSession = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    state.sourceTrackId = '';
  }

  async function loadTrackAsBlob(audio, track, shouldPlay, options = {}) {
    if (!options.suppressStatus) setText('player-status-pill', '파일 준비 중');
    const bytes = await Neutralino.filesystem.readBinaryFile(track.path);

    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    state.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType(track.path) }));
    audio.src = state.objectUrl;
    audio.load();
    state.sourceTrackId = track.id;
    if (shouldPlay) await audio.play();
  }

  function waitForSourceOpen(mediaSource) {
    if (mediaSource.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        mediaSource.removeEventListener('sourceopen', onOpen);
        mediaSource.removeEventListener('sourceended', onError);
        mediaSource.removeEventListener('sourceclose', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('media source closed'));
      };
      mediaSource.addEventListener('sourceopen', onOpen, { once: true });
      mediaSource.addEventListener('sourceended', onError, { once: true });
      mediaSource.addEventListener('sourceclose', onError, { once: true });
    });
  }

  function appendSourceBuffer(sourceBuffer, bytes, session) {
    if (session.cancelled) return Promise.reject(new Error('stream cancelled'));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        sourceBuffer.removeEventListener('updateend', onDone);
        sourceBuffer.removeEventListener('error', onError);
        sourceBuffer.removeEventListener('abort', onError);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('source buffer append failed'));
      };

      sourceBuffer.addEventListener('updateend', onDone, { once: true });
      sourceBuffer.addEventListener('error', onError, { once: true });
      sourceBuffer.addEventListener('abort', onError, { once: true });
      sourceBuffer.appendBuffer(bytes);
    });
  }

  function removeSourceBuffer(sourceBuffer, start, end, session) {
    if (session.cancelled || end <= start || sourceBuffer.updating) return Promise.resolve();

    return new Promise(resolve => {
      const cleanup = () => {
        sourceBuffer.removeEventListener('updateend', onDone);
        sourceBuffer.removeEventListener('error', onDone);
        sourceBuffer.removeEventListener('abort', onDone);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };

      sourceBuffer.addEventListener('updateend', onDone, { once: true });
      sourceBuffer.addEventListener('error', onDone, { once: true });
      sourceBuffer.addEventListener('abort', onDone, { once: true });
      try {
        sourceBuffer.remove(start, end);
      } catch {
        cleanup();
        resolve();
      }
    });
  }

  function bufferedAhead(audio) {
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    for (let i = 0; i < audio.buffered.length; i += 1) {
      const start = audio.buffered.start(i);
      const end = audio.buffered.end(i);
      if (current >= start && current <= end) return end - current;
      if (current < start) return end - start;
    }
    return 0;
  }

  async function waitForBufferRoom(audio, session) {
    while (!session.cancelled && bufferedAhead(audio) > mediaStreamMaxBufferAhead) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async function pruneOldBuffer(audio, sourceBuffer, session) {
    if (!audio.buffered.length || sourceBuffer.updating) return;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const removeBefore = current - mediaStreamKeepBehind;
    if (removeBefore <= 0) return;

    for (let i = 0; i < audio.buffered.length; i += 1) {
      const start = audio.buffered.start(i);
      const end = Math.min(audio.buffered.end(i), removeBefore);
      if (end > start) {
        await removeSourceBuffer(sourceBuffer, start, end, session);
        return;
      }
    }
  }

  async function loadTrackAsMediaStream(audio, track, shouldPlay, startTime = 0, options = {}) {
    if (!window.MediaSource || !MediaSource.isTypeSupported('audio/mpeg') || !/\.mp3$/i.test(track.path)) {
      throw new Error('progressive mp3 streaming is not supported');
    }

    const totalSize = Number(track.size) || 0;
    if (!totalSize) throw new Error('unknown file size');
    const streamInfo = await getMp3StreamInfo(track);
    if (!streamInfo.duration) throw new Error('unknown stream duration');
    const safeStartTime = Math.max(0, Math.min(Number(startTime) || 0, Math.max(0, streamInfo.duration - 1)));
    const approxOffset = streamInfo.audioStart + ((safeStartTime / streamInfo.duration) * (totalSize - streamInfo.audioStart));
    const startOffset = safeStartTime > 0 ? await findFrameOffsetNear(track, approxOffset) : streamInfo.audioStart;

    const session = { cancelled: false };
    state.streamSession = session;

    const mediaSource = new MediaSource();
    state.objectUrl = URL.createObjectURL(mediaSource);
    audio.src = state.objectUrl;
    audio.load();
    state.sourceTrackId = track.id;
    if (!options.suppressStatus) setText('player-status-pill', '스트리밍 준비 중');

    await waitForSourceOpen(mediaSource);
    if (session.cancelled) return;
    mediaSource.duration = streamInfo.duration;

    const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    sourceBuffer.mode = 'sequence';
    sourceBuffer.timestampOffset = safeStartTime;

    const firstSize = Math.min(mediaStreamInitialBytes, totalSize - startOffset);
    const firstBytes = await Neutralino.filesystem.readBinaryFile(track.path, { pos: startOffset, size: firstSize });
    await appendSourceBuffer(sourceBuffer, firstBytes, session);

    if (session.cancelled) return;
    if (safeStartTime > 0) audio.currentTime = safeStartTime;
    if (!options.suppressStatus) setText('player-status-pill', shouldPlay ? '지금 재생 중' : '재생 준비 완료');
    if (shouldPlay) await audio.play();

    void (async () => {
      for (let pos = startOffset + firstSize; pos < totalSize && !session.cancelled; pos += mediaStreamChunkBytes) {
        await waitForBufferRoom(audio, session);
        await pruneOldBuffer(audio, sourceBuffer, session);
        const size = Math.min(mediaStreamChunkBytes, totalSize - pos);
        const bytes = await Neutralino.filesystem.readBinaryFile(track.path, { pos, size });
        await appendSourceBuffer(sourceBuffer, bytes, session);
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (!session.cancelled && mediaSource.readyState === 'open' && !sourceBuffer.updating) {
        try { mediaSource.endOfStream(); } catch {}
      }
    })().catch(() => {});
  }

  async function loadTrackSource(audio, track, shouldPlay, options = {}) {
    if (!track.size) {
      try {
        const stats = await Neutralino.filesystem.getStats(track.path);
        track.size = Number(stats.size) || 0;
        track.modifiedAt = fileTime(stats.modifiedAt) || track.modifiedAt;
      } catch {}
    }

    if (/\.mp3$/i.test(track.path)) {
      try {
        await loadTrackAsMediaStream(audio, track, shouldPlay, options.startTime || 0, options);
        return;
      } catch {
        clearAudioSource(audio);
        if (Number(track.size) > 512 * 1024 * 1024) {
          throw new Error('스트리밍 재생을 시작할 수 없습니다.');
        }
      }
    }

    await loadTrackAsBlob(audio, track, shouldPlay, options);
  }

  function formatBytes(size) {
    const value = Number(size) || 0;
    if (!value) return '';
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const min = Math.floor(safe / 60);
    const sec = String(Math.floor(safe % 60)).padStart(2, '0');
    return `${min}:${sec}`;
  }

  function displayDuration(track = currentTrack()) {
    const audio = el('audio-player');
    const streamDuration = Number(track?.streamInfo?.duration) || 0;
    if (streamDuration > 0) return streamDuration;
    const settings = Settings.get();
    const savedDuration = Number(settings.playerLastDuration) || 0;
    const savedId = String(settings.playerLastTrackId || '').toLowerCase();
    const savedPath = String(settings.playerLastTrackPath || '').toLowerCase();
    if (track && savedDuration > 0 && (track.id === savedId || track.path.toLowerCase() === savedPath)) {
      return savedDuration;
    }
    const current = currentTrack();
    return audio && track && current && track.id === current.id && Number.isFinite(audio.duration) ? audio.duration : 0;
  }

  function displayCurrentTime() {
    const audio = el('audio-player');
    if (state.seekPreviewTime !== null) return state.seekPreviewTime;
    if (state.restoredPreviewTime !== null && (!audio || !audio.src || state.isLoadingTrack)) return state.restoredPreviewTime;
    return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  }

  function syncSafeToInt(bytes, offset = 0) {
    return ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f);
  }

  function uint32be(bytes, offset = 0) {
    return ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
  }

  function uint32le(bytes, offset = 0) {
    return (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0;
  }

  function uint64beNumber(bytes, offset = 0) {
    return uint32be(bytes, offset) * 4294967296 + uint32be(bytes, offset + 4);
  }

  function decodeLatin1(bytes) {
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
  }

  function decodeUtf16(bytes, littleEndian) {
    const chars = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) continue;
      chars.push(String.fromCharCode(code));
    }
    return chars.join('');
  }

  function cleanMetadataText(value) {
    return String(value || '')
      .replace(/\u0000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeId3Text(payload) {
    if (!payload || payload.length === 0) return '';
    const encoding = payload[0];
    let bytes = payload.slice(1);

    if (encoding === 1) {
      let littleEndian = false;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        littleEndian = true;
        bytes = bytes.slice(2);
      } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        bytes = bytes.slice(2);
      }
      return cleanMetadataText(decodeUtf16(bytes, littleEndian));
    }

    if (encoding === 2) return cleanMetadataText(decodeUtf16(bytes, false));

    try {
      const decoder = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1');
      return cleanMetadataText(decoder.decode(bytes));
    } catch {
      return cleanMetadataText(decodeLatin1(bytes));
    }
  }

  function findTerminator(bytes, start, encoding) {
    if (encoding === 1 || encoding === 2) {
      for (let i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
      }
      return -1;
    }

    for (let i = start; i < bytes.length; i += 1) {
      if (bytes[i] === 0) return i;
    }
    return -1;
  }

  function parseCommentFrame(payload) {
    if (!payload || payload.length < 5) return '';
    const encoding = payload[0];
    let cursor = 4;
    const descEnd = findTerminator(payload, cursor, encoding);
    if (descEnd >= 0) cursor = descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1);
    return decodeId3Text(Uint8Array.from([encoding, ...payload.slice(cursor)]));
  }

  function parseApicFrame(payload) {
    if (!payload || payload.length < 5) return null;
    const encoding = payload[0];
    let cursor = 1;
    const mimeEnd = findTerminator(payload, cursor, 0);
    if (mimeEnd < 0) return null;
    const mime = cleanMetadataText(decodeLatin1(payload.slice(cursor, mimeEnd))) || 'image/jpeg';
    cursor = mimeEnd + 1;
    cursor += 1; // picture type
    const descEnd = findTerminator(payload, cursor, encoding);
    cursor = descEnd >= 0 ? descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1) : cursor;
    const data = payload.slice(cursor);
    return data.length ? { mime, data } : null;
  }

  async function readId3Metadata(path, size) {
    const empty = {
      title: '',
      artist: '',
      album: '',
      year: '',
      genre: '',
      track: '',
      comment: '',
      cover: null
    };

    if (!/\.mp3$/i.test(path)) return empty;

    let header;
    try {
      header = new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos: 0, size: 10 }));
    } catch {
      return empty;
    }

    if (header.length < 10 || decodeLatin1(header.slice(0, 3)) !== 'ID3') return empty;

    const version = header[3];
    const tagSize = syncSafeToInt(header, 6) + 10;
    const maxRead = Math.min(Math.max(tagSize, 10), Math.min(Number(size) || tagSize, 6 * 1024 * 1024));
    let data;
    try {
      data = new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos: 0, size: maxRead }));
    } catch {
      return empty;
    }

    const metadata = { ...empty };
    const frameMap = {
      TIT2: 'title',
      TPE1: 'artist',
      TALB: 'album',
      TDRC: 'year',
      TYER: 'year',
      TCON: 'genre',
      TRCK: 'track'
    };

    let offset = 10;
    const end = Math.min(data.length, tagSize);
    while (offset + 10 <= end) {
      const id = decodeLatin1(data.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;

      const frameSize = version === 4 ? syncSafeToInt(data, offset + 4) : uint32be(data, offset + 4);
      if (!frameSize || offset + 10 + frameSize > data.length) break;

      const payload = data.slice(offset + 10, offset + 10 + frameSize);
      if (frameMap[id]) {
        metadata[frameMap[id]] = decodeId3Text(payload);
      } else if (id === 'COMM') {
        metadata.comment = parseCommentFrame(payload);
      } else if (id === 'APIC') {
        metadata.cover = parseApicFrame(payload);
      }

      offset += 10 + frameSize;
    }

    return metadata;
  }

  function applyTrackMetadata(track, metadata) {
    if (!track || !metadata) return;

    track.title = metadata.title || track.title;
    track.artist = metadata.artist || track.artist;
    track.album = metadata.album || track.album;
    track.year = metadata.year || track.year;
    track.genre = metadata.genre || track.genre;
    track.track = metadata.track || track.track;
    track.comment = metadata.comment || track.comment;
    track.cover = metadata.cover || track.cover;
    track.metadataLoaded = true;
  }

  async function ensureTrackMetadata(track) {
    if (!track || track.metadataLoaded) return track;
    if (state.metadataPromises.has(track.id)) return state.metadataPromises.get(track.id);

    const promise = (async () => {
      try {
        if (!track.size) {
          const stats = await Neutralino.filesystem.getStats(track.path);
          track.size = Number(stats.size) || 0;
          track.modifiedAt = fileTime(stats.modifiedAt) || track.modifiedAt;
        }

        applyTrackMetadata(track, await readId3Metadata(track.path, track.size));
      } catch {
        track.metadataLoaded = true;
      } finally {
        state.metadataPromises.delete(track.id);
      }

      return track;
    })();

    state.metadataPromises.set(track.id, promise);
    return promise;
  }

  function metadataLine(track) {
    return [track.album].filter(Boolean).join(' · ');
  }

  function metadataPairs(track) {
    return [
      ['앨범', track.album],
      ['트랙', track.track],
      ['코멘트', track.comment]
    ].filter(([, value]) => !!value);
  }

  function shuffle(list) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function mp3VbrDuration(scan, frame) {
    const sideInfoSize = frame.layer === 3
      ? (frame.version === 1 ? (frame.channelMode === 3 ? 17 : 32) : (frame.channelMode === 3 ? 9 : 17))
      : 0;
    const xingOffset = frame.offset + 4 + sideInfoSize;
    const id = decodeLatin1(scan.slice(xingOffset, xingOffset + 4));
    if (id === 'Xing' || id === 'Info') {
      const flags = uint32be(scan, xingOffset + 4);
      if (flags & 0x01) {
        const frames = uint32be(scan, xingOffset + 8);
        if (frames > 0) return (frames * frame.samplesPerFrame) / frame.sampleRate;
      }
    }

    const vbriOffset = frame.offset + 36;
    if (decodeLatin1(scan.slice(vbriOffset, vbriOffset + 4)) === 'VBRI') {
      const frames = uint32be(scan, vbriOffset + 14);
      if (frames > 0) return (frames * frame.samplesPerFrame) / frame.sampleRate;
    }
    return 0;
  }

  function mp4DurationFromBytes(bytes) {
    for (let i = 4; i + 32 < bytes.length; i += 1) {
      if (decodeLatin1(bytes.slice(i, i + 4)) !== 'mvhd') continue;
      const version = bytes[i + 4];
      const timescale = version === 1 ? uint32be(bytes, i + 24) : uint32be(bytes, i + 16);
      const duration = version === 1 ? uint64beNumber(bytes, i + 28) : uint32be(bytes, i + 20);
      if (timescale > 0 && duration > 0) return duration / timescale;
    }
    return 0;
  }

  async function getMp4Duration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const readSize = Math.min(totalSize, 8 * 1024 * 1024);
    const chunks = [];
    if (readSize > 0) {
      chunks.push(new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: readSize })));
    }
    if (totalSize > readSize) {
      chunks.push(new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: Math.max(0, totalSize - readSize), size: readSize })));
    }

    for (const chunk of chunks) {
      const duration = mp4DurationFromBytes(chunk);
      if (duration > 0) {
        track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
        return duration;
      }
    }
    return 0;
  }

  async function getWavDuration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const readSize = Math.min(totalSize, 256 * 1024);
    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: readSize }));
    if (decodeLatin1(bytes.slice(0, 4)) !== 'RIFF' || decodeLatin1(bytes.slice(8, 12)) !== 'WAVE') return 0;

    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= bytes.length) {
      const id = decodeLatin1(bytes.slice(offset, offset + 4));
      const size = uint32le(bytes, offset + 4);
      const dataOffset = offset + 8;
      if (id === 'fmt ' && dataOffset + 16 <= bytes.length) {
        byteRate = uint32le(bytes, dataOffset + 8);
      } else if (id === 'data') {
        dataSize = size || Math.max(0, totalSize - dataOffset);
        break;
      }
      offset = dataOffset + size + (size % 2);
    }
    const duration = byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
    if (duration > 0) track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
    return duration;
  }

  async function getFlacDuration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: Math.min(totalSize, 128 * 1024) }));
    if (decodeLatin1(bytes.slice(0, 4)) !== 'fLaC') return 0;
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const type = bytes[offset] & 0x7f;
      const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const dataOffset = offset + 4;
      if (type === 0 && length >= 34 && dataOffset + 18 <= bytes.length) {
        const sampleRate = (bytes[dataOffset + 10] << 12) | (bytes[dataOffset + 11] << 4) | (bytes[dataOffset + 12] >> 4);
        const highSamples = bytes[dataOffset + 13] & 0x0f;
        const lowSamples = uint32be(bytes, dataOffset + 14);
        const totalSamples = highSamples * 4294967296 + lowSamples;
        const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
        if (duration > 0) track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
        return duration;
      }
      offset = dataOffset + length;
    }
    return 0;
  }

  async function ensureTrackDuration(track) {
    if (!track || displayDuration(track)) return displayDuration(track);
    try {
      if (/\.mp3$/i.test(track.path)) {
        const info = await getMp3StreamInfo(track);
        return Number(info.duration) || 0;
      }
      if (/\.(m4a|mp4|aac)$/i.test(track.path)) {
        return await getMp4Duration(track);
      }
      if (/\.wav$/i.test(track.path)) {
        return await getWavDuration(track);
      }
      if (/\.flac$/i.test(track.path)) {
        return await getFlacDuration(track);
      }
    } catch {}
    return 0;
  }

  function trackSortValue(track, key) {
    switch (key) {
      case 'title':
        return String(track.title || track.fileName || '').toLocaleLowerCase();
      case 'duration':
        return Number(displayDuration(track)) || Number.MAX_SAFE_INTEGER;
      default:
        return String(track.title || track.fileName || '').toLocaleLowerCase();
    }
  }

  function sortTracks(list) {
    if (state.orderMode === 'shuffle') return shuffle(list);
    const direction = state.sortDirection === 'desc' ? -1 : 1;
    const key = state.sortKey || 'title';
    return [...list].sort((a, b) => {
      const av = trackSortValue(a, key);
      const bv = trackSortValue(b, key);
      if (key === 'duration') {
        const aMissing = av === Number.MAX_SAFE_INTEGER;
        const bMissing = bv === Number.MAX_SAFE_INTEGER;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
      }
      if (typeof av === 'string' || typeof bv === 'string') {
        const result = String(av).localeCompare(String(bv), 'ko', { numeric: true, sensitivity: 'base' });
        return result * direction;
      }
      if (av === bv) {
        return String(a.title || '').localeCompare(String(b.title || ''), 'ko', { numeric: true, sensitivity: 'base' });
      }
      return (av > bv ? 1 : -1) * direction;
    });
  }

  async function hydrateTrackDurations() {
    const token = ++state.durationHydrationToken;
    state.sortMetricLoading = true;
    try {
      const tracks = [...state.tracks];
      for (const track of tracks) {
        if (token !== state.durationHydrationToken) return;
        await ensureTrackDuration(track);
        if (token !== state.durationHydrationToken) return;
        if (state.sortKey === 'duration') {
          rebuildQueue();
        }
        renderList();
      }
    } finally {
      if (token === state.durationHydrationToken) {
        state.sortMetricLoading = false;
        rebuildQueue();
        renderList();
      }
    }
  }

  function rebuildQueue(preserveTrackId = currentTrack()?.id || '') {
    state.queue = sortTracks(state.tracks);
    state.queuePosition = preserveTrackId
      ? state.queue.findIndex(track => track.id === preserveTrackId)
      : (state.queue.length ? 0 : -1);
    if (state.queuePosition < 0 && state.queue.length) state.queuePosition = 0;
  }

  function mergeKnownTrackData(nextTracks) {
    const knownTracks = new Map([...state.tracks, ...state.queue].map(track => [track.id, track]));

    return nextTracks.map(track => {
      const known = knownTracks.get(track.id);
      if (!known) return track;

      return {
        ...track,
        title: known.title || track.title,
        artist: known.artist || track.artist,
        album: known.album || track.album,
        year: known.year || track.year,
        genre: known.genre || track.genre,
        track: known.track || track.track,
        comment: known.comment || track.comment,
        cover: known.cover || track.cover,
        metadataLoaded: known.metadataLoaded || track.metadataLoaded
      };
    });
  }

  function currentTrack() {
    return state.queue[state.queuePosition] || null;
  }

  function queueIndexByTrackId(trackId) {
    return state.queue.findIndex(track => track.id === trackId);
  }

  function closeTrackMenu() {
    state.openMenuTrackId = '';
    document.getElementById('player-track-context-menu')?.classList.add('hidden');
    document
      .querySelectorAll('.player-track-more[aria-expanded="true"]')
      .forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function ensureTrackMenu() {
    let menu = el('player-track-context-menu');
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = 'player-track-context-menu';
    menu.className = 'player-track-menu hidden';
    menu.setAttribute('role', 'menu');

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.dataset.trackMenuAction = 'rename';
    rename.setAttribute('role', 'menuitem');
    rename.textContent = '이름 바꾸기';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.trackMenuAction = 'remove';
    remove.className = 'danger';
    remove.setAttribute('role', 'menuitem');
    remove.textContent = '목록에서 제거';

    menu.append(rename, remove);
    menu.addEventListener('click', event => {
      const button = event.target.closest('button[data-track-menu-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const trackId = menu.dataset.trackId || '';
      const action = button.dataset.trackMenuAction;
      closeTrackMenu();

      if (action === 'rename') {
        void renameTrackFile(trackId);
      } else if (action === 'remove') {
        void removeTrackFile(trackId);
      }
    });

    document.body.appendChild(menu);
    return menu;
  }

  function openTrackMenu(trackId, anchor) {
    const menu = ensureTrackMenu();
    state.openMenuTrackId = trackId;
    menu.dataset.trackId = trackId;
    menu.classList.remove('hidden');
    menu.style.visibility = 'hidden';

    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 10;
    const width = menuRect.width || 156;
    const height = menuRect.height || 92;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = Math.min(maxLeft, Math.max(margin, rect.right - width));
    const top = Math.min(maxTop, Math.max(margin, rect.bottom + 8));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = '';

    document
      .querySelectorAll('.player-track-more')
      .forEach(button => button.setAttribute('aria-expanded', button === anchor ? 'true' : 'false'));
  }

  function updateTrackPath(oldId, nextPath, oldTitle) {
    const nextId = nextPath.toLowerCase();
    const nextFileName = fileName(nextPath);
    const nextExt = nextFileName.split('.').pop()?.toLowerCase() || '';
    const seen = new Set();

    [...state.tracks, ...state.queue].forEach(track => {
      if (!track || track.id !== oldId || seen.has(track)) return;
      seen.add(track);
      const usesFileTitle = !track.metadataLoaded || !track.title || track.title === oldTitle;
      track.id = nextId;
      track.path = nextPath;
      track.fileName = nextFileName;
      track.ext = nextExt;
      if (usesFileTitle) track.title = trackTitle(nextPath);
    });

    state.metadataPromises.delete(oldId);
    state.streamInfoPromises.delete(oldId);
    rebuildQueue(currentTrack()?.id === oldId ? nextId : currentTrack()?.id || nextId);
    return nextId;
  }

  async function renameTrackFile(trackId) {
    const index = queueIndexByTrackId(trackId);
    const track = state.queue[index];
    if (!track) return;

    const oldFileName = track.fileName || fileName(track.path);
    const input = window.prompt('새 파일 이름을 입력하세요. 확장자는 자동으로 유지됩니다.', oldFileName);
    if (input === null) return;

    const normalized = normalizeRenameFileName(input, oldFileName);
    if (!normalized.ok) {
      Toast.show(normalized.message, 'error', 5000);
      return;
    }

    const dir = directoryName(track.path);
    if (!dir) {
      Toast.show('파일 경로를 확인할 수 없습니다.', 'error', 5000);
      return;
    }

    const nextPath = joinPath(dir, normalized.name);
    if (nextPath.toLowerCase() === track.path.toLowerCase()) return;

    if (await pathExists(nextPath)) {
      Toast.show('같은 이름의 파일이 이미 있습니다.', 'error', 5000);
      return;
    }

    const audio = el('audio-player');
    const current = currentTrack();
    const oldId = track.id;
    const oldTitle = trackTitle(track.path);
    const wasCurrent = current?.id === oldId;
    const wasPlaying = !!(wasCurrent && audio && !audio.paused);
    const position = wasCurrent ? Math.floor(displayCurrentTime()) : 0;

    try {
      if (wasCurrent && audio) clearAudioSource(audio);
      await Neutralino.filesystem.move(track.path, nextPath);
      const nextId = updateTrackPath(oldId, nextPath, oldTitle);
      const nextIndex = queueIndexByTrackId(nextId);

      if (wasCurrent && nextIndex >= 0) {
        await loadTrack(nextIndex, wasPlaying, { restorePosition: position });
      } else {
        render();
      }

      Toast.show('파일 이름을 변경했습니다.', 'success', 4000);
    } catch (e) {
      Toast.show(`파일 이름을 변경하지 못했습니다: ${e.message || e}`, 'error', 7000);
      if (wasCurrent) void loadLibrary({ force: true });
    }
  }

  async function confirmRemoveTrack(track) {
    const message = `${track.fileName || fileName(track.path)}\n\n이 작업은 실제 음악 파일을 삭제합니다. 계속할까요?`;
    try {
      const choice = await Neutralino.os.showMessageBox('목록에서 제거', message, 'YES_NO', 'WARNING');
      return /^(YES|OK)$/i.test(String(choice || ''));
    } catch {
      return window.confirm(message);
    }
  }

  async function removeTrackFile(trackId) {
    const index = queueIndexByTrackId(trackId);
    const track = state.queue[index];
    if (!track) return;
    if (!(await confirmRemoveTrack(track))) return;

    const audio = el('audio-player');
    const current = currentTrack();
    const wasCurrent = current?.id === track.id;
    const preserveId = wasCurrent ? '' : current?.id || '';

    try {
      if (wasCurrent && audio) clearAudioSource(audio);
      await Neutralino.filesystem.remove(track.path);

      state.metadataPromises.delete(track.id);
      state.streamInfoPromises.delete(track.id);
      state.tracks = state.tracks.filter(item => item.id !== track.id);
      state.queue = sortTracks(state.tracks);
      state.queuePosition = preserveId
        ? state.queue.findIndex(item => item.id === preserveId)
        : -1;
      if (state.queuePosition < 0 && preserveId && state.queue.length) state.queuePosition = 0;

      if (wasCurrent) {
        savePlayerSettings({
          playerLastTrackId: '',
          playerLastTrackPath: '',
          playerLastPosition: 0,
          playerLastDuration: 0
        }, { immediate: true });
      }

      render();
      Toast.show('파일을 삭제하고 목록에서 제거했습니다.', 'success', 4500);
    } catch (e) {
      Toast.show(`파일을 삭제하지 못했습니다: ${e.message || e}`, 'error', 7000);
      if (wasCurrent) void loadLibrary({ force: true });
    }
  }

  function setCurrentArtwork(track) {
    const art = el('player-art');
    if (!art) return;
    const coverKey = `${track?.id || ''}:${track?.cover?.data?.length || 0}`;
    if (state.coverTrackId === coverKey) return;

    if (state.coverObjectUrl) {
      URL.revokeObjectURL(state.coverObjectUrl);
      state.coverObjectUrl = '';
    }
    state.coverTrackId = coverKey;
    art.innerHTML = '';
    art.classList.remove('has-cover');

    if (track?.cover?.data?.length) {
      state.coverObjectUrl = URL.createObjectURL(new Blob([track.cover.data], { type: track.cover.mime || 'image/jpeg' }));
      const img = document.createElement('img');
      img.src = state.coverObjectUrl;
      img.alt = '';
      art.appendChild(img);
      art.classList.add('has-cover');
    } else {
      art.textContent = '♪';
    }
  }

  function setCurrentText(track) {
    setCurrentArtwork(track);
    setText('player-title', track ? track.title : '재생할 음악을 선택하세요');
    setText(
      'player-subtitle',
      track
        ? [metadataLine(track), track.fileName, formatBytes(track.size)].filter(Boolean).join(' · ')
        : '저장 폴더의 음악 파일이 이곳에 표시됩니다.'
    );

    const metadata = el('player-metadata');
    if (!metadata) return;
    metadata.innerHTML = '';
    const pairs = track ? metadataPairs(track) : [];
    metadata.classList.toggle('hidden', pairs.length === 0);
    pairs.forEach(([label, value]) => {
      const item = document.createElement('span');
      item.className = 'player-metadata-item';
      const key = document.createElement('strong');
      key.textContent = label;
      const text = document.createElement('span');
      text.textContent = value;
      item.append(key, text);
      metadata.appendChild(item);
    });
  }

  function updateProgress() {
    const audio = el('audio-player');
    if (!audio) return;
    const track = currentTrack();
    const duration = displayDuration(track);
    const current = Math.min(displayCurrentTime(), duration || Number.MAX_SAFE_INTEGER);
    const seek = el('player-seek');
    if (!state.isSeeking && seek) {
      seek.value = duration ? String((current / duration) * 100) : '0';
    }
    setText('player-current-time', formatTime(current));
    setText('player-duration', formatTime(duration));

    const now = Date.now();
    if (track && !state.isSeeking && !state.isStreamSeeking && now - state.lastSavedPositionAt > 3000) {
      state.lastSavedPositionAt = now;
      savePlayerSettings({
        playerLastTrackId: track.id,
        playerLastTrackPath: track.path,
        playerLastPosition: Math.floor(current),
        playerLastDuration: duration || Number(track.streamInfo?.duration) || 0
      });
    }
  }

  function updateControls() {
    const audio = el('audio-player');
    if (!audio) return;
    const hasTracks = state.queue.length > 0;
    const playBtn = el('player-play-btn');
    const prevBtn = el('player-prev-btn');
    const nextBtn = el('player-next-btn');
    const playerCard = document.querySelector('.player-card');
    const isPlaying = !audio.paused && hasTracks;
    if (playBtn) {
      playBtn.textContent = isPlaying ? 'Ⅱ' : '▶';
      playBtn.disabled = !hasTracks || state.isLoadingTrack;
    }
    if (prevBtn) prevBtn.disabled = !hasTracks || state.isLoadingTrack;
    if (nextBtn) nextBtn.disabled = !hasTracks || state.isLoadingTrack;
    if (playerCard) playerCard.classList.toggle('is-playing', isPlaying);
    if (!state.isStreamSeeking) {
      setText('player-status-pill', isPlaying ? '지금 재생 중' : (hasTracks ? '대기 중' : '목록 없음'));
    }
  }

  function renderList() {
    const { list, empty, summary } = ensureListDom();
    if (!list) return;
    list.innerHTML = '';

    if (state.tracks.length && !state.queue.length) {
      rebuildQueue();
    }

    const visibleTracks = state.queue.length ? state.queue : state.tracks;
    const query = state.searchQuery.trim().toLowerCase();
    const filteredTracks = visibleTracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        if (!query) return true;
        return [track.title, track.fileName]
          .some(value => String(value || '').toLowerCase().includes(query));
      });

    if (empty) {
      empty.classList.toggle('hidden', state.tracks.length > 0 && filteredTracks.length > 0);
      empty.textContent = state.tracks.length
        ? '검색 결과가 없습니다.'
        : '현재 저장 위치에서 재생 가능한 음악 파일을 찾지 못했습니다.';
    }
    if (summary) {
      const orderText = state.orderMode === 'shuffle' ? '셔플 순서' : '원래 순서';
      const sortText = `${sortLabel()} · ${sortDirectionLabel()}`;
      summary.textContent = state.tracks.length
        ? (query ? `검색 결과 ${filteredTracks.length}개 · 전체 ${state.tracks.length}개 · ${sortText}` : `음악 파일 ${state.tracks.length}개 · ${sortText}`)
        : '음악 파일 0개';
    }

    filteredTracks.forEach(({ track, index }) => {
      const item = document.createElement('div');
      item.className = `player-track ${index === state.queuePosition ? 'active' : ''}`;
      item.dataset.index = String(index);
      item.dataset.trackId = track.id;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const number = document.createElement('span');
      number.className = 'player-track-number';
      number.textContent = String(index + 1).padStart(2, '0');

      const info = document.createElement('span');
      info.className = 'player-track-info';
      const title = document.createElement('span');
      title.className = 'player-track-title';
      title.textContent = track.title;
      const meta = document.createElement('span');
      meta.className = 'player-track-meta';
      meta.textContent = [metadataLine(track), track.fileName, formatBytes(track.size)].filter(Boolean).join(' · ');
      info.append(title, meta);

      const duration = document.createElement('span');
      duration.className = 'player-track-duration';
      duration.textContent = displayDuration(track)
        ? formatTime(displayDuration(track))
        : '';

      const action = document.createElement('span');
      action.className = 'player-track-action';
      action.textContent = index === state.queuePosition ? '재생 중' : '대기';

      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'player-track-more';
      more.dataset.playerAction = 'menu';
      more.dataset.trackId = track.id;
      more.title = '더보기';
      more.setAttribute('aria-label', `${track.title || track.fileName} 더보기`);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', state.openMenuTrackId === track.id ? 'true' : 'false');
      more.textContent = '⋮';

      item.append(number, info, duration, action, more);
      list.appendChild(item);
    });
  }

  function render() {
    renderList();
    try { setCurrentText(currentTrack()); } catch {}
    try { updateProgress(); } catch {}
    try { updateControls(); } catch {}
  }

  async function libraryPathCandidates() {
    const activePath = String(Settings.getActiveSavePath() || '').trim();
    return activePath ? [activePath] : [];
  }

  async function scanAudioFiles(savePath) {
    let entries = await Neutralino.filesystem.readDirectory(savePath, { recursive: true });
    if (!Array.isArray(entries) || entries.length === 0) {
      entries = await Neutralino.filesystem.readDirectory(savePath);
    }

    const files = entries.filter(entry => {
      const entryType = String(entry.type || '').toUpperCase();
      return (!entryType || entryType === 'FILE') && isAudioEntry(entry);
    });

    const tracks = files.map(entry => {
      const path = resolveEntryPath(savePath, entry);
      const ext = fileName(path).split('.').pop()?.toLowerCase() || '';
      return {
        id: path.toLowerCase(),
        path,
        fileName: fileName(path),
        title: trackTitle(path),
        artist: '',
        album: '',
        year: '',
        genre: '',
        track: '',
        comment: '',
        cover: null,
        ext,
        size: Number(entry.size) || 0,
        modifiedAt: fileTime(entry.modifiedAt),
        playable: playableExts.has(ext)
      };
    });

    return tracks
      .filter(track => track.path && track.playable)
      .filter((track, index, list) => list.findIndex(item => item.id === track.id) === index)
      .sort((a, b) => (a.modifiedAt - b.modifiedAt) || a.title.localeCompare(b.title, 'ko'));
  }

  async function restoreLastTrackIfNeeded() {
    if (state.restoredLastTrack || !state.queue.length || state.sourceTrackId) return false;

    const settings = Settings.get();
    const savedId = String(settings.playerLastTrackId || '').toLowerCase();
    const savedPath = String(settings.playerLastTrackPath || '').toLowerCase();
    if (!savedId && !savedPath) return false;

    const index = state.queue.findIndex(track => track.id === savedId || track.path.toLowerCase() === savedPath);
    if (index < 0) return false;

    state.restoredLastTrack = true;
    state.queuePosition = index;
    state.restoringPosition = Math.max(0, Number(settings.playerLastPosition) || 0);
    state.restoredPreviewTime = state.restoringPosition;
    const track = state.queue[index];
    setPlayerLoading(true);
    const savedDuration = Number(settings.playerLastDuration) || 0;
    if (savedDuration > 0) {
      track.streamInfo = {
        ...(track.streamInfo || {}),
        duration: savedDuration,
        totalSize: Number(track.size) || 0,
        estimated: true
      };
    }
    try {
      await ensureTrackMetadata(track);
      if (/\.mp3$/i.test(track.path)) {
        try {
          await getMp3StreamInfo(track);
        } catch {
          if (!displayDuration(track) && state.restoringPosition > 0) {
            track.streamInfo = {
              ...(track.streamInfo || {}),
              duration: state.restoringPosition,
              totalSize: Number(track.size) || 0,
              estimated: true
            };
          }
        }
      }
      setCurrentText(track);
      renderList();
      updateProgress();
      updateControls();
    } finally {
      setPlayerLoading(false);
    }
    return true;
  }

  async function loadLibrary({ force = false } = {}) {
    const activePath = Settings.getActiveSavePath();
    setText('player-path', activePath ? `현재 저장 위치: ${activePath}` : '저장 위치가 설정되지 않았습니다.');

    const paths = await libraryPathCandidates();
    if (!paths.length) {
      state.tracks = [];
      state.queue = [];
      state.queuePosition = -1;
      render();
      setPlayerLoading(false);
      return;
    }

    if (!force && paths.includes(state.loadedPath) && state.tracks.length) {
      render();
      setPlayerLoading(false);
      return;
    }

    const currentId = currentTrack()?.id || '';
    setText('player-summary', `음악 파일을 불러오는 중… ${paths[0]}`);
    if (!currentId && !state.tracks.length) setPlayerLoading(true);

    try {
      let loadedPath = paths[0];
      let tracks = [];
      let lastError = null;

      for (const path of paths) {
        try {
          tracks = await scanAudioFiles(path);
          loadedPath = path;
          if (tracks.length) break;
        } catch (e) {
          lastError = e;
        }
      }

      if (!tracks.length && lastError) throw lastError;

      state.tracks = mergeKnownTrackData(tracks);
      state.loadedPath = loadedPath;
      rebuildQueue(currentId);
      render();
      void hydrateTrackDurations();
      if (!currentId) {
        await restoreLastTrackIfNeeded();
      }
      setText('player-path', loadedPath === activePath
        ? `현재 저장 위치: ${loadedPath}`
        : `음악 폴더: ${loadedPath}`);
      if (!state.tracks.length) {
        setText('player-summary', `음악 파일 0개 · 스캔 위치: ${loadedPath}`);
      }
    } catch (e) {
      state.tracks = [];
      state.queue = [];
      state.queuePosition = -1;
      render();
      setText('player-summary', `음악 파일을 불러오지 못했습니다 · ${paths[0]}`);
      Toast.show(`음악 파일을 불러오지 못했습니다: ${e.message || e}`, 'error', 6000);
    } finally {
      if (currentId || !state.queue.length || !state.restoredLastTrack) setPlayerLoading(false);
    }
  }

  async function loadTrack(index, shouldPlay = false, options = {}) {
    const track = state.queue[index];
    if (!track) return;

    const audio = el('audio-player');
    if (!audio) {
      Toast.show('오디오 플레이어를 초기화하지 못했습니다.', 'error', 5000);
      return;
    }
    state.queuePosition = index;
    state.isLoadingTrack = true;
    updateControls();
    setCurrentText(track);
    renderList();

    try {
      const restorePosition = Math.max(0, Number(options.restorePosition) || 0);
      if (restorePosition > 0) {
        state.restoredPreviewTime = restorePosition;
        updateProgress();
      }
      await ensureTrackMetadata(track);
      setCurrentText(track);
      renderList();
      clearAudioSource(audio);
      await loadTrackSource(audio, track, shouldPlay, { startTime: restorePosition });
      if (restorePosition > 0) {
        const applyPosition = () => {
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          audio.currentTime = duration ? Math.min(restorePosition, Math.max(0, duration - 1)) : restorePosition;
          state.restoredPreviewTime = null;
          updateProgress();
        };

        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          applyPosition();
        } else {
          audio.addEventListener('loadedmetadata', applyPosition, { once: true });
        }
      } else {
        state.restoredPreviewTime = null;
      }
      state.restoringPosition = null;

      if (options.persist !== false) {
        savePlayerSettings({
          playerLastTrackId: track.id,
          playerLastTrackPath: track.path,
          playerLastPosition: restorePosition || Math.floor(Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
          playerLastDuration: displayDuration(track)
        }, { immediate: true });
      }
    } catch (e) {
      Toast.show(`재생할 수 없습니다: ${track.fileName}`, 'error', 6000);
    } finally {
      state.isLoadingTrack = false;
      updateControls();
      renderList();
    }
  }

  async function playCurrent() {
    const audio = el('audio-player');
    const track = currentTrack();
    if (!audio) {
      Toast.show('오디오 플레이어를 초기화하지 못했습니다.', 'error', 5000);
      return;
    }
    if (!state.queue.length) {
      Toast.show('재생할 음악 파일이 없습니다.', 'warning');
      return;
    }

    if (state.queuePosition < 0) state.queuePosition = 0;
    if (!audio.src || state.sourceTrackId !== track?.id) {
      await loadTrack(state.queuePosition, true, {
        restorePosition: state.restoringPosition || 0
      });
      return;
    }

    try {
      await audio.play();
      updateControls();
    } catch {
      try {
        if (track) await loadTrackSource(audio, track, true);
      } catch {
        Toast.show('재생을 시작할 수 없습니다.', 'error');
      }
    }
  }

  function pause() {
    el('audio-player')?.pause();
    updateControls();
  }

  async function seekTo(time) {
    const audio = el('audio-player');
    const track = currentTrack();
    if (!audio || !track) return;

    const targetTime = Math.max(0, Number(time) || 0);
    const wasPlaying = !!audio.src && !audio.paused;
    const isMp3Track = /\.mp3$/i.test(track.path);
    const shouldOpenStream = isMp3Track && (!audio.src || state.sourceTrackId !== track.id || state.streamSession);
    savePlayerSettings({
      playerLastTrackId: track.id,
      playerLastTrackPath: track.path,
      playerLastPosition: Math.floor(targetTime),
      playerLastDuration: displayDuration(track)
    }, { immediate: true });

    if (shouldOpenStream) {
      state.isStreamSeeking = true;
      state.seekPreviewTime = targetTime;
      state.restoredPreviewTime = targetTime;
      state.restoringPosition = targetTime;
      updateProgress();

      try {
        if (audio.src || state.sourceTrackId) clearAudioSource(audio);
        await loadTrackSource(audio, track, wasPlaying, {
          startTime: targetTime,
          suppressStatus: true
        });
        state.restoredPreviewTime = null;
        state.restoringPosition = null;
        state.seekPreviewTime = null;
        updateProgress();
      } finally {
        state.isStreamSeeking = false;
        updateControls();
      }
      return;
    }

    audio.currentTime = targetTime;
    updateProgress();
  }

  function hasNext() {
    return state.queuePosition >= 0 && state.queuePosition < state.queue.length - 1;
  }

  async function next({ fromEnded = false } = {}) {
    if (!state.queue.length) return;
    if (hasNext()) {
      await loadTrack(state.queuePosition + 1, true);
      return;
    }

    if (fromEnded && state.repeatMode === 'repeat-queue') {
      await loadTrack(0, true);
      return;
    }

    if (!fromEnded && state.repeatMode === 'repeat-queue') {
      await loadTrack(0, true);
      return;
    }

    pause();
  }

  async function previous() {
    if (!state.queue.length) return;
    const audio = el('audio-player');
    if (!audio) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const prevIndex = state.queuePosition > 0
      ? state.queuePosition - 1
      : (state.repeatMode === 'repeat-queue' ? state.queue.length - 1 : 0);
    await loadTrack(prevIndex, true);
  }

  async function handleEnded() {
    const audio = el('audio-player');
    if (!audio) return;
    if (state.repeatMode === 'repeat-one') {
      const index = state.queuePosition;
      if (index < 0 || !state.queue[index]) return;

      state.seekPreviewTime = null;
      state.restoredPreviewTime = 0;
      state.restoringPosition = 0;

      const track = state.queue[index];
      savePlayerSettings({
        playerLastTrackId: track.id,
        playerLastTrackPath: track.path,
        playerLastPosition: 0,
        playerLastDuration: displayDuration(track)
      }, { immediate: true });

      try {
        await loadTrack(index, true, { restorePosition: 0 });
      } catch {
        Toast.show('현재 노래를 반복 재생할 수 없습니다.', 'error', 5000);
      }
      return;
    }

    if (state.repeatMode === 'stop-current') {
      pause();
      return;
    }

    if (state.repeatMode === 'play-through') {
      if (hasNext()) await next({ fromEnded: true });
      else pause();
      return;
    }

    await next({ fromEnded: true });
  }

  function setOrderMode(mode) {
    state.orderMode = mode;
    rebuildQueue();
    render();
    savePlayerSettings({ playerOrderMode: mode }, { immediate: true });
  }

  function setRepeatMode(mode) {
    state.repeatMode = mode;
    savePlayerSettings({ playerRepeatMode: mode }, { immediate: true });
  }

  function sortLabel() {
    return ({
      title: '제목순',
      duration: '재생시간순'
    })[state.sortKey] || '제목순';
  }

  function sortDirectionLabel() {
    return state.sortDirection === 'desc' ? '내림차순' : '오름차순';
  }

  function updateSortControls() {
    const select = el('player-sort-select');
    const button = el('player-sort-dir-btn');
    if (select) select.value = state.sortKey;
    if (button) {
      button.textContent = sortDirectionLabel();
      button.title = `${sortLabel()} ${sortDirectionLabel()}`;
      button.setAttribute('aria-label', `정렬 방향: ${sortDirectionLabel()}`);
    }
  }

  function applyListSort(nextKey = state.sortKey, nextDirection = state.sortDirection) {
    state.sortKey = nextKey;
    state.sortDirection = nextDirection;
    rebuildQueue();
    updateSortControls();
    render();
    if (state.sortKey === 'duration') void hydrateTrackDurations();
  }

  function invalidate() {
    const activePath = String(Settings.getActiveSavePath() || '').trim();
    const loadedPath = String(state.loadedPath || '').trim();
    const pathChanged = !!loadedPath && !!activePath && loadedPath.toLowerCase() !== activePath.toLowerCase();

    if (pathChanged) {
      const audio = el('audio-player');
      if (audio) clearAudioSource(audio);
      state.tracks = [];
      state.queue = [];
      state.queuePosition = -1;
      state.restoredLastTrack = false;
      state.restoredPreviewTime = null;
      state.seekPreviewTime = null;
      setText('player-path', `현재 저장 위치: ${activePath}`);
      setText('player-summary', `음악 파일을 불러오는 중… ${activePath}`);
      render();
    }

    state.loadedPath = '';
    if (document.getElementById('tab-player')?.classList.contains('active')) {
      void loadLibrary({ force: true });
    }
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    const audio = el('audio-player');
    const volume = el('player-volume');
    applySavedPlayerSettings();
    if (audio) {
      audio.volume = Number.isFinite(Number(volume?.value)) ? Number(volume.value) : 0.9;
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('loadedmetadata', updateProgress);
      audio.addEventListener('play', updateControls);
      audio.addEventListener('pause', () => {
        const track = currentTrack();
        if (track) {
          savePlayerSettings({
            playerLastTrackId: track.id,
            playerLastTrackPath: track.path,
            playerLastPosition: Math.floor(Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
            playerLastDuration: displayDuration(track)
          }, { immediate: true });
        }
        updateControls();
      });
      audio.addEventListener('ended', () => void handleEnded());
      audio.addEventListener('error', () => {
        if (state.isLoadingTrack) return;
        const track = currentTrack();
        if (track) Toast.show(`재생 중 오류가 발생했습니다: ${track.fileName}`, 'error', 5000);
      });
    }

    el('player-refresh-btn')?.addEventListener('click', () => void loadLibrary({ force: true }));
    el('player-open-folder-btn')?.addEventListener('click', () => {
      const path = Settings.getActiveSavePath();
      if (path) void Neutralino.os.open(path);
    });
    el('player-play-btn')?.addEventListener('click', () => {
      if (!audio || audio.paused) void playCurrent();
      else pause();
    });
    el('player-prev-btn')?.addEventListener('click', () => void previous());
    el('player-next-btn')?.addEventListener('click', () => void next());
    el('player-order-select')?.addEventListener('change', e => setOrderMode(e.target.value));
    el('player-repeat-select')?.addEventListener('change', e => setRepeatMode(e.target.value));
    el('player-sort-select')?.addEventListener('change', e => applyListSort(e.target.value, state.sortDirection));
    el('player-sort-dir-btn')?.addEventListener('click', () => {
      applyListSort(state.sortKey, state.sortDirection === 'desc' ? 'asc' : 'desc');
    });
    volume?.addEventListener('input', e => {
      const value = Number(e.target.value);
      if (audio) audio.volume = value;
      savePlayerSettings({ playerVolume: value });
    });
    volume?.addEventListener('change', e => {
      savePlayerSettings({ playerVolume: Number(e.target.value) }, { immediate: true });
    });
    el('player-seek')?.addEventListener('input', e => {
      state.isSeeking = true;
      const duration = displayDuration();
      if (duration) {
        setText('player-current-time', formatTime((Number(e.target.value) / 100) * duration));
      }
    });
    el('player-seek')?.addEventListener('change', e => {
      const duration = displayDuration();
      if (audio && duration) {
        const targetTime = (Number(e.target.value) / 100) * duration;
        state.seekPreviewTime = targetTime;
        updateProgress();
        const track = currentTrack();
        if (track) {
          savePlayerSettings({
            playerLastTrackId: track.id,
            playerLastTrackPath: track.path,
            playerLastPosition: Math.floor(targetTime),
            playerLastDuration: duration
          }, { immediate: true });
        }
        void seekTo(targetTime)
          .catch(() => {
            Toast.show('재생 위치를 이동할 수 없습니다.', 'error', 4000);
          })
          .finally(() => {
            state.isSeeking = false;
            state.seekPreviewTime = null;
            updateProgress();
          });
        return;
      }
      state.isSeeking = false;
    });
    const listDom = ensureListDom().list;
    listDom?.addEventListener('click', e => {
      const menuButton = e.target.closest('button[data-player-action="menu"]');
      if (menuButton) {
        e.preventDefault();
        e.stopPropagation();
        const trackId = menuButton.dataset.trackId || '';
        if (state.openMenuTrackId === trackId) {
          closeTrackMenu();
        } else {
          openTrackMenu(trackId, menuButton);
        }
        return;
      }

      const item = e.target.closest('.player-track');
      if (!item) return;
      closeTrackMenu();
      void loadTrack(Number(item.dataset.index), true);
    });
    listDom?.addEventListener('keydown', e => {
      if (e.target.closest('button')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.player-track');
      if (!item) return;
      e.preventDefault();
      closeTrackMenu();
      void loadTrack(Number(item.dataset.index), true);
    });
    listDom?.addEventListener('scroll', closeTrackMenu);
    document.addEventListener('click', e => {
      if (e.target.closest('#player-track-context-menu') || e.target.closest('.player-track-more')) return;
      closeTrackMenu();
    });
    window.addEventListener('resize', closeTrackMenu);
    el('player-search')?.addEventListener('input', e => {
      state.searchQuery = String(e.target.value || '');
      closeTrackMenu();
      renderList();
    });

    render();
  }

  return { init, loadLibrary, invalidate };
})();

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
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        Toast.show('설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.', 'error', 5000);
        return;
      }
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'player') {
        void Player.loadLibrary({ force: true });
      }
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
    { btn: 'local-path-btn', display: 'local-path-display', key: 'localPath', title: '저장 폴더 선택' }
  ];

  folderBtns.forEach(({ btn, display, key, title }) => {
    document.getElementById(btn)?.addEventListener('click', async () => {
      try {
        const p = await Neutralino.os.showFolderDialog(title);
        if (p) {
          const displayEl = document.getElementById(display);
          if (displayEl) displayEl.textContent = p;
          await Settings.save({ saveDest: 'local', [key]: p });
          Player.invalidate();
        }
      } catch {}
    });
  });

  document.getElementById('install-ffmpeg-btn').addEventListener('click', async () => {
    const btn = document.getElementById('install-ffmpeg-btn');
    btn.disabled = true;
    btn.textContent = '설치 중…';
    setDependencyProgress('ffmpeg', { pct: 0, message: '다운로드 준비 중…' }, true);
    try {
      const deps = await YTDlp.installFfmpeg(progress => {
        setDependencyProgress('ffmpeg', progress, true);
        if (typeof progress === 'string') Toast.show(progress, 'info', 5000);
      });
      UI.updateDepsStatus(deps);
      setDependencyProgress('ffmpeg', { pct: 100, message: '정상 설치 완료' }, true);
      Toast.show(`ffmpeg ${deps.ffmpeg.version} 준비 완료`, 'success', 5000);
    } catch (e) {
      setDependencyProgress('ffmpeg', { pct: 100, message: `설치 실패: ${e.message || e}` }, true);
      Toast.show(`ffmpeg 설치 실패: ${e.message || e}`, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ 설치 / 업데이트';
    }
  });

  document.getElementById('update-ytdlp-btn').addEventListener('click', async () => {
    const btn = document.getElementById('update-ytdlp-btn');
    btn.disabled = true;
    btn.textContent = '설치 중…';
    setDependencyProgress('ytdlp', { pct: 0, message: '다운로드 준비 중…' }, true);
    try {
      const deps = await YTDlp.updateYtdlp(progress => {
        setDependencyProgress('ytdlp', progress, true);
        if (typeof progress === 'string') Toast.show(progress, 'info', 5000);
      });
      UI.updateDepsStatus(deps);
      setDependencyProgress('ytdlp', { pct: 100, message: '정상 설치 완료' }, true);
      Toast.show(`yt-dlp ${deps.ytdlp.version} 준비 완료`, 'success', 5000);
    } catch (e) {
      setDependencyProgress('ytdlp', { pct: 100, message: `설치 실패: ${e.message || e}` }, true);
      Toast.show(`yt-dlp 설치 실패: ${e.message || e}`, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ 업데이트';
    }
  });

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const quality = document.getElementById('quality-select')?.value || '192';
    const format  = document.getElementById('format-select')?.value || 'mp3';
    const embedThumb = true;
    const embedMeta = true;
    await Settings.save({ saveDest: 'local', quality, format, embedThumb, embedMeta });
    Player.invalidate();
    Toast.show('설정이 저장되었습니다.', 'success');
  });
}

function applySettingsToUI(s) {
  const localPathDisplay = document.getElementById('local-path-display');
  if (localPathDisplay) localPathDisplay.textContent = s.localPath || '경로 선택 안 됨';
  if (s.quality) document.getElementById('quality-select').value = s.quality;
  if (s.format) document.getElementById('format-select').value = s.format;
}

async function ensureDefaultLocalPath(s) {
  if (s.saveDest !== 'local') {
    s = await Settings.save({ saveDest: 'local' });
  }

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

async function ensureRequiredToolsInstalled() {
  if (dependencyInstallPromise) return dependencyInstallPromise;

  dependencyInstallPromise = (async () => {
    Toast.show('ffmpeg / yt-dlp 확인 중…', 'info', 2500);
    setDependencyProgress('ffmpeg', null, false);
    setDependencyProgress('ytdlp', null, false);

    let deps;
    try {
      deps = await YTDlp.checkDeps({ refresh: true });
    } catch (e) {
      deps = {
        ffmpeg: { ok: false, path: '', version: '' },
        ytdlp: { ok: false, path: '', version: '' }
      };
      Toast.show(`필수 도구 확인 실패: ${e.message || e}`, 'error', 8000);
    }
    UI.updateDepsStatus(deps);

    if (!deps.ffmpeg.ok || !deps.ytdlp.ok) {
      Toast.show('변환 기능을 사용하려면 설정 > 의존성 도구에서 필수 도구를 설치해 주세요.', 'warning', 8000);
    }

    return deps;
  })().finally(() => {
    dependencyInstallPromise = null;
  });

  return dependencyInstallPromise;
}

// ── App init ──────────────────────────────────────────────────────────
Neutralino.init();
Neutralino.events.on('windowClose', () => Neutralino.app.exit());

(async () => {
  try {
    UI.restoreDepsStatus();
    let s = await Settings.load();
    s = await ensureDefaultLocalPath(s);
    applySettingsToUI(s);
  } catch {}

  initTabs();
  initConvertScreen();
  Player.init();
  initSettingsTab();
  void Player.loadLibrary({ force: true });

  void ensureRequiredToolsInstalled().catch(e => {
    Toast.show(`필수 도구 확인 실패: ${e.message || e}`, 'error', 8000);
  });
})();
