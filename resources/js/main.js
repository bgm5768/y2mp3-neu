/**
 * resources/js/main.js
 * App bootstrap and module wiring.
 */

'use strict';

let Player = null;

function initTabs({ Toast, DependencyUI, getPlayer }) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        Toast.show('설정 > 의존성 도구에서 ffmpeg와 yt-dlp를 설치해 주세요.', 'error', 5000);
        return;
      }
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'player') {
        void getPlayer()?.loadLibrary({ force: true });
      }
    });
  });
  DependencyUI.updateDependencyGate();
}

async function loadModules() {
  const [
    { createAppState },
    { Toast },
    { createDependencyUi },
    { createQueueUi },
    { createConverter },
    { createPlayer },
    { createSettingsUi }
  ] = await Promise.all([
    import('./core/app-state.js'),
    import('./ui/toast.js'),
    import('./ui/dependency-ui.js'),
    import('./converter/queue-ui.js'),
    import('./converter/converter.js'),
    import('./player/player.js'),
    import('./settings/settings-ui.js')
  ]);

  const appState = createAppState();
  const DependencyUI = createDependencyUi({ appState });
  const QueueUI = createQueueUi({ Queue, appState });
  const getPlayer = () => Player;

  Player = createPlayer({ Settings, Neutralino, Toast });
  const Converter = createConverter({
    appState,
    Queue,
    QueueUI,
    YTDlp,
    Neutralino,
    Settings,
    Toast,
    DependencyUI,
    getPlayer
  });
  const SettingsUI = createSettingsUi({ Settings, Neutralino, YTDlp, Toast, DependencyUI, getPlayer });

  DependencyUI.setGateChangeHandler(Converter.updateConvertButton);

  return { Toast, DependencyUI, Converter, SettingsUI, getPlayer };
}

Neutralino.init();
Neutralino.events.on('windowClose', () => Neutralino.app.exit());

(async () => {
  let modules;
  try {
    modules = await loadModules();
  } catch (e) {
    console.error(e);
    alert(`App modules failed to load: ${e.message || e}`);
    return;
  }

  const { Toast, DependencyUI, Converter, SettingsUI, getPlayer } = modules;

  try {
    DependencyUI.restoreDepsStatus();
    let settings = await Settings.load();
    settings = await SettingsUI.ensureDefaultLocalPath(settings);
    SettingsUI.applySettingsToUI(settings);
  } catch {}

  initTabs({ Toast, DependencyUI, getPlayer });
  Converter.initConvertScreen();
  Player.init();
  SettingsUI.initSettingsTab();
  void Player.loadLibrary({ force: true });

  void Converter.ensureRequiredToolsInstalled().catch(e => {
    Toast.show(`필수 도구 확인 실패: ${e.message || e}`, 'error', 8000);
  });
})();
