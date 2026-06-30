/**
 * resources/js/settings/settings-ui.js
 * Settings tab rendering and settings-related event bindings.
 */

import { el } from '../core/dom.js';
import { Dialog } from '../ui/dialog.js';

export function createSettingsUi({ Settings, Neutralino, YTDlp, Toast, DependencyUI, getPlayer }) {
  const cookieBrowsers = {
    chrome: { label: 'Chrome', process: 'chrome.exe' },
    edge: { label: 'Edge', process: 'msedge.exe' },
    firefox: { label: 'Firefox', process: 'firefox.exe' }
  };

  function isChromiumCookieBrowser(value) {
    return value === 'chrome' || value === 'edge';
  }

  function getSelectedCookieBrowser() {
    return cookieBrowsers[el('cookie-browser-select')?.value || ''] || null;
  }

  async function isProcessRunning(processName) {
    const safeName = String(processName || '').replace(/[^A-Za-z0-9_.-]/g, '');
    if (!safeName) return false;

    try {
      const r = await Neutralino.os.execCommand(
        `cmd /c tasklist /FI "IMAGENAME eq ${safeName}" /NH`,
        { background: false }
      );
      return String((r.stdOut || '') + (r.stdErr || ''))
        .toLowerCase()
        .includes(safeName.toLowerCase());
    } catch {
      return false;
    }
  }

  async function killBrowserProcess(processName) {
    const safeName = String(processName || '').replace(/[^A-Za-z0-9_.-]/g, '');
    if (!safeName) return;

    await Neutralino.os.execCommand(
      `cmd /c taskkill /F /IM ${safeName} /T`,
      { background: false }
    );
  }

  function initSettingsTab() {
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

    el('cookie-auto-refresh-btn')?.addEventListener('click', async () => {
      const btn = el('cookie-auto-refresh-btn');
      if (btn) btn.disabled = true;

      try {
        const result = await YTDlp.refreshCookieFileFromBrowser({
          source: 'douyin',
          browser: 'firefox',
          url: 'https://www.douyin.com/',
          force: true
        });
        await Settings.save({ cookieBrowser: 'firefox', cookieFile: result.cookieFile });
        if (el('cookie-browser-select')) el('cookie-browser-select').value = 'firefox';
        const displayEl = el('cookie-file-display');
        if (displayEl) displayEl.textContent = result.cookieFile;
        Toast.show(result.warning || 'Firefox에서 Douyin 쿠키를 자동으로 가져왔습니다.', result.warning ? 'warning' : 'success', 8000);
      } catch (e) {
        Toast.show(`Douyin 쿠키 자동 가져오기 실패: ${e.message || e}`, 'error', 9000);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    el('cookie-file-btn')?.addEventListener('click', async () => {
      try {
        const files = await Neutralino.os.showOpenDialog('cookies.txt 선택', {
          filters: [
            { name: 'Cookies', extensions: ['txt'] },
            { name: 'All files', extensions: ['*'] }
          ]
        });
        const file = Array.isArray(files) ? files[0] : '';
        if (!file) return;

        const cookieCheck = await YTDlp.inspectCookieFileForSource?.('douyin', file);
        if (cookieCheck && !cookieCheck.ok) {
          Toast.show(cookieCheck.message || 'Douyin 쿠키 파일을 확인할 수 없습니다.', 'error', 9000);
          return;
        }

        await Settings.save({ cookieFile: file });
        const displayEl = el('cookie-file-display');
        if (displayEl) displayEl.textContent = file;
        Toast.show(cookieCheck?.warning || '쿠키 파일이 설정되었습니다.', cookieCheck?.warning ? 'warning' : 'success', 8000);
      } catch {
        Toast.show('쿠키 파일을 선택하지 못했습니다.', 'error');
      }
    });

    el('cookie-file-clear-btn')?.addEventListener('click', async () => {
      await Settings.save({ cookieFile: '' });
      const displayEl = el('cookie-file-display');
      if (displayEl) displayEl.textContent = '선택 안 됨';
      Toast.show('쿠키 파일 설정을 해제했습니다.', 'info');
    });

    el('cookie-browser-cleanup-btn')?.addEventListener('click', async () => {
      const browser = getSelectedCookieBrowser();
      if (!browser) {
        Toast.show('먼저 브라우저 쿠키를 선택하세요.', 'warning');
        return;
      }

      const running = await isProcessRunning(browser.process);
      if (!running) {
        Toast.show(`${browser.label} 프로세스가 실행 중이지 않습니다. 다시 다운로드해 보세요.`, 'success', 5000);
        return;
      }

      const confirmed = await Dialog.confirm({
        kicker: '쿠키 잠금 해제',
        title: `${browser.label} 프로세스 정리`,
        message: `${browser.label}가 백그라운드에서 실행 중이라 쿠키 DB가 잠겨 있을 수 있습니다.`,
        detail: `${browser.label} 창과 백그라운드 프로세스를 강제로 종료합니다. 작성 중인 페이지나 업로드 중인 작업이 있으면 먼저 저장하세요.`,
        confirmText: '종료',
        cancelText: '취소',
        danger: true
      });
      if (!confirmed) return;

      const btn = el('cookie-browser-cleanup-btn');
      if (btn) btn.disabled = true;

      try {
        await killBrowserProcess(browser.process);
      } catch {
        // taskkill returns a non-zero code if the process is already gone.
      } finally {
        if (btn) btn.disabled = false;
      }

      if (await isProcessRunning(browser.process)) {
        Toast.show(`${browser.label} 프로세스가 아직 남아 있습니다. 작업 관리자에서 종료한 뒤 다시 시도하세요.`, 'error', 7000);
      } else {
        Toast.show(`${browser.label} 프로세스를 정리했습니다. 다시 다운로드해 보세요.`, 'success', 6000);
      }
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
      const cookieBrowser = el('cookie-browser-select')?.value || '';
      const embedThumb = true;
      const embedMeta = true;
      await Settings.save({ saveDest: 'local', quality, format, videoQuality, videoFormat, cookieBrowser, embedThumb, embedMeta });
      getPlayer()?.invalidate();
      Toast.show('설정이 저장되었습니다.', 'success');
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
    if (el('cookie-browser-select')) el('cookie-browser-select').value = s.cookieBrowser || '';
    const cookieFileDisplay = el('cookie-file-display');
    if (cookieFileDisplay) cookieFileDisplay.textContent = s.cookieFile || '선택 안 됨';
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
    if (!s.cookieFile && isChromiumCookieBrowser(s.cookieBrowser)) {
      patch.cookieBrowser = 'firefox';
    }

    return Object.keys(patch).length ? Settings.save(patch) : s;
  }

  return { initSettingsTab, applySettingsToUI, ensureDefaultLocalPath };
}
