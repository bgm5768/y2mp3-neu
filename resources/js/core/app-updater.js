/**
 * resources/js/core/app-updater.js
 * GitHub Release backed resources.neu updater.
 */

const UPDATE_REPOSITORY = 'bgm5768/y2mp3-neu';
const RESOURCES_ASSET_NAME = 'resources.neu';
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

function releaseUnavailableMessage(status) {
  if (status === 404) {
    return 'GitHub 최신 공개 Release를 찾을 수 없습니다. draft/prerelease가 아닌 공개 Release가 필요합니다.';
  }
  return `GitHub 릴리스 확인 실패 (${status})`;
}

function findAsset(release, name) {
  const target = String(name || '').toLowerCase();
  return (release?.assets || []).find(asset =>
    String(asset?.name || '').toLowerCase() === target
  ) || null;
}

function appRootPath() {
  return (typeof window.NL_PATH === 'string' && window.NL_PATH) ||
    (typeof NL_PATH !== 'undefined' && NL_PATH) ||
    '.';
}

function joinPath(base, file) {
  const root = String(base || '').replace(/[\\/]+$/, '');
  const separator = root.includes('/') && !root.includes('\\') ? '/' : '\\';
  return `${root}${separator}${file}`;
}

function psLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function utf16leBase64(input) {
  let binary = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
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
      throw new Error(releaseUnavailableMessage(response.status));
    }

    const release = await response.json();
    const version = normalizeVersion(release?.tag_name);
    const resourceAsset = findAsset(release, RESOURCES_ASSET_NAME);

    if (!version) {
      throw new Error('최신 Release 태그에서 버전을 확인할 수 없습니다.');
    }
    if (!resourceAsset?.browser_download_url) {
      throw new Error(`최신 Release에 ${RESOURCES_ASSET_NAME} 에셋이 없습니다.`);
    }

    return {
      release,
      version,
      resourceAsset,
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
      const latest = await fetchLatestRelease();
      const hasUpdate = compareVersions(latest.version, currentVersion()) > 0;

      setStatus({
        checking: false,
        latestVersion: latest.version,
        latestReleaseUrl: latest.releaseUrl,
        lastMessage: hasUpdate ? `새 버전 ${latest.version} 발견` : '최신 버전입니다',
        updateReady: false
      });

      return {
        ...getState(),
        hasUpdate,
        ...latest
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

  async function downloadResources(asset) {
    const target = joinPath(appRootPath(), RESOURCES_ASSET_NAME);
    const temp = `${target}.download`;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
      `$url = ${psLiteral(asset.browser_download_url)}`,
      `$target = ${psLiteral(target)}`,
      `$temp = ${psLiteral(temp)}`,
      'if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }',
      'Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing',
      '$size = (Get-Item -LiteralPath $temp).Length',
      "if ($size -lt 1024) { throw 'Downloaded resources.neu is too small.' }",
      'Move-Item -LiteralPath $temp -Destination $target -Force',
      'Write-Output $size'
    ].join('; ');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${utf16leBase64(script)}`;
    const result = await Neutralino.os.execCommand(command, { background: false });

    if (result.exitCode !== 0) {
      const output = `${result.stdOut || ''}\n${result.stdErr || ''}`.trim();
      throw new Error(output || `resources.neu 다운로드 실패 (${result.exitCode})`);
    }

    return Number(String(result.stdOut || '').trim().split(/\s+/).pop()) || 0;
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
      lastMessage: `새 버전 ${checkResult.version} 다운로드 중`
    });

    try {
      await downloadResources(checkResult.resourceAsset);
      await Settings.save({
        pendingUpdateVersion: checkResult.version,
        lastUpdateInstallAt: Date.now()
      });
      setStatus({
        installing: false,
        updateReady: true,
        latestVersion: checkResult.version,
        latestReleaseUrl: checkResult.releaseUrl || state.latestReleaseUrl,
        lastMessage: `새 버전 ${checkResult.version} 설치 완료`
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
        Toast.show(`새 버전 ${result.version} 설치 완료. 재시작하면 적용됩니다.`, 'success', 0, {
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
