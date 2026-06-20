/**
 * resources/js/converter.js
 * Extension과 통신하는 변환 로직
 */

const EXT_ID = 'js.neutralino.ytmp3';

const Converter = (() => {

  // ── Extension 이벤트 수신 등록 ────────────────────────────────────
  function init() {
    Neutralino.events.on(`${EXT_ID}:ready`,              onReady);
    Neutralino.events.on(`${EXT_ID}:videoInfo`,          onVideoInfo);
    Neutralino.events.on(`${EXT_ID}:progress`,           onProgress);
    Neutralino.events.on(`${EXT_ID}:done`,               onDone);
    Neutralino.events.on(`${EXT_ID}:cancelled`,          onCancelled);
    Neutralino.events.on(`${EXT_ID}:depsStatus`,         onDepsStatus);
    Neutralino.events.on(`${EXT_ID}:installFfmpegResult`,onInstallFfmpegResult);
    Neutralino.events.on(`${EXT_ID}:ytdlpUpdateProgress`,onYtdlpUpdateProgress);
    Neutralino.events.on(`${EXT_ID}:queueDone`,          onQueueDone);

    // Extension이 이미 실행 중인 경우 ready 이벤트를 놓칠 수 있으므로
    // init 시점에 직접 checkDeps를 지연 호출
    setTimeout(() => checkDeps(), 1500);
  }

  // ── Extension 으로 이벤트 전송 ────────────────────────────────────
  function dispatch(event, data = {}) {
    try {
      if (!window.Neutralino || !Neutralino.extensions || typeof Neutralino.extensions.dispatch !== 'function') {
        console.debug('[converter] extensions.dispatch not available');
        return;
      }
      // ensure we pass a plain object (native layer expects serializable objects)
      const safe = (typeof data === 'object' && !Array.isArray(data) && data !== null) ? data : { data };
      Neutralino.extensions.dispatch(EXT_ID, event, safe);
    } catch (err) {
      console.error('[converter] extensions.dispatch failed', err && err.message);
      try {
        const dbgPath = (typeof globalThis !== 'undefined' && globalThis.NL_PATH ? globalThis.NL_PATH : '.') + '\\resources\\bin\\extension_debug.log';
        const payload = JSON.stringify({ time: new Date().toISOString(), event, data, error: err && err.message }, null, 2) + '\n---\n';
        Neutralino.filesystem.writeFile(dbgPath, payload, { append: true }).catch(()=>{});
      } catch(e){}
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ──────────────────────────────────────────────────────────────────
  function getVideoInfo(url) {
    dispatch('getVideoInfo', { url });
  }

  function startDownload(options) {
    dispatch('startDownload', options);
  }

  function cancelDownload() {
    dispatch('cancelDownload');
  }

  function checkDeps() {
    dispatch('checkDeps');
  }

  function installFfmpeg() {
    dispatch('installFfmpeg');
  }

  function updateYtdlp() {
    dispatch('updateYtdlp', {});
  }

  function startQueue(items, opts) {
    dispatch('startQueue', { items, ...opts });
  }

  // ──────────────────────────────────────────────────────────────────
  //  내부 이벤트 핸들러
  // ──────────────────────────────────────────────────────────────────
  function onReady() {
    checkDeps();
  }

  function onVideoInfo(e) {
    const d = parse(e);
    if (d.ok) {
      UI.showVideoPreview(d);
      UI.enableConvertBtn(true);
    } else {
      Toast.show(`영상 정보를 가져오지 못했습니다: ${d.error}`, 'error');
    }
    UI.setFetchBtnLoading(false);
  }

  function onProgress(e) {
    const d = parse(e);
    if (d.itemId) {
      // 큐 아이템 업데이트
      Queue.update(d.itemId, { pct: d.pct });
      QueueUI.renderQueueItem(d.itemId, { pct: d.pct, status: 'running' });
    } else {
      // 단일 변환 진행
      UI.updateProgress(d);
    }
  }

  function onDone(e) {
    const d = parse(e);
    if (d.itemId) {
      Queue.update(d.itemId, { status: d.ok ? 'done' : 'error', errorMsg: d.error || '' });
      QueueUI.renderQueueItem(d.itemId, { status: d.ok ? 'done' : 'error' });
      if (!d.ok) Toast.show(`[큐] 변환 실패: ${d.error}`, 'error');
    } else {
      if (d.ok) {
        UI.showDoneCard(d);
        Toast.show(`✅ 완료: ${d.fileName}`, 'success');
      } else {
        UI.showError(d.error);
        Toast.show(`변환 실패: ${d.error}`, 'error');
      }
    }
  }

  function onCancelled() {
    UI.resetProgressCard();
    Toast.show('⛔ 변환이 취소되었습니다.', 'warning');
  }

  function onDepsStatus(e) {
    const d = parse(e);
    UI.updateDepsStatus(d);
  }

  function onInstallFfmpegResult(e) {
    const d = parse(e);
    Toast.show(d.message, d.ok ? 'success' : 'error');
  }

  function onYtdlpUpdateProgress(e) {
    const d = parse(e);
    Toast.show(d.message, d.error ? 'error' : 'success');
  }

  function onQueueDone(e) {
    const d = parse(e);
    Toast.show(`🎉 대기열 처리 완료! 총 ${d.total}개`, 'success');
  }

  function parse(e) {
    try {
      // Neutralinojs Extension 이벤트 구조:
      // e.detail = { data: "<JSON string>" }  또는  e.detail = "<JSON string>"
      const detail = e.detail;
      if (!detail) return {};

      // case 1: detail 자체가 이미 객체 (ffmpeg/ytdlp 등 내부 이벤트)
      if (typeof detail === 'object' && !Array.isArray(detail)) {
        // data 필드가 JSON string으로 감싸진 경우
        if (typeof detail.data === 'string') {
          try { return JSON.parse(detail.data); } catch { return detail; }
        }
        return detail;
      }

      // case 2: detail이 JSON string
      if (typeof detail === 'string') {
        return JSON.parse(detail);
      }

      return {};
    } catch (err) {
      console.error('[converter] parse error:', err, e);
      return {};
    }
  }

  return { init, getVideoInfo, startDownload, cancelDownload,
           checkDeps, installFfmpeg, updateYtdlp, startQueue };
})();
