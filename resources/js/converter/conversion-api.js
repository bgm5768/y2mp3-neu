/**
 * resources/js/converter/conversion-api.js
 * Reusable URL input analysis and media conversion API.
 */

import { normalizeMediaUrl, splitUrlTokens, stripUrlToken } from './url-parser.js';

export const CONVERSION_MODES = {
  audio: {
    label: 'MP3',
    allowedSources: ['youtube', 'instagram', 'tiktok']
  },
  video: {
    label: '동영상',
    allowedSources: ['youtube', 'instagram', 'tiktok', 'douyin', 'xiaohongshu']
  }
};

export function normalizeConversionMode(mode) {
  return CONVERSION_MODES[mode] ? mode : 'audio';
}

export function supportedConversionSourceText(mode) {
  return normalizeConversionMode(mode) === 'video'
    ? 'YouTube, Instagram Reels, TikTok, Douyin, Xiaohongshu/Rednote'
    : 'YouTube, Instagram, TikTok';
}

export function analyzeConversionInput(input, { mode = 'audio', existingKeys = [] } = {}) {
  const normalizedMode = normalizeConversionMode(mode);
  const existing = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const seenKeys = new Set();
  const valid = [];
  const invalid = [];
  let duplicateCount = 0;

  splitUrlTokens(input).forEach(token => {
    const normalized = normalizeMediaUrl(token, {
      allowedSources: CONVERSION_MODES[normalizedMode].allowedSources
    });

    if (!normalized) {
      invalid.push(stripUrlToken(token));
      return;
    }

    const queueKey = `${normalizedMode}:${normalized.key}`;
    if (seenKeys.has(queueKey) || existing.has(queueKey)) {
      duplicateCount += 1;
      return;
    }

    seenKeys.add(queueKey);
    valid.push({ ...normalized, queueKey });
  });

  return { mode: normalizedMode, valid, duplicateCount, invalid };
}

function settingsRateLimit(settings) {
  if (!settings.useRateLimit) return '';
  return settings.rateLimit || `${settings.rateLimitVal || ''}${settings.rateLimitUnit || ''}`;
}

export function createConversionOptions({
  mode = 'audio',
  settings = {},
  quality,
  format,
  videoQuality,
  videoFormat,
  postConvertPlaylistId = '',
  embedThumb = true,
  embedMeta = true,
  savePath,
  proxy,
  rateLimit
} = {}) {
  const normalizedMode = normalizeConversionMode(mode);
  const activeSavePath = savePath || (
    normalizedMode === 'video'
      ? (settings.videoPath || settings.musicPath || settings.localPath || '')
      : (settings.musicPath || settings.localPath || '')
  );

  return {
    mode: normalizedMode,
    modeLabel: CONVERSION_MODES[normalizedMode].label,
    quality: quality || settings.quality || '192',
    format: format || settings.format || 'mp3',
    videoQuality: videoQuality || settings.videoQuality || 'best',
    videoFormat: videoFormat || settings.videoFormat || 'mp4',
    postConvertPlaylistId: normalizedMode === 'audio' ? postConvertPlaylistId : '',
    embedThumb,
    embedMeta,
    savePath: activeSavePath,
    proxy: proxy ?? (settings.useProxy ? settings.proxy : ''),
    rateLimit: rateLimit ?? settingsRateLimit(settings)
  };
}

