/**
 * resources/js/core/window-guard.js
 * Keeps the native Neutralino window recoverable after native double-click resize glitches.
 */

const MIN_SAFE_WIDTH = 800;
const MIN_SAFE_HEIGHT = 580;
const CHECK_DELAY_MS = 80;
const RECENT_TRIGGER_MS = 1200;

let restoreTimer = null;
let lastGuardTriggerAt = 0;

async function restoreWindowIfNeeded(Neutralino) {
  if (!Neutralino?.window) return;

  try {
    const visible = typeof Neutralino.window.isVisible === 'function'
      ? await Neutralino.window.isVisible()
      : true;
    const size = typeof Neutralino.window.getSize === 'function'
      ? await Neutralino.window.getSize()
      : null;
    const width = Number(size?.width) || 0;
    const height = Number(size?.height) || 0;
    const badSize = width > 0 && height > 0 && (width < MIN_SAFE_WIDTH || height < MIN_SAFE_HEIGHT);

    if (!visible) {
      await Neutralino.window.show();
    }

    if (badSize) {
      await Neutralino.window.setSize({
        width: Math.max(width, MIN_SAFE_WIDTH),
        height: Math.max(height, MIN_SAFE_HEIGHT)
      });
      await Neutralino.window.center();
    }

    if (!visible || badSize) {
      await Neutralino.window.focus();
    }
  } catch {
    // Window recovery is best-effort only.
  }
}

function scheduleWindowRestore(Neutralino) {
  lastGuardTriggerAt = Date.now();
  if (restoreTimer) window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    restoreTimer = null;
    void restoreWindowIfNeeded(Neutralino);
  }, CHECK_DELAY_MS);
}

export function installWindowGuard(Neutralino) {
  if (!Neutralino?.window) return;

  window.addEventListener('resize', () => scheduleWindowRestore(Neutralino));
  document.addEventListener('dblclick', () => scheduleWindowRestore(Neutralino), true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (Date.now() - lastGuardTriggerAt > RECENT_TRIGGER_MS) return;
    scheduleWindowRestore(Neutralino);
  });
  void restoreWindowIfNeeded(Neutralino);
}
