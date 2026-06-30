/**
 * resources/js/core/app-updater.js
 * GitHub Release backed Neutralino resources.neu updater.
 */

const UPDATE_REPOSITORY = 'bgm5768/y2mp3-neu';
const UPDATE_ASSET_NAME = 'update.json';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split(/[.-]/).map(part => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(/[.-]/).map(part => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length, 3);

  for (let i = 0; i < length; i += 1) {
    const av = Number.isFinite(left[i]) ? left[i] : 0;
    const bv = Number.isFinite(right[i]) ? right[i] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function isDevRuntime() {
  const args = Array.isArray(window.NL_ARGS) ? window.NL_ARGS : [];
  return args.some(arg =>
    String(arg || '').includes('--load-dir-res') ||
    String(arg || '').includes('--neu-dev-auto-reload')
  );
}

function currentVersion() {
  return window.NL_APPVERSION || '0.0.0';
}

function latestReleaseApiUrl() {
  return `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
}

function latestManifestFallbackUrl() {
  return `https://github.com/${UPDATE_REPOSITORY}/releases/latest/download/${UPDATE_ASSET_NAME}`;
}

function findAsset(release, name) {
  const target = String(name || '').toLowerCase();
  return (release?.assets || []).find(asset =>
    String(asset?.name || '').toLowerCase() === target
  ) || null;
}

export function createAppUpdater({ Neutralino, Settings, Toast }) {
  const state = {
    checking: false,
    installing: false,
    latestVersion: '',
    latestReleaseUrl: '',
    lastMessage: '',
    updateReady: false,
    lastError: ''
  };

  let renderStatus = () => {};

  function getState() {
    return {
      ...state,
      currentVersion: currentVersion(),
      autoUpdateEnabled: Settings.get().autoUpdateEnabled !== false,
      devRuntime: isDevRuntime()
    };
  }

  function emit() {
    try { renderStatus(getState()); } catch {}
  }

  function setStatus(patch) {
    Object.assign(state, patch);
    emit();
  }

  async function fetchLatestRelease() {
    const response = await fetch(latestReleaseApiUrl(), {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub 릴리스 확인 실패 (${response.status})`);
    }
    return response.json();
  }

  async function resolveLatestManifestUrl() {
    const release = await fetchLatestRelease();
    const updateAsset = findAsset(release, UPDATE_ASSET_NAME);
    const manifestUrl = updateAsset?.browser_download_url || latestManifestFallbackUrl();

    return {
      release,
      manifestUrl,
      releaseUrl: release?.html_url || `https://github.com/${UPDATE_REPOSITORY}/releases/latest`
    };
  }

  async function check({ manual = false } = {}) {
    if (state.checking || state.installing) return getState();

    setStatus({
      checking: true,
      lastError: '',
      lastMessage: manual ? 'GitHub 릴리스 확인 중' : '업데이트 확인 중'
    });

    try {
      const { release, manifestUrl, releaseUrl } = await resolveLatestManifestUrl();
      const manifest = await Neutralino.updater.checkForUpdates(manifestUrl);
      const hasUpdate = compareVersions(manifest.version, currentVersion()) > 0;

      setStatus({
        checking: false,
        latestVersion: manifest.version || release?.tag_name || '',
        latestReleaseUrl: releaseUrl,
        lastMessage: hasUpdate ? `새 버전 ${manifest.version} 발견` : '최신 버전입니다',
        updateReady: false
      });

      return {
        ...getState(),
        hasUpdate,
        manifest,
        release,
        manifestUrl
      };
    } catch (e) {
      setStatus({
        checking: false,
        lastError: e.message || String(e || ''),
        lastMessage: '업데이트 확인 실패'
      });
      if (manual) throw e;
      return { ...getState(), hasUpdate: false, error: e };
    }
  }

  async function installCheckedUpdate(checkResult) {
    if (!checkResult?.hasUpdate) return false;
    if (isDevRuntime()) {
      const message = '개발 실행 모드에서는 자동 업데이트 설치를 건너뜁니다. 빌드된 앱에서 확인하세요.';
      setStatus({ lastError: message, lastMessage: '업데이트 설치 건너뜀' });
      throw new Error(message);
    }

    setStatus({
      installing: true,
      lastError: '',
      lastMessage: `새 버전 ${checkResult.manifest.version} 다운로드 중`
    });

    try {
      await Neutralino.updater.install();
      await Settings.save({
        pendingUpdateVersion: checkResult.manifest.version,
        lastUpdateInstallAt: Date.now()
      });
      setStatus({
        installing: false,
        updateReady: true,
        latestVersion: checkResult.manifest.version,
        latestReleaseUrl: checkResult.release?.html_url || state.latestReleaseUrl,
        lastMessage: `새 버전 ${checkResult.manifest.version} 설치 완료`
      });
      return true;
    } catch (e) {
      setStatus({
        installing: false,
        lastError: e.message || String(e || ''),
        lastMessage: '업데이트 설치 실패'
      });
      throw e;
    }
  }

  async function checkAndInstall({ manual = false, force = false } = {}) {
    const settings = Settings.get();
    if (settings.autoUpdateEnabled === false && !manual) return getState();

    const now = Date.now();
    if (!force && !manual && settings.lastUpdateCheckAt &&
        now - Number(settings.lastUpdateCheckAt) < UPDATE_CHECK_INTERVAL_MS) {
      setStatus({ lastMessage: '최근에 업데이트를 확인했습니다' });
      return getState();
    }

    await Settings.save({ lastUpdateCheckAt: now });
    const result = await check({ manual });
    if (!result.hasUpdate) {
      if (manual) Toast.show('현재 최신 버전입니다.', 'success', 4000);
      return result;
    }

    try {
      const installed = await installCheckedUpdate(result);
      if (installed) {
        Toast.show(`새 버전 ${result.manifest.version} 설치 완료. 재시작하면 적용됩니다.`, 'success', 0, {
          label: '재시작',
          onClick: () => restart()
        });
      }
    } catch (e) {
      if (manual) Toast.show(`업데이트 설치 실패: ${e.message || e}`, 'error', 8000);
    }

    return getState();
  }

  async function restart() {
    try {
      await Neutralino.app.restartProcess();
    } catch {
      await Neutralino.app.exit();
    }
  }

  function setStatusRenderer(fn) {
    renderStatus = typeof fn === 'function' ? fn : () => {};
    emit();
  }

  return {
    check,
    checkAndInstall,
    getState,
    restart,
    setStatusRenderer
  };
}
