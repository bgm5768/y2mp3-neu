/**
 * resources/js/converter/converter.js
 * URL analysis, conversion flow, dependency checks, and convert tab events.
 */

import { normalizeMediaUrl, splitUrlTokens, stripUrlToken } from './url-parser.js';
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
  const modes = {
    audio: {
      label: 'MP3',
      actionLabel: '변환',
      allowedSources: ['youtube', 'instagram', 'tiktok'],
      readyButton: 'MP3 변환',
      multiButton: count => `${count}개 MP3 변환 시작`,
      runningButton: 'MP3 변환 진행 중…',
      inputGuide: '변환할 YouTube, Instagram, TikTok URL을 입력하세요. 여러 개는 줄바꿈으로 구분할 수 있습니다.',
      placeholder: 'https://www.youtube.com/watch?v=...\nhttps://www.instagram.com/reel/...\nhttps://www.tiktok.com/@user/video/...'
    },
    video: {
      label: '동영상',
      actionLabel: '다운로드',
      allowedSources: ['youtube', 'instagram', 'tiktok', 'douyin', 'xiaohongshu'],
      readyButton: '동영상 다운로드',
      multiButton: count => `${count}개 동영상 다운로드 시작`,
      runningButton: '동영상 다운로드 중…',
      inputGuide: '다운로드할 YouTube, Instagram Reels, TikTok, Douyin, Xiaohongshu/Rednote 동영상 URL을 입력하세요. 여러 개는 줄바꿈으로 구분할 수 있습니다.',
      placeholder: 'https://www.youtube.com/watch?v=...\nhttps://www.instagram.com/reel/...\nhttps://www.tiktok.com/@user/video/...\nhttps://www.douyin.com/video/...\nhttps://www.xiaohongshu.com/explore/...'
    }
  };

  function getConvertMode() {
    const active = document.querySelector('.convert-mode-btn.active');
    const mode = active?.dataset.convertMode || 'audio';
    return modes[mode] ? mode : 'audio';
  }

  function supportedSourceText(mode) {
    return mode === 'video'
      ? 'YouTube, Instagram Reels, TikTok, Douyin, Xiaohongshu/Rednote'
      : 'YouTube, Instagram, TikTok';
  }

  function analyzeUrlInput() {
    const input = document.getElementById('url-input');
    const mode = getConvertMode();
    const existingKeys = new Set(Queue.getAll().map(item => item.urlKey || item.url));
    const seenKeys = new Set();
    const valid = [];
    const invalid = [];
    let duplicateCount = 0;

    splitUrlTokens(input.value).forEach(token => {
      const normalized = normalizeMediaUrl(token, { allowedSources: modes[mode].allowedSources });
      if (!normalized) {
        invalid.push(stripUrlToken(token));
        return;
      }

      const queueKey = `${mode}:${normalized.key}`;
      if (seenKeys.has(queueKey) || existingKeys.has(queueKey)) {
        duplicateCount += 1;
        return;
      }

      seenKeys.add(queueKey);
      valid.push({ ...normalized, queueKey });
    });

    appState.currentUrlAnalysis = { mode, valid, duplicateCount, invalid };
    return appState.currentUrlAnalysis;
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
    const mode = getConvertMode();
    const modeConfig = modes[mode];
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
      btn.textContent = modeConfig.runningButton;
      btn.disabled = true;
      return;
    }

    if (count === 0) {
      btn.textContent = 'URL을 입력해주세요';
      btn.disabled = true;
    } else if (count === 1) {
      btn.textContent = modeConfig.readyButton;
      btn.disabled = false;
    } else {
      btn.textContent = modeConfig.multiButton(count);
      btn.disabled = false;
    }
  }

  function resizeUrlInput() {
    const input = document.getElementById('url-input');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function setConvertMode(mode) {
    const nextMode = modes[mode] ? mode : 'audio';
    const modeConfig = modes[nextMode];
    document.querySelectorAll('.convert-mode-btn').forEach(btn => {
      const active = btn.dataset.convertMode === nextMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    document.querySelectorAll('.audio-option').forEach(el => {
      el.classList.toggle('hidden', nextMode !== 'audio');
    });
    document.querySelectorAll('.video-option').forEach(el => {
      el.classList.toggle('hidden', nextMode !== 'video');
    });

    const label = document.getElementById('url-input-label');
    const input = document.getElementById('url-input');
    if (label) label.textContent = modeConfig.inputGuide;
    if (input) input.placeholder = modeConfig.placeholder;

    resizeUrlInput();
    updateUrlAnalysisView();
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

  function getConversionOptions(mode = getConvertMode()) {
    const settings = Settings.get();
    return {
      mode,
      modeLabel: modes[mode]?.label || 'MP3',
      quality: document.getElementById('quality-select').value,
      format: document.getElementById('format-select').value,
      videoQuality: document.getElementById('video-quality-select')?.value || 'best',
      videoFormat: document.getElementById('video-format-select')?.value || 'mp4',
      postConvertPlaylistId: mode === 'audio'
        ? (document.getElementById('post-convert-playlist-select')?.value || '')
        : '',
      embedThumb: true,
      embedMeta: true,
      savePath: Settings.getActiveSavePath(mode),
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
      Toast.show('현재 작업이 진행 중입니다.', 'warning');
      return;
    }

    const mode = getConvertMode();
    const modeConfig = modes[mode];
    const analysis = analyzeUrlInput();
    if (analysis.valid.length === 0) {
      Toast.show(`처리할 ${supportedSourceText(mode)} URL을 입력하세요.`, 'warning');
      updateUrlAnalysisView();
      return;
    }

    if (!Settings.getActiveSavePath(mode)) {
      Toast.show(mode === 'video' ? '동영상 저장 위치를 먼저 선택하세요.' : '음악 저장 위치를 먼저 선택하세요.', 'warning');
      return;
    }

    const options = getConversionOptions(mode);
    const added = Queue.add(analysis.valid.map(item => ({
      url: item.url,
      rawUrl: item.raw || item.url,
      urlKey: item.queueKey,
      mode,
      modeLabel: modeConfig.label,
      source: item.source,
      sourceLabel: item.sourceLabel,
      options: { ...options, source: item.source, rawUrl: item.raw || item.url }
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
        eta: '정보 없이 작업 준비 중'
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
      eta: options.mode === 'video' ? '다운로드 시작 중' : '변환 시작 중',
      errorMsg: ''
    });

    try {
      const progressHandler = (pct, speed, eta, phase) => {
        const statusText = phase === 'convert'
          ? (options.mode === 'video' ? '파일 정리 중' : 'MP3 변환 중')
          : (eta || '다운로드 중');
        QueueUI.updateItem(id, {
          status: 'running',
          pct,
          speed: speed || '',
          eta: statusText
        });
      };

      const filePath = options.mode === 'video'
        ? await YTDlp.downloadVideo({
          url: afterInfo.url,
          videoQuality: options.videoQuality,
          format: options.videoFormat,
          savePath: options.savePath,
          source: options.source,
          rawUrl: options.rawUrl || afterInfo.rawUrl || afterInfo.url,
          proxy: options.proxy,
          rateLimit: options.rateLimit,
          signal: appState.cancelController.signal,
          onProgress: progressHandler
        })
        : await YTDlp.download({
          url: afterInfo.url,
          quality: options.quality,
          format: options.format,
          savePath: options.savePath,
          embedThumb: options.embedThumb,
          embedMeta: options.embedMeta,
          proxy: options.proxy,
          rateLimit: options.rateLimit,
          signal: appState.cancelController.signal,
          onProgress: progressHandler
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
        errorMsg: e.message || '작업에 실패했습니다.'
      });
      return 'error';
    } finally {
      appState.cancelController = null;
      appState.cancelRequested = false;
      appState.currentItemId = null;
    }
  }

  async function syncCompletedFileWithPlayer(filePath, options) {
    if (options.mode !== 'audio') return { addedCount: 0, foundCount: 0, playlistName: '' };
    if (!filePath) return { addedCount: 0, foundCount: 0, playlistName: '' };

    const player = getPlayer();
    if (!player) return { addedCount: 0, foundCount: 0, playlistName: '' };

    if (options.postConvertPlaylistId && player.addFilesToPlaylist) {
      return player.addFilesToPlaylist([filePath], options.postConvertPlaylistId);
    }

    if (typeof player.loadLibrary === 'function') {
      await player.loadLibrary({ force: true });
    } else {
      player.invalidate?.();
    }

    return { addedCount: 0, foundCount: 0, playlistName: '' };
  }

  function getOptionsForItem(item) {
    const snapshot = item?.options || {};
    const mode = item?.mode || snapshot.mode || 'audio';
    return {
      ...getConversionOptions(mode),
      ...snapshot,
      mode,
      source: item?.source || snapshot.source || '',
      rawUrl: item?.rawUrl || snapshot.rawUrl || item?.url || '',
      modeLabel: modes[mode]?.label || snapshot.modeLabel || 'MP3'
    };
  }

  async function runQueue(ids = null) {
    if (appState.isQueueRunning) {
      Toast.show('이미 작업이 진행 중입니다.', 'warning');
      return;
    }

    const targets = ids
      ? ids.map(id => Queue.getById(id)).filter(Boolean)
      : Queue.getRunnable();

    if (!targets.length) {
      Toast.show('실행할 대기열 항목이 없습니다.', 'warning');
      return;
    }

    appState.isQueueRunning = true;
    updateConvertButton();
    QueueUI.updateToolbar();

    let doneCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;
    let lastFilePath = '';
    let playlistAddedCount = 0;
    let playlistName = '';
    let playlistNotFoundCount = 0;
    let playlistDuplicateCount = 0;
    let playerSyncErrorCount = 0;
    let audioDoneCount = 0;
    let videoDoneCount = 0;

    try {
      await ensureRequiredToolsInstalled();

      for (const target of targets) {
        const item = Queue.getById(target.id);
        if (!item || !['waiting', 'error', 'cancelled'].includes(item.status)) continue;
        const options = getOptionsForItem(item);

        if (!options.savePath) {
          QueueUI.updateItem(item.id, {
            status: 'error',
            errorMsg: options.mode === 'video' ? '동영상 저장 위치를 먼저 선택하세요.' : '음악 저장 위치를 먼저 선택하세요.'
          });
          errorCount += 1;
          continue;
        }

        try { await Neutralino.filesystem.createDirectory(options.savePath); } catch {}

        const result = await runQueueItem(item.id, options);
        const latest = Queue.getById(item.id);
        if (result === 'done') {
          doneCount += 1;
          if (options.mode === 'video') videoDoneCount += 1;
          else audioDoneCount += 1;
          const filePath = latest?.filePath || '';
          lastFilePath = filePath || lastFilePath;

          try {
            const syncResult = await syncCompletedFileWithPlayer(filePath, options);
            playlistAddedCount += Number(syncResult?.addedCount) || 0;
            playlistName = syncResult?.playlistName || playlistName;
            if (options.mode === 'audio' && options.postConvertPlaylistId) {
              if ((Number(syncResult?.foundCount) || 0) === 0) {
                playlistNotFoundCount += 1;
              } else if ((Number(syncResult?.addedCount) || 0) === 0) {
                playlistDuplicateCount += 1;
              }
            }
            renderPostConvertPlaylistOptions();
          } catch (e) {
            playerSyncErrorCount += 1;
            Toast.show(`플레이어 목록 갱신 실패: ${e.message || e}`, 'warning', 7000);
            getPlayer()?.invalidate?.();
          }
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

    if (doneCount > 0) {
      if (audioDoneCount > 0 && playlistAddedCount === 0 && targets.some(item => getOptionsForItem(item).postConvertPlaylistId)) {
        const reason = playlistNotFoundCount > 0
          ? '변환 파일을 플레이어 목록에서 찾지 못했습니다.'
          : '변환 파일이 이미 선택한 플레이리스트에 있습니다.';
        Toast.show(`플레이리스트 자동 추가 안 됨: ${reason}`, 'warning', 6000);
      } else if (audioDoneCount > 0 && (playlistNotFoundCount > 0 || playlistDuplicateCount > 0)) {
        const parts = [];
        if (playlistNotFoundCount > 0) parts.push(`미반영 ${playlistNotFoundCount}곡`);
        if (playlistDuplicateCount > 0) parts.push(`중복 ${playlistDuplicateCount}곡`);
        Toast.show(`플레이리스트 일부 자동 추가 제외: ${parts.join(', ')}`, 'warning', 6000);
      }

      if (playerSyncErrorCount > 0) {
        Toast.show(`플레이어 갱신 실패 항목 ${playerSyncErrorCount}개가 있습니다.`, 'warning', 6000);
      }

      const playlistText = playlistAddedCount
        ? ` · ${playlistName}에 ${playlistAddedCount}곡 추가`
        : '';
      renderPostConvertPlaylistOptions();
      const doneLabel = audioDoneCount > 0 && videoDoneCount > 0
        ? '작업'
        : (videoDoneCount > 0 ? '동영상 다운로드' : 'MP3 변환');
      Toast.show(
        `${doneCount === 1 ? `${doneLabel} 완료` : `${doneCount}개 ${doneLabel} 완료`}${playlistText}`,
        'success',
        3000,
        lastFilePath ? { label: '저장 폴더 열기', onClick: () => openContainingFolder(lastFilePath) } : null
      );
    }

    if (errorCount > 0) {
      Toast.show(`실패한 항목 ${errorCount}개가 있습니다.`, 'warning', 6000);
    }
    if (cancelledCount > 0 && doneCount === 0 && errorCount === 0) {
      Toast.show('작업이 취소되었습니다.', 'warning');
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
        Toast.show('변환/다운로드 기능을 사용하려면 설정 > 의존성 도구에서 필수 도구를 설치해 주세요.', 'warning', 8000);
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

    document.querySelectorAll('.convert-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (appState.isQueueRunning) return;
        setConvertMode(btn.dataset.convertMode || 'audio');
      });
    });

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

    setConvertMode('audio');
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
