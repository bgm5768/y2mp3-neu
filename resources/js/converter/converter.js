/**
 * resources/js/converter/converter.js
 * URL analysis, conversion flow, dependency checks, and convert tab events.
 */

import { createConversionApi } from './conversion-api.js';
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
  const ConversionApi = createConversionApi({ YTDlp, Settings, Neutralino });
  let aiSearchRunning = false;

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

  function setAiSearchStatus(message, type = '') {
    const el = document.getElementById('ai-search-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = `ai-search-status${type ? ` status-${type}` : ''}`;
  }

  function setAiLlmStatus(message, type = '') {
    const el = document.getElementById('ai-llm-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = `ai-search-status${type ? ` status-${type}` : ''}`;
  }

  function updateAiKeywordButton() {
    const btn = document.getElementById('ai-keyword-download-btn');
    if (!btn) return;
    const disabled = aiSearchRunning || appState.isQueueRunning || !DependencyUI.depsReady();
    btn.disabled = disabled;
    btn.textContent = aiSearchRunning ? 'AI 검색 중…' : 'AI로 찾아서 큐에 추가';
    btn.title = !DependencyUI.depsReady()
      ? '설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.'
      : '';
  }

  function aiLimitValue() {
    const value = Number(document.getElementById('ai-limit-input')?.value || 5);
    return Math.max(1, Math.min(30, Number.isFinite(value) ? Math.floor(value) : 5));
  }

  function normalizeAiQueries(values, fallback, limit) {
    const seen = new Set();
    const queries = (Array.isArray(values) ? values : [])
      .map(value => String(value || '').replace(/^["']|["']$/g, '').trim())
      .filter(Boolean)
      .filter(value => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (!queries.length && fallback) queries.push(fallback);
    return queries.slice(0, Math.max(1, Math.min(30, limit)));
  }

  function parseAiQueryResponse(text, fallback, limit) {
    const cleaned = String(text || '').replace(/```(?:json)?|```/gi, '').trim();
    const jsonText = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned.match(/\[[\s\S]*\]/)?.[0] || '';
    if (!jsonText) return normalizeAiQueries([], fallback, limit);

    try {
      const parsed = JSON.parse(jsonText);
      const rawQueries = Array.isArray(parsed)
        ? parsed
        : (parsed.queries || parsed.songs || parsed.results || []);
      return normalizeAiQueries(rawQueries, fallback, limit);
    } catch {
      return normalizeAiQueries([], fallback, limit);
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function utf8Base64(value) {
    return bytesToBase64(new TextEncoder().encode(String(value || '')));
  }

  function utf16LeBase64(value) {
    const text = String(value || '');
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      bytes[i * 2] = code & 0xff;
      bytes[i * 2 + 1] = code >> 8;
    }
    return bytesToBase64(bytes);
  }

  function psQuote(value) {
    return `'${String(value || '').replace(/'/g, "''")}'`;
  }

  function normalizeAiBaseUrl(value) {
    const text = String(value || '').trim().replace(/\/+$/g, '');
    return text || 'http://127.0.0.1:1234/v1';
  }

  function currentAiLlmConfig() {
    const settings = Settings.get();
    return {
      useLocalLlm: document.getElementById('ai-use-local-llm')?.checked ?? settings.aiUseLocalLlm,
      baseUrl: normalizeAiBaseUrl(document.getElementById('ai-llm-base-url')?.value || settings.aiLlmBaseUrl),
      model: String(document.getElementById('ai-llm-model')?.value || settings.aiLlmModel || '').trim()
    };
  }

  function aiEndpoint(path, config = currentAiLlmConfig()) {
    return `${normalizeAiBaseUrl(config.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function invokeLmStudioJson(path, { method = 'GET', body = null, timeoutSec = 10 } = {}, config = currentAiLlmConfig()) {
    const bodyScript = body
      ? `$body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${utf8Base64(JSON.stringify(body))}'))`
      : '';
    const requestArgs = body
      ? `-Body $body -ContentType 'application/json; charset=utf-8'`
      : '';
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
      `$ProgressPreference = 'SilentlyContinue'`,
      `$uri = ${psQuote(aiEndpoint(path, config))}`,
      bodyScript,
      `$result = Invoke-RestMethod -Uri $uri -Method ${psQuote(method)} ${requestArgs} -TimeoutSec ${Math.max(2, Number(timeoutSec) || 10)}`,
      `$result | ConvertTo-Json -Depth 30 -Compress`
    ].filter(Boolean).join('\n');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${utf16LeBase64(script)}`;
    const result = await Neutralino.os.execCommand(command);
    if (Number(result?.exitCode || 0) !== 0) {
      throw new Error((result?.stdErr || result?.stdOut || '').trim() || 'LM Studio 요청 실패');
    }
    const out = String(result?.stdOut || '').trim();
    if (!out) return {};
    return JSON.parse(out);
  }

  function firstModelId(data) {
    return data?.data?.[0]?.id || data?.[0]?.id || '';
  }

  async function lmStudioModelId(config = currentAiLlmConfig()) {
    if (config.model) return config.model;
    const data = await invokeLmStudioJson('/models', { method: 'GET', timeoutSec: 5 }, config);
    return firstModelId(data) || 'local-model';
  }

  async function localLlmSearchQueries(keyword, limit, config = currentAiLlmConfig()) {
    const model = await lmStudioModelId(config);
    const modelInput = document.getElementById('ai-llm-model');
    if (modelInput && !modelInput.value.trim() && model !== 'local-model') modelInput.value = model;
    const data = await invokeLmStudioJson('/chat/completions', {
      method: 'POST',
      timeoutSec: 20,
      body: {
        model,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              'You create YouTube music search queries.',
              'Return strict JSON only: {"queries":["..."]}.',
              'If the keyword is an artist, include representative songs by that artist and closely related songs.',
              'If the keyword is a song, include likely official audio, live, or lyric search queries.',
              'Do not explain.'
            ].join(' ')
          },
          {
            role: 'user',
            content: `keyword: ${keyword}\nlimit: ${limit}\nlanguage: Korean or original artist language is allowed`
          }
        ]
      }
    }, config);

    const content = data?.choices?.[0]?.message?.content || '';
    return parseAiQueryResponse(content, keyword, limit);
  }

  function applyAiSettingsToUi() {
    const settings = Settings.get();
    const limit = Math.max(1, Math.min(30, Number(settings.aiDownloadLimit) || 5));
    const useLlm = settings.aiUseLocalLlm !== false;

    const useEl = document.getElementById('ai-use-local-llm');
    const baseEl = document.getElementById('ai-llm-base-url');
    const modelEl = document.getElementById('ai-llm-model');
    const limitEl = document.getElementById('ai-limit-input');

    if (useEl) useEl.checked = useLlm;
    if (baseEl) baseEl.value = normalizeAiBaseUrl(settings.aiLlmBaseUrl);
    if (modelEl) modelEl.value = settings.aiLlmModel || '';
    if (limitEl) limitEl.value = String(limit);
  }

  async function saveAiDownloaderSettings({ quiet = false } = {}) {
    const config = currentAiLlmConfig();
    await Settings.save({
      aiUseLocalLlm: !!config.useLocalLlm,
      aiLlmBaseUrl: normalizeAiBaseUrl(config.baseUrl),
      aiLlmModel: config.model,
      aiDownloadLimit: aiLimitValue(),
      aiPostConvertPlaylistId: document.getElementById('ai-playlist-select')?.value || ''
    });
    if (!quiet) {
      setAiLlmStatus('AI 다운로더 설정을 저장했습니다.', 'ok');
      Toast.show('AI 다운로더 설정을 저장했습니다.', 'success', 2200);
    }
  }

  async function refreshAiModelInfo() {
    const config = currentAiLlmConfig();
    setAiLlmStatus('LM Studio 모델 정보를 확인하는 중…', 'working');
    try {
      const data = await invokeLmStudioJson('/models', { method: 'GET', timeoutSec: 5 }, config);
      const model = firstModelId(data);
      if (!model) {
        setAiLlmStatus('LM Studio에 로드된 모델을 찾지 못했습니다.', 'error');
        return '';
      }
      const modelInput = document.getElementById('ai-llm-model');
      if (modelInput && !modelInput.value.trim()) modelInput.value = model;
      await saveAiDownloaderSettings({ quiet: true });
      setAiLlmStatus(`연결됨 · 모델: ${model}`, 'ok');
      return model;
    } catch (e) {
      setAiLlmStatus(`LM Studio 연결 실패: ${e.message || e}`, 'error');
      return '';
    }
  }

  function analyzeUrlInput() {
    const input = document.getElementById('url-input');
    const mode = getConvertMode();
    const existingKeys = new Set(Queue.getAll().map(item => item.urlKey || item.url));
    appState.currentUrlAnalysis = ConversionApi.analyzeInput(input.value, { mode, existingKeys });
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
    updateAiKeywordButton();
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

  function renderPlaylistOptions(selectId, hintId, {
    emptyText = '플레이리스트에 추가 안 함',
    selectedValue = null,
    availableHint = '선택하면 완료된 파일이 변환 후 자동으로 추가됩니다.',
    emptyHint = '플레이어 탭에서 플레이리스트를 만들면 여기서 선택할 수 있습니다.'
  } = {}) {
    const select = document.getElementById(selectId);
    const hint = document.getElementById(hintId);
    if (!select) return;

    const previous = selectedValue === null ? select.value : selectedValue;
    const playlists = getPlayer()?.playlistOptions?.() || [];
    select.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = emptyText;
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
        ? availableHint
        : emptyHint;
    }
  }

  function renderPostConvertPlaylistOptions() {
    renderPlaylistOptions('post-convert-playlist-select', 'post-convert-playlist-hint');
  }

  function renderAiPlaylistOptions({ useSaved = false } = {}) {
    renderPlaylistOptions('ai-playlist-select', null, {
      selectedValue: useSaved ? (Settings.get().aiPostConvertPlaylistId || '') : null,
      availableHint: '선택한 플레이리스트에는 다운로드 완료 후 자동 추가됩니다.',
      emptyHint: '플레이어 탭에서 플레이리스트를 만들면 여기서 선택할 수 있습니다.'
    });
  }

  function getConversionOptions(mode = getConvertMode()) {
    return ConversionApi.createOptions({
      mode,
      quality: document.getElementById('quality-select').value,
      format: document.getElementById('format-select').value,
      videoQuality: document.getElementById('video-quality-select')?.value || 'best',
      videoFormat: document.getElementById('video-format-select')?.value || 'mp4',
      postConvertPlaylistId: mode === 'audio'
        ? (document.getElementById('post-convert-playlist-select')?.value || '')
        : '',
      embedThumb: true,
      embedMeta: true
    });
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

  async function aiSearchQueries(keyword, limit, config) {
    const useLocalLlm = !!config.useLocalLlm;
    if (!useLocalLlm) return [keyword];

    setAiSearchStatus('LM Studio 로컬 LLM으로 검색어를 만드는 중…', 'working');
    try {
      return await localLlmSearchQueries(keyword, limit, config);
    } catch (e) {
      Toast.show(`로컬 LLM 검색어 생성 실패, 키워드로 직접 검색합니다: ${e.message || e}`, 'warning', 7000);
      return [keyword];
    }
  }

  async function collectYouTubeSearchResults(queries, limit, fallbackKeyword = '') {
    const results = [];
    const seen = new Set();
    const queryList = normalizeAiQueries(queries, fallbackKeyword, limit);

    async function searchOne(query, queryCount) {
      if (results.length >= limit) return;
      setAiSearchStatus(`YouTube 검색 중: ${query}`, 'working');
      const remaining = Math.max(1, limit - results.length);
      const perQueryLimit = queryCount === 1 ? remaining : Math.min(3, remaining);
      const found = await ConversionApi.searchYouTube(query, { limit: perQueryLimit });

      found.forEach(item => {
        const key = item.url || item.key;
        if (!key || seen.has(key) || results.length >= limit) return;
        seen.add(key);
        results.push(item);
      });
    }

    for (const query of queryList) {
      await searchOne(query, queryList.length);
    }

    const fallbackKey = String(fallbackKeyword || '').trim().toLowerCase();
    const alreadySearchedFallback = queryList.some(query => query.toLowerCase() === fallbackKey);
    if (results.length < limit && fallbackKeyword && !alreadySearchedFallback) {
      await searchOne(fallbackKeyword, 1);
    }

    return results.slice(0, limit);
  }

  function normalizeMusicText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/\[[^\]]*]|\([^)]*\)|【[^】]*】/g, ' ')
      .replace(/\b(official|audio|video|lyrics?|lyric|mv|m\/v|live|remaster(?:ed)?|hd|4k|mp3)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function musicTokens(value) {
    return normalizeMusicText(value)
      .split(' ')
      .filter(token => token.length > 1);
  }

  function isLikelySameMusic(candidate, owned) {
    const candidateText = normalizeMusicText(candidate);
    if (!candidateText || candidateText.length < 3) return false;

    return owned.some(ownedText => {
      if (!ownedText || ownedText.length < 3) return false;
      if (candidateText === ownedText) return true;
      if (ownedText.length >= 5 && candidateText.includes(ownedText)) return true;
      if (candidateText.length >= 5 && ownedText.includes(candidateText)) return true;

      const candidateTokens = musicTokens(candidateText);
      const ownedTokens = musicTokens(ownedText);
      if (candidateTokens.length < 2 || ownedTokens.length < 2) return false;
      const ownedSet = new Set(ownedTokens);
      const overlap = candidateTokens.filter(token => ownedSet.has(token)).length;
      return overlap / Math.max(candidateTokens.length, ownedTokens.length) >= 0.85;
    });
  }

  function ownedMusicTexts() {
    const tracks = getPlayer()?.libraryTracks?.() || [];
    const values = [];
    tracks.forEach(track => {
      const fileTitle = String(track.fileName || '').replace(/\.[^.]+$/g, '');
      [track.title, fileTitle, [track.artist, track.title].filter(Boolean).join(' ')].forEach(value => {
        const normalized = normalizeMusicText(value);
        if (normalized) values.push(normalized);
      });
    });
    return [...new Set(values)];
  }

  function addAiResultsToQueue(results) {
    const options = {
      ...getConversionOptions('audio'),
      postConvertPlaylistId: document.getElementById('ai-playlist-select')?.value || ''
    };
    const existingKeys = new Set(Queue.getAll().map(item => item.urlKey || item.url));
    const ownedTexts = ownedMusicTexts();
    const items = [];
    let duplicateCount = 0;
    let ownedDuplicateCount = 0;

    results.forEach(item => {
      const queueKey = `audio:${item.key || item.url}`;
      if (existingKeys.has(queueKey)) {
        duplicateCount += 1;
        return;
      }
      if (isLikelySameMusic(`${item.title || ''} ${item.uploader || ''}`, ownedTexts)) {
        ownedDuplicateCount += 1;
        return;
      }
      existingKeys.add(queueKey);
      items.push({
        url: item.url,
        rawUrl: item.url,
        urlKey: queueKey,
        mode: 'audio',
        modeLabel: modes.audio.label,
        source: 'youtube',
        sourceLabel: 'YouTube',
        title: item.title || item.url,
        thumbnail: item.thumbnail || '',
        duration: item.duration || '',
        uploader: item.uploader || '',
        options: { ...options, source: 'youtube', rawUrl: item.url }
      });
    });

    return {
      added: Queue.add(items),
      duplicateCount,
      ownedDuplicateCount
    };
  }

  async function beginAiKeywordDownload() {
    if (aiSearchRunning) return;

    if (!DependencyUI.depsReady()) {
      Toast.show('설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.', 'error', 6000);
      return;
    }
    if (appState.isQueueRunning) {
      Toast.show('현재 작업이 진행 중입니다.', 'warning');
      return;
    }
    if (!Settings.getActiveSavePath('audio')) {
      Toast.show('음악 저장 위치를 먼저 선택하세요.', 'warning');
      return;
    }

    const keyword = String(document.getElementById('ai-keyword-input')?.value || '').trim();
    const limit = aiLimitValue();
    const llmConfig = currentAiLlmConfig();
    if (!keyword) {
      Toast.show('검색할 아티스트나 노래 키워드를 입력하세요.', 'warning');
      document.getElementById('ai-keyword-input')?.focus();
      return;
    }

    aiSearchRunning = true;
    updateAiKeywordButton();

    try {
      await saveAiDownloaderSettings({ quiet: true });
      setAiSearchStatus('보유 중인 음악 목록을 확인하는 중…', 'working');
      await getPlayer()?.loadLibrary?.({ force: true });

      const queries = await aiSearchQueries(keyword, limit, llmConfig);
      await saveAiDownloaderSettings({ quiet: true });
      setAiSearchStatus(`검색어 ${queries.length}개 생성 · YouTube 검색 준비 중`, 'working');
      const results = await collectYouTubeSearchResults(queries, limit, keyword);

      if (!results.length) {
        setAiSearchStatus('검색 결과를 찾지 못했습니다. 키워드를 더 구체적으로 입력해 보세요.', 'error');
        Toast.show('YouTube 검색 결과가 없습니다.', 'warning', 5000);
        return;
      }

      const { added, duplicateCount, ownedDuplicateCount } = addAiResultsToQueue(results);
      QueueUI.render();
      updateUrlAnalysisView();

      if (!added.length) {
        const reason = ownedDuplicateCount
          ? `보유 중인 음악 ${ownedDuplicateCount}곡과 중복됩니다.`
          : '모두 이미 대기열에 있습니다.';
        setAiSearchStatus(`추가할 곡이 없습니다. ${reason}`, 'error');
        Toast.show('추가할 새 검색 결과가 없습니다.', 'warning', 5000);
        return;
      }

      const skipped = [];
      if (ownedDuplicateCount) skipped.push(`보유 중복 ${ownedDuplicateCount}곡 제외`);
      if (duplicateCount) skipped.push(`대기열 중복 ${duplicateCount}곡 제외`);
      const suffix = skipped.length ? ` · ${skipped.join(', ')}` : '';
      setAiSearchStatus(`${added.length}곡을 대기열에 추가했습니다${suffix}. 기존 MP3 변환 흐름으로 다운로드합니다.`, 'ok');
      Toast.show(`${added.length}곡을 AI 검색으로 대기열에 추가했습니다.`, 'success', 3500);
      void runQueue(added.map(item => item.id));
    } catch (e) {
      setAiSearchStatus(`AI 키워드 다운로드 실패: ${e.message || e}`, 'error');
      Toast.show(`AI 키워드 다운로드 실패: ${e.message || e}`, 'error', 8000);
    } finally {
      aiSearchRunning = false;
      updateAiKeywordButton();
    }
  }

  async function loadItemInfo(item) {
    QueueUI.updateItem(item.id, { status: 'loading', pct: 2, eta: '정보 불러오는 중', errorMsg: '' });

    try {
      const info = await ConversionApi.loadInfo(item);
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

      const { filePath } = await ConversionApi.convertItem(afterInfo, {
        ...options,
        rawUrl: options.rawUrl || afterInfo.rawUrl || afterInfo.url,
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
            renderAiPlaylistOptions();
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
      renderAiPlaylistOptions();
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
      renderAiPlaylistOptions();
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
        deps = await ConversionApi.checkDeps({ refresh: true });
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
    document.getElementById('ai-playlist-select')?.addEventListener('focus', () => renderAiPlaylistOptions());
    document.getElementById('ai-playlist-select')?.addEventListener('change', () => {
      void saveAiDownloaderSettings({ quiet: true });
    });
    document.getElementById('ai-keyword-download-btn')?.addEventListener('click', () => void beginAiKeywordDownload());
    document.getElementById('ai-keyword-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void beginAiKeywordDownload();
      }
    });
    document.getElementById('ai-limit-input')?.addEventListener('input', () => {
      const input = document.getElementById('ai-limit-input');
      if (!input) return;
      input.value = String(aiLimitValue());
    });
    document.getElementById('ai-use-local-llm')?.addEventListener('change', () => {
      void saveAiDownloaderSettings({ quiet: true });
      updateAiKeywordButton();
    });
    document.getElementById('ai-llm-base-url')?.addEventListener('change', () => {
      void saveAiDownloaderSettings({ quiet: true });
    });
    document.getElementById('ai-llm-model')?.addEventListener('change', () => {
      void saveAiDownloaderSettings({ quiet: true });
    });
    document.getElementById('ai-save-llm-btn')?.addEventListener('click', () => {
      void saveAiDownloaderSettings();
    });
    document.getElementById('ai-refresh-model-btn')?.addEventListener('click', () => {
      void refreshAiModelInfo();
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
      if (appState.isQueueRunning) return;
      Queue.clear();
      QueueUI.render();
      updateUrlAnalysisView();
    });

    setConvertMode('audio');
    applyAiSettingsToUi();
    resizeUrlInput();
    renderPostConvertPlaylistOptions();
    renderAiPlaylistOptions({ useSaved: true });
    updateAiKeywordButton();
    updateUrlAnalysisView();
    QueueUI.render();
  }

  return {
    api: ConversionApi,
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