export function createConversionApi({ YTDlp, Settings = null, Neutralino = null } = {}) {
  function requireYtdlp() {
    if (!YTDlp) throw new Error('YTDlp dependency is required.');
    return YTDlp;
  }

  function settingsSnapshot() {
    return Settings?.get ? Settings.get() : {};
  }

  function activeSavePath(mode) {
    if (Settings?.getActiveSavePath) return Settings.getActiveSavePath(mode);
    const settings = settingsSnapshot();
    return createConversionOptions({ mode, settings }).savePath;
  }

  function options(input = {}) {
    const mode = normalizeConversionMode(input.mode);
    return createConversionOptions({
      ...input,
      mode,
      settings: settingsSnapshot(),
      savePath: input.savePath || activeSavePath(mode)
    });
  }

  function normalizeTask(input, optionSnapshot = {}) {
    const mode = normalizeConversionMode(input?.mode || optionSnapshot.mode);
    if (input && typeof input === 'object' && input.url) {
      return {
        url: input.url,
        rawUrl: input.rawUrl || input.raw || optionSnapshot.rawUrl || input.url,
        urlKey: input.urlKey || input.url,
        mode,
        modeLabel: input.modeLabel || CONVERSION_MODES[mode].label,
        source: input.source || optionSnapshot.source || '',
        sourceLabel: input.sourceLabel || '',
        title: input.title || input.url,
        thumbnail: input.thumbnail || '',
        duration: input.duration || '',
        uploader: input.uploader || ''
      };
    }

    const normalized = normalizeMediaUrl(input, {
      allowedSources: CONVERSION_MODES[mode].allowedSources
    });
    if (!normalized) {
      throw new Error(`처리할 수 없는 URL입니다. 지원: ${supportedConversionSourceText(mode)}`);
    }

    return {
      url: normalized.url,
      rawUrl: normalized.raw || normalized.url,
      urlKey: `${mode}:${normalized.key}`,
      mode,
      modeLabel: CONVERSION_MODES[mode].label,
      source: normalized.source,
      sourceLabel: normalized.sourceLabel,
      title: normalized.url,
      thumbnail: '',
      duration: '',
      uploader: ''
    };
  }

  async function ensureSaveDirectory(savePath) {
    if (!savePath || !Neutralino?.filesystem?.createDirectory) return;
    try {
      await Neutralino.filesystem.createDirectory(savePath);
    } catch {}
  }

  async function loadInfo(input) {
    const ytdlp = requireYtdlp();
    const url = typeof input === 'string' ? input : input?.url;
    if (!url) throw new Error('URL이 필요합니다.');
    return ytdlp.getVideoInfo(url);
  }

  async function convertItem(input, optionInput = {}) {
    const ytdlp = requireYtdlp();
    const task = normalizeTask(input, optionInput);
    const finalOptions = { ...options({ ...optionInput, mode: task.mode }), ...optionInput, mode: task.mode };

    if (!finalOptions.savePath) {
      throw new Error(task.mode === 'video'
        ? '동영상 저장 위치를 먼저 선택하세요.'
        : '음악 저장 위치를 먼저 선택하세요.');
    }

    await ensureSaveDirectory(finalOptions.savePath);

    const filePath = task.mode === 'video'
      ? await ytdlp.downloadVideo({
        url: task.url,
        videoQuality: finalOptions.videoQuality,
        format: finalOptions.videoFormat,
        savePath: finalOptions.savePath,
        source: finalOptions.source || task.source,
        cookieBrowser: finalOptions.cookieBrowser,
        cookieFile: finalOptions.cookieFile,
        rawUrl: finalOptions.rawUrl || task.rawUrl || task.url,
        proxy: finalOptions.proxy,
        rateLimit: finalOptions.rateLimit,
        signal: finalOptions.signal,
        onProgress: finalOptions.onProgress
      })
      : await ytdlp.download({
        url: task.url,
        quality: finalOptions.quality,
        format: finalOptions.format,
        savePath: finalOptions.savePath,
        embedThumb: finalOptions.embedThumb,
        embedMeta: finalOptions.embedMeta,
        proxy: finalOptions.proxy,
        rateLimit: finalOptions.rateLimit,
        signal: finalOptions.signal,
        onProgress: finalOptions.onProgress
      });

    return { filePath, task, options: finalOptions };
  }

  async function convertInput(input, optionInput = {}) {
    const mode = normalizeConversionMode(optionInput.mode);
    const analysis = analyzeConversionInput(input, { mode, existingKeys: optionInput.existingKeys || [] });
    const results = [];

    for (const item of analysis.valid) {
      try {
        const result = await convertItem({
          url: item.url,
          rawUrl: item.raw || item.url,
          urlKey: item.queueKey,
          mode,
          source: item.source,
          sourceLabel: item.sourceLabel
        }, { ...optionInput, mode, source: item.source, rawUrl: item.raw || item.url });
        results.push({ status: 'done', item, ...result });
      } catch (error) {
        results.push({ status: 'error', item, error });
        if (optionInput.stopOnError) break;
      }
    }

    return { analysis, results };
  }

  function checkDeps(options = {}) {
    return requireYtdlp().checkDeps(options);
  }

  function searchYouTube(query, options = {}) {
    return requireYtdlp().searchYouTube(query, options);
  }

  function cancelActiveDownload() {
    return requireYtdlp().cancelActiveDownload?.();
  }

  return {
    modes: CONVERSION_MODES,
    normalizeMode: normalizeConversionMode,
    supportedSourceText: supportedConversionSourceText,
    analyzeInput: analyzeConversionInput,
    createOptions: options,
    loadInfo,
    searchYouTube,
    convertItem,
    convertInput,
    checkDeps,
    cancelActiveDownload
  };
}
