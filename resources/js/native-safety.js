// resources/js/native-safety.js
// Intercepts calls to Neutralino native APIs to log payloads that may be
// causing NE_SR_UNBPARS. Safe, minimal wrapper to capture payloads for debugging.
(function(){
  const OUT = (typeof globalThis !== 'undefined' && globalThis.NL_PATH ? globalThis.NL_PATH : '.') + '\\resources\\bin\\native_payloads.log';
  let _buffer = [];
  let _flushing = false;

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      // fallback: attempt to clone removing functions/cycles
      const seen = new WeakSet();
      function clone(v) {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
        if (Array.isArray(v)) return v.map(clone);
        const o = {};
        for (const k in v) {
          try {
            const val = v[k];
            if (typeof val === 'function') continue;
            o[k] = clone(val);
          } catch (e) { o[k] = '[Unserializable]'; }
        }
        return o;
      }
      try { return JSON.stringify(clone(obj)); } catch { return '<<unstringifiable>>'; }
    }
  }

  function enqueue(entry) {
    try {
      _buffer.push({ time: new Date().toISOString(), entry });
      if (!_flushing) flush();
    } catch (e) { console.debug('[native-safety] enqueue fail', e && e.message); }
  }

  async function flush() {
    if (_flushing) return;
    _flushing = true;
    try {
      if (!_buffer.length) return;
      const payload = _buffer.splice(0).map(x => JSON.stringify(x)).join('\n') + '\n---\n';
      if (window.Neutralino && Neutralino.filesystem && typeof Neutralino.filesystem.writeFile === 'function') {
        try {
          await Neutralino.filesystem.writeFile(OUT, payload, { append: true });
        } catch (e) {
          // if filesystem write fails (early init), fallback to console
          console.debug('[native-safety] writeFile failed', e && e.message, payload);
        }
      } else {
        console.debug('[native-safety] no filesystem yet, payload:', payload);
      }
    } finally { _flushing = false; }
  }

  function wrapDispatch() {
    try {
      if (!window.Neutralino || !Neutralino.extensions || typeof Neutralino.extensions.dispatch !== 'function') return;
      const orig = Neutralino.extensions.dispatch.bind(Neutralino.extensions);
      Neutralino.extensions.dispatch = function(extId, event, data) {
        try {
          enqueue({ type: 'extensions.dispatch', extId, event, data: safeStringify(data) });
        } catch (e) {}
        return orig(extId, event, data);
      };
    } catch (e) { console.debug('[native-safety] wrapDispatch failed', e && e.message); }
  }

  function wrapOs() {
    try {
      if (!window.Neutralino || !Neutralino.os || typeof Neutralino.os.execCommand !== 'function') return;
      const orig = Neutralino.os.execCommand.bind(Neutralino.os);
      Neutralino.os.execCommand = function(cmd, opts) {
        try { enqueue({ type: 'os.execCommand', cmd: String(cmd), opts: safeStringify(opts) }); } catch (e) {}
        return orig(cmd, opts);
      };
    } catch (e) { console.debug('[native-safety] wrapOs failed', e && e.message); }
  }

  function wrapCustom() {
    try {
      if (!window.Neutralino || !Neutralino.custom) return;
      for (const k of Object.keys(Neutralino.custom)) {
        if (typeof Neutralino.custom[k] !== 'function') continue;
        const orig = Neutralino.custom[k].bind(Neutralino.custom);
        Neutralino.custom[k] = function(...args) {
          try { enqueue({ type: 'custom.' + k, args: safeStringify(args) }); } catch (e) {}
          return orig(...args);
        };
      }
    } catch (e) { console.debug('[native-safety] wrapCustom failed', e && e.message); }
  }

  // Wait until Neutralino is initialized
  function initWhenReady() {
    try {
      if (window.Neutralino && typeof Neutralino.init === 'function') {
        // wrap immediately
        wrapDispatch(); wrapOs(); wrapCustom();
      } else {
        setTimeout(initWhenReady, 500);
      }
    } catch (e) { setTimeout(initWhenReady, 500); }
  }

  initWhenReady();
})();
