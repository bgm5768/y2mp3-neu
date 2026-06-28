/**
 * resources/js/settings.js
 * 설정 저장/불러오기 – Neutralinojs Storage API 사용
 */

const Settings = (() => {
  const STORAGE_KEY = 'yt_mp3_settings';

  const defaults = {
    saveDest:    'local',
    localPath:   '',
    musicPath:   '',
    videoPath:   '',
    quality:     '192',
    format:      'mp3',
    videoQuality: 'best',
    videoFormat: 'mp4',
    embedThumb:  true,
    embedMeta:   true,
    proxy:       '',
    useProxy:    false,
    rateLimit:   '',
    useRateLimit: false,
    playerVolume: 0.9,
    playerOrderMode: 'normal',
    playerRepeatMode: 'stop-current',
    playerLastTrackId: '',
    playerLastTrackPath: '',
    playerLastPosition: 0,
    playerLastDuration: 0,
    playerActivePlaylistId: 'all',
    playerPlaylists: []
  };

  let current = { ...defaults };

  function normalizeSettings(source) {
    const next = { ...defaults, ...source };

    if (!next.musicPath && next.localPath) next.musicPath = next.localPath;
    if (!next.localPath && next.musicPath) next.localPath = next.musicPath;
    if (!next.videoPath) next.videoPath = next.musicPath || next.localPath || '';

    return next;
  }

  async function load() {
    try {
      const raw = await Neutralino.storage.getData(STORAGE_KEY);
      current = normalizeSettings(JSON.parse(raw));
    } catch {
      current = normalizeSettings({});
    }
    return current;
  }

  async function save(patch) {
    const nextPatch = { ...patch };
    if ('localPath' in nextPatch && !('musicPath' in nextPatch)) {
      nextPatch.musicPath = nextPatch.localPath;
    }
    if ('musicPath' in nextPatch) {
      nextPatch.localPath = nextPatch.musicPath;
    }

    current = normalizeSettings({ ...current, ...nextPatch });
    await Neutralino.storage.setData(STORAGE_KEY, JSON.stringify(current));
    return current;
  }

  function get() { return { ...current }; }

  /** 현재 설정에 따른 실제 저장 경로 반환 */
  function getActiveSavePath(mode = 'audio') {
    if (mode === 'video') {
      return current.videoPath || current.musicPath || current.localPath;
    }
    return current.musicPath || current.localPath;
  }

  return { load, save, get, getActiveSavePath };
})();
