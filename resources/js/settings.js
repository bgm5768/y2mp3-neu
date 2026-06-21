/**
 * resources/js/settings.js
 * 설정 저장/불러오기 – Neutralinojs Storage API 사용
 */

const Settings = (() => {
  const STORAGE_KEY = 'yt_mp3_settings';

  const defaults = {
    saveDest:    'local',
    localPath:   '',
    quality:     '192',
    format:      'mp3',
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
    playerLastDuration: 0
  };

  let current = { ...defaults };

  async function load() {
    try {
      const raw = await Neutralino.storage.getData(STORAGE_KEY);
      current = { ...defaults, ...JSON.parse(raw) };
    } catch {
      current = { ...defaults };
    }
    return current;
  }

  async function save(patch) {
    current = { ...current, ...patch };
    await Neutralino.storage.setData(STORAGE_KEY, JSON.stringify(current));
    return current;
  }

  function get() { return { ...current }; }

  /** 현재 설정에 따른 실제 저장 경로 반환 */
  function getActiveSavePath() {
    return current.localPath;
  }

  return { load, save, get, getActiveSavePath };
})();
