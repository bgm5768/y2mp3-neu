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
    /^((www|m|vm|vt)\.)?tiktok\.com\//i.test(value);

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

  const allowedSources = new Set(options.allowedSources || ['youtube', 'instagram', 'tiktok']);
  const normalized =
    normalizeYouTubeParsedUrl(parsed, rawValue) ||
    normalizeInstagramParsedUrl(parsed, rawValue) ||
    normalizeTikTokParsedUrl(parsed, rawValue);

  return normalized && allowedSources.has(normalized.source) ? normalized : null;
}

export function normalizeYouTubeUrl(rawValue) {
  return normalizeMediaUrl(rawValue, { allowedSources: ['youtube'] });
}
