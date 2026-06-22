/**
 * resources/js/player/track-list.js
 * Track file helpers, library scanning, sorting, and queue rebuilding.
 */

export function createTrackList({ state, Neutralino, playlistSourceTracks, displayDuration }) {
  const audioExts = /\.(mp3|m4a|wav|ogg|opus|aac|flac)$/i;
  const playableExts = new Set(['mp3', 'm4a', 'wav', 'ogg', 'opus', 'aac', 'flac']);

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

  function formatBytes(size) {
    const value = Number(size) || 0;
    if (!value) return '';
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }


  function shuffle(list) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
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

  function rebuildQueue(preserveTrackId = currentTrack()?.id || '') {
    state.queue = sortTracks(playlistSourceTracks());
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

  return {
    joinPath,
    isAbsolutePath,
    resolveEntryPath,
    isAudioEntry,
    fileTime,
    fileName,
    trackTitle,
    directoryName,
    fileExtension,
    normalizeRenameFileName,
    validateFileName,
    pathExists,
    formatBytes,
    shuffle,
    trackSortValue,
    sortTracks,
    rebuildQueue,
    mergeKnownTrackData,
    currentTrack,
    queueIndexByTrackId,
    scanAudioFiles
  };
}
