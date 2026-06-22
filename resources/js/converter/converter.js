/**
 * resources/js/converter/converter.js
 * URL analysis, conversion flow, dependency checks, and convert tab events.
 */

import { normalizeYouTubeUrl, splitUrlTokens, stripUrlToken } from './url-parser.js';
import { createQueueActionHandler } from './queue-ui.js';

export function createConverter({
  appState,
  Queue,
  QueueUI,
  YTDlp,
  Neutralino,
  Settings,
  Toast,
  DependencyUI,
  getPlayer
}) {
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

    appState.currentUrlAnalysis = { valid, duplicateCount, invalid };
    return appState.currentUrlAnalysis;
  }

  function updateUrlAnalysisView() {
    const analysis = analyzeUrlInput();
    const el = document.getElementById('url-analysis');
    const parts = [`유효한 URL ${analysis.valid.length}개`];
    if (analysis.duplicateCount > 0) parts.push(`중복 ${analysis.duplicateCount}개 제외`);
    if (analysis.invalid.length > 0) parts.push(`잘못된 URL ${analysis.invalid.length}개`);
    el.textContent = parts.join(' ? ');
    el.classList.toggle('has-invalid', analysis.invalid.length > 0);
    el.classList.toggle('has-valid', analysis.valid.length > 0);
    updateConvertButton();
  }

  function updateConvertButton() {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    renderPostConvertPlaylistOptions();
    if (!DependencyUI.depsReady()) {
      btn.textContent = '의존성 도구 설치 필요';
      btn.disabled = true;
      btn.title = '설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.';
      return;
    }
    btn.title = '';

    const count = appState.currentUrlAnalysis.valid.length;

    if (appState.isQueueRunning) {
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

  function renderPostConvertPlaylistOptions() {
    const select = document.getElementById('post-convert-playlist-select');
    const hint = document.getElementById('post-convert-playlist-hint');
    if (!select) return;

    const previous = select.value;
    const playlists = getPlayer()?.playlistOptions?.() || [];
    select.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = '플레이리스트에 추가 안 함';
    select.appendChild(none);

    playlists.forEach(playlist => {
      const option = document.createElement('option');
      option.value = playlist.id;
      option.textContent = `${playlist.name} (${playlist.count}곡)`;
      select.appendChild(option);
    });

    select.value = playlists.some(playlist => playlist.id === previous) ? previous : '';
    select.disabled = appState.isQueueRunning;

    if (hint) {
      hint.textContent = playlists.length
        ? '선택하면 완료된 파일이 변환 후 자동으로 추가됩니다.'
        : '플레이어 탭에서 플레이리스트를 만들면 여기서 선택할 수 있습니다.';
    }
  }

  function getConversionOptions() {
    const settings = Settings.get();
    return {
      quality: document.getElementById('quality-select').value,
      format: document.getElementById('format-select').value,
      postConvertPlaylistId: document.getElementById('post-convert-playlist-select')?.value || '',
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
    if (!DependencyUI.depsReady()) {
      Toast.show('설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.', 'error', 6000);
      return;
    }

    if (appState.isQueueRunning) {
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

    appState.cancelRequested = false;
    appState.cancelController = new AbortController();
    appState.currentItemId = id;
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
        signal: appState.cancelController.signal,
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
      if (e.message === 'CANCELLED' || appState.cancelRequested) {
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
      appState.cancelController = null;
      appState.cancelRequested = false;
      appState.currentItemId = null;
    }
  }

  async function runQueue(ids = null) {
    if (appState.isQueueRunning) {
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

    appState.isQueueRunning = true;
    updateConvertButton();
    QueueUI.updateToolbar();

    let doneCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;
    let lastFilePath = '';
    const completedFilePaths = [];

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
          if (latest?.filePath) completedFilePaths.push(latest.filePath);
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
      appState.isQueueRunning = false;
      updateUrlAnalysisView();
      QueueUI.render();
      renderPostConvertPlaylistOptions();
    }

    let playlistAddResult = null;
    if (doneCount > 0) {
      if (options.postConvertPlaylistId) {
        try {
          const player = getPlayer();
          if (player?.addFilesToPlaylist) {
            playlistAddResult = await player.addFilesToPlaylist(completedFilePaths, options.postConvertPlaylistId);
          } else {
            getPlayer()?.invalidate();
          }
        } catch (e) {
          Toast.show(`플레이리스트 자동 추가 실패: ${e.message || e}`, 'warning', 7000);
          getPlayer()?.invalidate();
        }
      } else {
        getPlayer()?.invalidate();
      }

      if (options.postConvertPlaylistId && playlistAddResult && playlistAddResult.addedCount === 0) {
        const reason = playlistAddResult.foundCount === 0
          ? '변환 파일을 플레이어 목록에서 찾지 못했습니다.'
          : '변환 파일이 이미 선택한 플레이리스트에 있습니다.';
        Toast.show(`플레이리스트 자동 추가 안 됨: ${reason}`, 'warning', 6000);
      }

      const playlistText = playlistAddResult?.addedCount
        ? ` · ${playlistAddResult.playlistName}에 ${playlistAddResult.addedCount}곡 추가`
        : '';
      renderPostConvertPlaylistOptions();
      Toast.show(
        `${doneCount === 1 ? '다운로드 완료' : `${doneCount}개 다운로드 완료`}${playlistText}`,
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
    const dir = String(filePath || '').replace(/[\/][^\/]+$/, '');
    if (!dir) return;
    try {
      await Neutralino.os.open(dir);
    } catch {
      Toast.show('저장 폴더를 열 수 없습니다.', 'error');
    }
  }

  async function ensureRequiredToolsInstalled() {
    if (appState.dependencyInstallPromise) return appState.dependencyInstallPromise;

    appState.dependencyInstallPromise = (async () => {
      Toast.show('ffmpeg / yt-dlp 확인 중…', 'info', 2500);
      DependencyUI.setDependencyProgress('ffmpeg', null, false);
      DependencyUI.setDependencyProgress('ytdlp', null, false);

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
      DependencyUI.updateDepsStatus(deps);

      if (!deps.ffmpeg.ok || !deps.ytdlp.ok) {
        Toast.show('변환 기능을 사용하려면 설정 > 의존성 도구에서 필수 도구를 설치해 주세요.', 'warning', 8000);
      }

      return deps;
    })().finally(() => {
      appState.dependencyInstallPromise = null;
    });

    return appState.dependencyInstallPromise;
  }

  const handleQueueAction = createQueueActionHandler({
    appState,
    Queue,
    QueueUI,
    YTDlp,
    runQueue,
    openDownloadedFile,
    updateUrlAnalysisView
  });

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
        input.value = input.value.trim() ? `${input.value.trim()}
${text}` : text;
        resizeUrlInput();
        updateUrlAnalysisView();
      } catch {
        Toast.show('클립보드 읽기 실패', 'error');
      }
    });
    document.getElementById('post-convert-playlist-select')?.addEventListener('focus', renderPostConvertPlaylistOptions);

    document.getElementById('convert-btn').addEventListener('click', beginConvert);
    document.getElementById('queue-list').addEventListener('click', handleQueueAction);
    document.getElementById('start-all-btn').addEventListener('click', () => void runQueue());
    document.getElementById('clear-completed-btn').addEventListener('click', () => {
      Queue.removeByStatus(['done']);
      QueueUI.render();
      updateUrlAnalysisView();
    });
    document.getElementById('clear-queue-btn').addEventListener('click', () => {
      if (appState.isQueueRunning) return;
      Queue.clear();
      QueueUI.render();
      updateUrlAnalysisView();
    });

    resizeUrlInput();
    renderPostConvertPlaylistOptions();
    updateUrlAnalysisView();
    QueueUI.render();
  }

  return {
    initConvertScreen,
    beginConvert,
    updateUrlAnalysisView,
    updateConvertButton,
    resizeUrlInput,
    runQueue,
    ensureRequiredToolsInstalled,
    openDownloadedFile,
    openContainingFolder
  };
}
