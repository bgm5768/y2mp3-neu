/**
 * resources/js/converter/url-parser.js
 * Media URL token parsing and normalization.
 */

export function splitUrlTokens(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

export function stripUrlToken(token) {
  return String(token || '')
    .trim()
    .replace(/^[<"'([{]+/, '')
    .replace(/[>"'\])},;]+$/g, '');
}

function extractVideoIdFromPath(pathname, segmentName) {
  const parts = String(pathname || '')
    .split('/')
    .filter(Boolean);

  const index = parts.findIndex(
    part => part.toLowerCase() === segmentName.toLowerCase()
  );

  return index >= 0 ? parts[index + 1] || '' : '';
}

function isLikelyVideoId(id) {
  return /^[A-Za-z0-9_-]{6,32}$/.test(String(id || ''));
}

function ensureProtocol(value) {
  if (/^https?:\/\//i.test(value)) return value;

  const supportedDomain =
    /^((www|m|music)\.)?youtube\.com\//i.test(value) ||
    /^youtu\.be\//i.test(value) ||
    /^((www|m)\.)?instagram\.com\//i.test(value) ||
    /^((www|m|vm|vt)\.)?tiktok\.com\//i.test(value) ||
    /^((www|m|v)\.)?douyin\.com\//i.test(value) ||
    /^iesdouyin\.com\//i.test(value) ||
    /^((www|m)\.)?xiaohongshu\.com\//i.test(value) ||
    /^((www|m)\.)?xhslink\.com\//i.test(value) ||
    /^((www|m)\.)?rednote\.com\//i.test(value);

  return supportedDomain ? `https://${value}` : '';
}

function cleanTrackingParams(parsed) {
  [...parsed.searchParams.keys()].forEach(key => {
    if (/^(utm_|fbclid|igsh|is_from_webapp|sender_device|tt_from)$/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  });
  parsed.hash = '';
}

function normalizedUrlText(parsed) {
  cleanTrackingParams(parsed);
  return parsed.toString();
}

function withSearchParams(url, parsed) {
  const query = parsed.searchParams.toString();
  return query ? `${url}?${query}` : url;
}

function normalizeYouTubeParsedUrl(parsed, rawValue) {
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');

  let videoId = '';

  if (host === 'youtu.be') {
    videoId =
      parsed.pathname
        .split('/')
        .filter(Boolean)[0] || '';
  } else if (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com')
  ) {
    const path = parsed.pathname.toLowerCase();

    if (path === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    } else if (path.startsWith('/shorts/')) {
      videoId = extractVideoIdFromPath(
        parsed.pathname,
        'shorts'
      );
    } else if (path.startsWith('/embed/')) {
      videoId = extractVideoIdFromPath(
        parsed.pathname,
        'embed'
      );
    } else if (path.startsWith('/live/')) {
      videoId = extractVideoIdFromPath(
        parsed.pathname,
        'live'
      );
    }
  }

  if (!isLikelyVideoId(videoId)) {
    return null;
  }

  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    key: `youtube:${videoId}`,
    source: 'youtube',
    sourceLabel: 'YouTube',
    raw: rawValue
  };
}

function normalizeInstagramParsedUrl(parsed, rawValue) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const type = parts[0]?.toLowerCase() || '';
  const shortcode = parts[1] || '';
  const canonicalTypes = new Set(['p', 'reel', 'reels', 'tv']);

  if (canonicalTypes.has(type) && shortcode) {
    const canonicalType = type === 'reels' ? 'reel' : type;
    return {
      url: `https://www.instagram.com/${canonicalType}/${shortcode}/`,
      key: `instagram:${canonicalType}:${shortcode}`,
      source: 'instagram',
      sourceLabel: 'Instagram',
      raw: rawValue
    };
  }

  if (!parts.length) return null;

  return {
    url: normalizedUrlText(parsed),
    key: `instagram:${parts.join('/')}`,
    source: 'instagram',
    sourceLabel: 'Instagram',
    raw: rawValue
  };
}

function normalizeTikTokParsedUrl(parsed, rawValue) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const isTikTok =
    host === 'tiktok.com' ||
    host.endsWith('.tiktok.com') ||
    host === 'vm.tiktok.com' ||
    host === 'vt.tiktok.com';

  if (!isTikTok) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const videoIndex = parts.findIndex(part => part.toLowerCase() === 'video');
  const videoId = videoIndex >= 0 ? parts[videoIndex + 1] || '' : '';

  if (videoId) {
    return {
      url: normalizedUrlText(parsed),
      key: `tiktok:${videoId}`,
      source: 'tiktok',
      sourceLabel: 'TikTok',
      raw: rawValue
    };
  }

  if (!parts.length) return null;

  return {
    url: normalizedUrlText(parsed),
    key: `tiktok:${host}:${parts.join('/')}`,
    source: 'tiktok',
    sourceLabel: 'TikTok',
    raw: rawValue
  };
}

function normalizeDouyinParsedUrl(parsed, rawValue) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const isDouyin =
    host === 'douyin.com' ||
    host.endsWith('.douyin.com') ||
    host === 'iesdouyin.com';

  if (!isDouyin) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const videoIndex = parts.findIndex(part => part.toLowerCase() === 'video');
  const queryVideoId =
    parsed.searchParams.get('modal_id') ||
    parsed.searchParams.get('aweme_id') ||
    parsed.searchParams.get('item_id') ||
    '';
  const noteId = queryVideoId || (videoIndex >= 0 ? parts[videoIndex + 1] || '' : '');

  if (noteId) {
    return {
      url: `https://www.douyin.com/video/${noteId}`,
      key: `douyin:${noteId}`,
      source: 'douyin',
      sourceLabel: 'Douyin',
      raw: rawValue
    };
  }

  if (!parts.length) return null;

  return {
    url: normalizedUrlText(parsed),
    key: `douyin:${host}:${parts.join('/')}`,
    source: 'douyin',
    sourceLabel: 'Douyin',
    raw: rawValue
  };
}

function normalizeXiaohongshuParsedUrl(parsed, rawValue) {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const isXiaohongshu =
    host === 'xiaohongshu.com' ||
    host.endsWith('.xiaohongshu.com') ||
    host === 'xhslink.com' ||
    host.endsWith('.xhslink.com') ||
    host === 'rednote.com' ||
    host.endsWith('.rednote.com');

  if (!isXiaohongshu) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const exploreIndex = parts.findIndex(part => part.toLowerCase() === 'explore');
  const itemIndex = parts.findIndex(part => part.toLowerCase() === 'item');
  const noteId = exploreIndex >= 0
    ? (parts[exploreIndex + 1] || '')
    : (itemIndex >= 0 ? (parts[itemIndex + 1] || '') : '');

  if (noteId) {
    const canonicalUrl = host === 'rednote.com' || host.endsWith('.rednote.com')
      ? withSearchParams(`https://www.xiaohongshu.com/explore/${noteId}`, parsed)
      : normalizedUrlText(parsed);

    return {
      url: canonicalUrl,
      key: `xiaohongshu:${noteId}`,
      source: 'xiaohongshu',
      sourceLabel: 'Xiaohongshu/Rednote',
      raw: rawValue
    };
  }

  if (!parts.length) return null;

  return {
    url: normalizedUrlText(parsed),
    key: `xiaohongshu:${host}:${parts.join('/')}`,
    source: 'xiaohongshu',
    sourceLabel: 'Xiaohongshu/Rednote',
    raw: rawValue
  };
}

export function normalizeMediaUrl(rawValue, options = {}) {
  let value = stripUrlToken(rawValue);

  if (!value) {
    return null;
  }

  value = ensureProtocol(value);
  if (!value) return null;

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const allowedSources = new Set(options.allowedSources || ['youtube', 'instagram', 'tiktok', 'douyin', 'xiaohongshu']);
  const normalized =
    normalizeYouTubeParsedUrl(parsed, rawValue) ||
    normalizeInstagramParsedUrl(parsed, rawValue) ||
    normalizeTikTokParsedUrl(parsed, rawValue) ||
    normalizeDouyinParsedUrl(parsed, rawValue) ||
    normalizeXiaohongshuParsedUrl(parsed, rawValue);

  return normalized && allowedSources.has(normalized.source) ? normalized : null;
}

export function normalizeYouTubeUrl(rawValue) {
  return normalizeMediaUrl(rawValue, { allowedSources: ['youtube'] });
}
