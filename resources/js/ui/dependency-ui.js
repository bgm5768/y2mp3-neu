/**
 * resources/js/ui/dependency-ui.js
 * Dependency status rendering and dependency-gated navigation state.
 */

import { el } from '../core/dom.js';

export function createDependencyUi({ appState }) {
  let onGateChange = () => {};

  function depsReady() {
    return !!(appState.currentDepsStatus.ffmpeg?.ok && appState.currentDepsStatus.ytdlp?.ok);
  }

  function setDependencyProgress(tool, payload, visible = true) {
    const wrap = el(`${tool}-install-progress`);
    const bar = el(`${tool}-install-bar`);
    const text = el(`${tool}-install-text`);
    if (!wrap || !bar || !text) return;

    const progress = typeof payload === 'object' && payload !== null
      ? payload
      : { message: String(payload || '') };
    const pct = Number.isFinite(Number(progress.pct)) ? Math.max(0, Math.min(100, Number(progress.pct))) : null;

    wrap.classList.toggle('hidden', !visible);
    wrap.classList.toggle('is-indeterminate', pct === null);
    bar.style.width = pct === null ? '35%' : `${pct}%`;
    text.textContent = `${progress.message || '진행 중…'}${pct === null ? '' : ` · ${Math.round(pct)}%`}`;
  }

  function updateDependencyGate() {
    const ready = depsReady();
    const convertNav = document.querySelector('.nav-btn[data-tab="convert"]');
    const summary = el('dependency-summary');
    const reason = '설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.';

    if (convertNav) {
      convertNav.disabled = !ready;
      convertNav.classList.toggle('is-disabled', !ready);
      convertNav.title = ready ? '' : reason;
      convertNav.setAttribute('aria-disabled', ready ? 'false' : 'true');
    }

    if (summary) {
      summary.classList.toggle('status-ok', ready);
      summary.classList.toggle('status-error', !ready);
      summary.textContent = ready
        ? '필수 의존성 도구가 모두 정상 설치되어 변환 기능을 사용할 수 있습니다.'
        : reason;
    }

    onGateChange(ready);
  }

  function updateDepsStatus({ ffmpeg, ytdlp }) {
    const ffmpegVer = el('ffmpeg-version');
    const ytdlpVer  = el('ytdlp-version');
    const ffmpegPath = el('ffmpeg-path');
    const ytdlpPath  = el('ytdlp-path');

    if (ffmpeg) {
      appState.currentDepsStatus.ffmpeg = { ok: !!ffmpeg.ok, version: ffmpeg.version || '', path: ffmpeg.path || '' };
      if (ffmpegVer) {
        const ver = ffmpeg.ok ? (ffmpeg.version || '버전 확인됨') : '';
        ffmpegVer.className = `dep-version ${ffmpeg.ok ? 'status-ok' : 'status-error'}`;
        ffmpegVer.textContent = ffmpeg.ok ? `정상 설치됨 · ${ver}` : '필수 의존성 없음 · 설치 필요';
      }
      if (ffmpegPath) {
        ffmpegPath.textContent = ffmpeg.ok && ffmpeg.path ? `설치 위치: ${ffmpeg.path}` : '설치 위치: 아직 없음';
        ffmpegPath.title = ffmpeg.path || '';
      }
    }
    if (ytdlp) {
      appState.currentDepsStatus.ytdlp = { ok: !!ytdlp.ok, version: ytdlp.version || '', path: ytdlp.path || '' };
      if (ytdlpVer) {
        const ver = ytdlp.ok ? (ytdlp.version || '버전 확인됨') : '';
        ytdlpVer.className = `dep-version ${ytdlp.ok ? 'status-ok' : 'status-error'}`;
        ytdlpVer.textContent = ytdlp.ok ? `정상 설치됨 · ${ver}` : '필수 의존성 없음 · 설치 필요';
      }
      if (ytdlpPath) {
        ytdlpPath.textContent = ytdlp.ok && ytdlp.path ? `설치 위치: ${ytdlp.path}` : '설치 위치: 아직 없음';
        ytdlpPath.title = ytdlp.path || '';
      }
    }

    updateDependencyGate();

    try {
      localStorage.setItem('yt_mp3_dep_status', JSON.stringify({
        ffmpeg: ffmpeg ? { ok: !!ffmpeg.ok, version: ffmpeg.version || '', path: ffmpeg.path || '' } : null,
        ytdlp:  ytdlp  ? { ok: !!ytdlp.ok,  version: ytdlp.version  || '', path: ytdlp.path || '' } : null
      }));
    } catch {}
  }

  function restoreDepsStatus() {
    try {
      const raw = localStorage.getItem('yt_mp3_dep_status');
      if (!raw) return false;
      const cached = JSON.parse(raw);
      if (cached && (cached.ffmpeg || cached.ytdlp)) {
        updateDepsStatus(cached);
        return true;
      }
    } catch {}
    return false;
  }

  function setGateChangeHandler(handler) {
    onGateChange = typeof handler === 'function' ? handler : () => {};
  }

  return {
    depsReady,
    setDependencyProgress,
    updateDependencyGate,
    updateDepsStatus,
    restoreDepsStatus,
    setGateChangeHandler
  };
}
