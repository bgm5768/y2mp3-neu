/**
 * resources/js/core/app-state.js
 * App-level mutable state for conversion and dependency UI.
 */

export function createAppState() {
  return {
    cancelController: null,
    cancelRequested: false,
    currentItemId: null,
    isQueueRunning: false,
    dependencyInstallPromise: null,
    currentDepsStatus: {
      ffmpeg: { ok: false, version: '' },
      ytdlp: { ok: false, version: '' }
    },
    currentUrlAnalysis: {
      valid: [],
      duplicateCount: 0,
      invalid: []
    }
  };
}
