/**
 * resources/js/converter/url-parser.js
 * YouTube URL token parsing and normalization.
 */

export function splitUrlTokens(value) {
  return String(value || '')
    .split(/[s,]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function stripUrlToken(token) {
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

export function normalizeYouTubeUrl(rawValue) {
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

  const host = parsed.hostname.toLowerCase().replace(/^www./, '').replace(/^m./, '');
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
