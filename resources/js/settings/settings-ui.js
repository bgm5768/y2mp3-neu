/**
 * resources/js/settings/settings-ui.js
 * Settings tab rendering and settings-related event bindings.
 */

import { el } from '../core/dom.js';

export function createSettingsUi({ Settings, Neutralino, YTDlp, Toast, DependencyUI, getPlayer }) {
  function initSettingsTab() {
    const folderBtns = [
      { btn: 'local-path-btn', display: 'local-path-display', key: 'localPath', title: '저장 폴더 선택' }
    ];

    folderBtns.forEach(({ btn, display, key, title }) => {
      el(btn)?.addEventListener('click', async () => {
        try {
          const p = await Neutralino.os.showFolderDialog(title);
          if (p) {
            const displayEl = el(display);
            if (displayEl) displayEl.textContent = p;
            await Settings.save({ saveDest: 'local', [key]: p });
            getPlayer()?.invalidate();
          }
        } catch {}
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
      const format  = el('format-select')?.value || 'mp3';
      const embedThumb = true;
      const embedMeta = true;
      await Settings.save({ saveDest: 'local', quality, format, embedThumb, embedMeta });
      getPlayer()?.invalidate();
      Toast.show('설정이 저장되었습니다.', 'success');
    });
  }

  function applySettingsToUI(s) {
    const localPathDisplay = el('local-path-display');
    if (localPathDisplay) localPathDisplay.textContent = s.localPath || '경로 선택 안 됨';
    if (s.quality) el('quality-select').value = s.quality;
    if (s.format) el('format-select').value = s.format;
  }

  async function ensureDefaultLocalPath(s) {
    if (s.saveDest !== 'local') {
      s = await Settings.save({ saveDest: 'local' });
    }

    if (s.localPath) return s;

    const preferredPaths = ['music', 'downloads', 'documents'];
    for (const name of preferredPaths) {
      try {
        const path = await Neutralino.os.getPath(name);
        if (path) return await Settings.save({ localPath: path });
      } catch {}
    }
    return s;
  }

  return { initSettingsTab, applySettingsToUI, ensureDefaultLocalPath };
}
