/**
 * resources/js/settings/settings-ui.js
 * Settings tab rendering and settings-related event bindings.
 */

import { el } from '../core/dom.js';

export function createSettingsUi({ Settings, Neutralino, YTDlp, Toast, DependencyUI, AppUpdater, getPlayer }) {
  function renderUpdateStatus(state = AppUpdater?.getState?.() || {}) {
    const currentEl = el('app-current-version');
    const latestEl = el('app-latest-version');
    const statusEl = el('app-update-status');
    const checkBtn = el('app-update-check-btn');
    const restartBtn = el('app-update-restart-btn');
    const releaseLink = el('app-release-link');

    if (currentEl) currentEl.textContent = state.currentVersion || window.NL_APPVERSION || '-';
    if (latestEl) latestEl.textContent = state.latestVersion || '확인 전';
    if (statusEl) {
      statusEl.textContent = state.lastError
        ? state.lastError
        : (state.lastMessage || 'GitHub 릴리스에서 새 resources.neu를 자동으로 확인합니다.');
      statusEl.className = `settings-desc app-update-status ${state.lastError ? 'status-error' : ''}`;
    }
    if (checkBtn) checkBtn.disabled = !!state.checking || !!state.installing;
    if (restartBtn) restartBtn.classList.toggle('hidden', !state.updateReady);
    if (releaseLink) {
      releaseLink.classList.toggle('hidden', !state.latestReleaseUrl);
      if (state.latestReleaseUrl) releaseLink.href = state.latestReleaseUrl;
    }
  }

  function initSettingsTab() {
    AppUpdater?.setStatusRenderer?.(renderUpdateStatus);

    el('app-update-check-btn')?.addEventListener('click', async () => {
      const btn = el('app-update-check-btn');
      if (btn) btn.disabled = true;
      try {
        await AppUpdater.checkAndInstall({ manual: true, force: true });
      } catch (e) {
        Toast.show(`업데이트 확인 실패: ${e.message || e}`, 'error', 8000);
      } finally {
        renderUpdateStatus();
      }
    });

    el('app-update-restart-btn')?.addEventListener('click', () => {
      void AppUpdater?.restart?.();
    });

    const folderBtns = [
      {
        btn: 'music-path-btn',
        display: 'music-path-display',
        key: 'musicPath',
        title: '음악 저장 폴더 선택',
        affectsPlayer: true
      },
      {
        btn: 'video-path-btn',
        display: 'video-path-display',
        key: 'videoPath',
        title: '동영상 저장 폴더 선택',
        openBtn: 'video-open-folder-btn',
        affectsPlayer: false
      }
    ];

    folderBtns.forEach(({ btn, display, key, title, openBtn, affectsPlayer }) => {
      el(btn)?.addEventListener('click', async () => {
        try {
          const p = await Neutralino.os.showFolderDialog(title);
          if (p) {
            const displayEl = el(display);
            if (displayEl) displayEl.textContent = p;
            await Settings.save({ saveDest: 'local', [key]: p });
            if (affectsPlayer) getPlayer()?.invalidate();
          }
        } catch {}
      });

      el(openBtn)?.addEventListener('click', async () => {
        const path = Settings.getActiveSavePath(key === 'videoPath' ? 'video' : 'audio');
        if (!path) {
          Toast.show('먼저 저장 위치를 선택하세요.', 'warning');
          return;
        }
        try {
          await Neutralino.os.open(path);
        } catch {
          Toast.show('저장 폴더를 열 수 없습니다.', 'error');
        }
      });
    });

    el('install-ffmpeg-btn').addEventListener('click', async () => {
      const btn = el('install-ffmpeg-btn');
      btn.disabled = true;
      btn.textContent = '설치 중…';
      DependencyUI.setDependencyProgress('ffmpeg', { pct: 0, message: '다운로드 준비 중…' }, true);
      try {
        const deps = await YTDlp.installFfmpeg(progress => {
          DependencyUI.setDependencyProgress('ffmpeg', progress, true);
          if (typeof progress === 'string') Toast.show(progress, 'info', 5000);
        });
        DependencyUI.updateDepsStatus(deps);
        DependencyUI.setDependencyProgress('ffmpeg', { pct: 100, message: '정상 설치 완료' }, true);
        Toast.show(`ffmpeg ${deps.ffmpeg.version} 준비 완료`, 'success', 5000);
      } catch (e) {
        DependencyUI.setDependencyProgress('ffmpeg', { pct: 100, message: `설치 실패: ${e.message || e}` }, true);
        Toast.show(`ffmpeg 설치 실패: ${e.message || e}`, 'error', 8000);
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇ 설치 / 업데이트';
      }
    });

    el('update-ytdlp-btn').addEventListener('click', async () => {
      const btn = el('update-ytdlp-btn');
      btn.disabled = true;
      btn.textContent = '설치 중…';
      DependencyUI.setDependencyProgress('ytdlp', { pct: 0, message: '다운로드 준비 중…' }, true);
      try {
        const deps = await YTDlp.updateYtdlp(progress => {
          DependencyUI.setDependencyProgress('ytdlp', progress, true);
          if (typeof progress === 'string') Toast.show(progress, 'info', 5000);
        });
        DependencyUI.updateDepsStatus(deps);
        DependencyUI.setDependencyProgress('ytdlp', { pct: 100, message: '정상 설치 완료' }, true);
        Toast.show(`yt-dlp ${deps.ytdlp.version} 준비 완료`, 'success', 5000);
      } catch (e) {
        DependencyUI.setDependencyProgress('ytdlp', { pct: 100, message: `설치 실패: ${e.message || e}` }, true);
        Toast.show(`yt-dlp 설치 실패: ${e.message || e}`, 'error', 8000);
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇ 업데이트';
      }
    });

    el('save-settings-btn').addEventListener('click', async () => {
      const quality = el('quality-select')?.value || '192';
      const format = el('format-select')?.value || 'mp3';
      const videoQuality = el('video-quality-select')?.value || 'best';
      const videoFormat = el('video-format-select')?.value || 'mp4';
      const autoUpdateEnabled = el('auto-update-toggle')?.checked !== false;
      const embedThumb = true;
      const embedMeta = true;
      await Settings.save({ saveDest: 'local', quality, format, videoQuality, videoFormat, autoUpdateEnabled, embedThumb, embedMeta });
      getPlayer()?.invalidate();
      Toast.show('설정이 저장되었습니다.', 'success');
      renderUpdateStatus();
    });
  }

  function applySettingsToUI(s) {
    const musicPathDisplay = el('music-path-display');
    const videoPathDisplay = el('video-path-display');
    if (musicPathDisplay) musicPathDisplay.textContent = s.musicPath || s.localPath || '경로 선택 안 됨';
    if (videoPathDisplay) videoPathDisplay.textContent = s.videoPath || '경로 선택 안 됨';
    if (s.quality) el('quality-select').value = s.quality;
    if (s.format) el('format-select').value = s.format;
    if (s.videoQuality && el('video-quality-select')) el('video-quality-select').value = s.videoQuality;
    if (s.videoFormat && el('video-format-select')) el('video-format-select').value = s.videoFormat;
    if (el('auto-update-toggle')) el('auto-update-toggle').checked = s.autoUpdateEnabled !== false;
    renderUpdateStatus();
  }

  async function ensureDefaultLocalPath(s) {
    async function firstAvailablePath(names) {
      for (const name of names) {
        try {
          const path = await Neutralino.os.getPath(name);
          if (path) return path;
        } catch {}
      }
      return '';
    }

    if (s.saveDest !== 'local') {
      s = await Settings.save({ saveDest: 'local' });
    }

    const patch = {};
    const musicPath = s.musicPath || s.localPath || '';
    if (!musicPath) {
      patch.musicPath = await firstAvailablePath(['music', 'downloads', 'documents']);
    }
    if (!s.videoPath) {
      patch.videoPath = await firstAvailablePath(['video', 'downloads', 'documents']) || patch.musicPath || musicPath;
    }
    if (!s.localPath && (patch.musicPath || musicPath)) {
      patch.localPath = patch.musicPath || musicPath;
    }
    return Object.keys(patch).length ? Settings.save(patch) : s;
  }

  return { initSettingsTab, applySettingsToUI, ensureDefaultLocalPath };
}
