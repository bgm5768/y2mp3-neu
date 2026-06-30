/**
 * resources/js/ytdlp.js
 * yt-dlp + ffmpeg 를 Neutralino.os.execCommand 로 직접 실행합니다.
 *
 * 동작 방식:
 *  1) 임시 .cmd 스크립트를 작성해 yt-dlp를 실행하고 stdout/stderr를 로그 파일로 리다이렉트
 *  2) setInterval 로 로그 파일을 폴링하며 진행률 파싱 → onProgress 콜백
 *  3) execCommand 가 완료되면 → 완료 처리
 *
 * 핵심 주의사항:
 *  - %(title)s 같은 yt-dlp 템플릿 변수는 .cmd 파일 내에서 %% 로 이스케이프해야 함
 *  - Neutralino.os.execCommand 옵션은 { background: boolean } 형태만 허용
 *  - 파일시스템 쓰기를 최소화해야 NE_SR_UNBPARS 방지됨
 */

const YTDlp = (() => {

  // NL_PATH: Neutralino가 주입하는 앱 루트 경로
  function getRoot() {
    return (typeof NL_PATH !== 'undefined' && NL_PATH) ? NL_PATH : '.';
  }

  const _cache = { ytdlp: null, ffmpeg: null, deps: null, depsAt: 0 };
  const autoCookieCache = {};

  // ────────────────────────────────────────────────────────────────
  //  안전한 execCommand 래퍼
  //  opts 는 { background: boolean } 만 허용 — 다른 필드가 있으면 NE_SR_UNBPARS 발생
  // ────────────────────────────────────────────────────────────────
  async function runCmd(cmd, background = false) {
    return Neutralino.os.execCommand(String(cmd), { background });
  }

  let activeDownloadPid = 0;

  async function cancelActiveDownload() {
    try {
      const killByPid = activeDownloadPid
        ? `taskkill /F /T /PID ${activeDownloadPid} >nul 2>&1`
        : '';
      const killTools = 'taskkill /F /IM yt-dlp.exe /T >nul 2>&1 & taskkill /F /IM ffmpeg.exe /T >nul 2>&1 & taskkill /F /IM curl.exe /T >nul 2>&1';
      const command = ['cmd /c "', killByPid, killByPid ? ' & ' : '', killTools, '"'].join('');
      await runCmd(command, true);
    } catch (e) { /* best effort */ }
  }

  async function readExitCode(exitPath) {
    try {
      const value = String(await Neutralino.filesystem.readFile(exitPath) || '').trim();
      const match = value.match(/-?\d+/);
      return match ? Number(match[0]) : null;
    } catch {
      return null;
    }
  }

  async function runCmdInBackground(command, exitPath, signal) {
    const spawned = await runCmd(command, true);
    activeDownloadPid = Number(spawned?.pid) || 0;

    while (true) {
      if (signal && signal.aborted) {
        await cancelActiveDownload();
        throw new Error('CANCELLED');
      }

      const exitCode = await readExitCode(exitPath);
      if (exitCode !== null) {
        return {
          pid: activeDownloadPid,
          stdOut: '',
          stdErr: '',
          exitCode
        };
      }

      await sleep(300);
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  실행 파일 경로 확인
  // ────────────────────────────────────────────────────────────────
  async function ytdlpCandidates() {
    const root = getRoot();
    const runtimeYtdlp = await ytdlpInstallPath().catch(() => '');
    return [
      runtimeYtdlp,
      `${root}\\resources\\bin\\yt-dlp.exe`,
      `${root}\\bin\\yt-dlp.exe`,
      `yt-dlp.exe`
    ].filter(Boolean);
  }

  async function ffmpegCandidates() {
    const root = getRoot();
    const runtimeFfmpeg = await ffmpegInstallPath().catch(() => '');
    return [
      runtimeFfmpeg,
      `${root}\\resources\\bin\\ffmpeg.exe`,
      `${root}\\node_modules\\ffmpeg-static\\ffmpeg.exe`,
      `${root}\\bin\\ffmpeg.exe`,
      `ffmpeg`
    ].filter(Boolean);
  }

  async function fileExists(path) {
    if (!path || /^[a-z0-9_.-]+$/i.test(path)) return false;
    try {
      const stats = await Neutralino.filesystem.getStats(path);
      const type = String(stats?.type || '').toUpperCase();
      return !type || type === 'FILE';
    } catch {
      return false;
    }
  }

  async function existingExecutableCandidates(candidates) {
    const existing = [];
    for (const p of candidates) {
      if (await fileExists(p)) existing.push(p);
    }
    return existing;
  }

  async function probeYtdlp() {
    const candidates = await ytdlpCandidates();
    const existing = await existingExecutableCandidates(candidates);
    for (const p of existing) {
      try {
        const r = await runCmd(`"${p}" --version`);
        const version = ((r.stdOut || '') + (r.stdErr || '')).trim();
        if (r.exitCode === 0 && version) {
          _cache.ytdlp = p;
          return { ok: true, path: p, version };
        }
      } catch (e) { /* 다음 후보 시도 */ }
    }
    return { ok: false, path: candidates[0] || '', version: '' };
  }

  async function probeFfmpeg() {
    const candidates = await ffmpegCandidates();
    const existing = await existingExecutableCandidates(candidates);
    for (const p of existing) {
      try {
        const r = await runCmd(`"${p}" -version`);
        const out = (r.stdOut || '') + (r.stdErr || '');
        const m = out.match(/ffmpeg version ([\S]+)/i);
        if (out.includes('ffmpeg version')) {
          _cache.ffmpeg = p;
          return { ok: true, path: p, version: m ? m[1] : '(설치됨)' };
        }
      } catch (e) { /* 다음 후보 시도 */ }
    }
    return { ok: false, path: candidates[0] || '', version: '' };
  }

  async function ytdlpExe() {
    if (_cache.ytdlp) return _cache.ytdlp;
    let found = await probeYtdlp();
    if (!found.ok) {
      await installYtdlp();
      found = await probeYtdlp();
    }
    if (!found.ok) throw new Error('yt-dlp 실행 파일을 준비하지 못했습니다.');
    return found.path;
  }

  function parseYtdlpVersionDate(version) {
    const match = String(version || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isYtdlpOlderThan(version, maxAgeDays) {
    const date = parseYtdlpVersionDate(version);
    if (!date) return false;
    return Date.now() - date.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
  }

  async function ensureFreshYtdlpForSource(source, onProgress) {
    if (source !== 'douyin') return;

    const deps = await checkDeps();
    if (!deps.ytdlp.ok || !isYtdlpOlderThan(deps.ytdlp.version, 30)) return;

    onProgress && onProgress(2, '', 'Douyin 지원 업데이트 확인 중', 'download');
    await installYtdlp(progress => {
      if (!progress || typeof progress !== 'object') return;
      if (progress.message) {
        onProgress && onProgress(Math.max(2, Math.min(8, Number(progress.pct) || 2)), '', progress.message, 'download');
      }
    });
  }

  async function ffmpegExe() {
    if (_cache.ffmpeg) return _cache.ffmpeg;
    let found = await probeFfmpeg();
    if (!found.ok) {
      await installFfmpeg();
      found = await probeFfmpeg();
    }
    if (!found.ok) throw new Error('ffmpeg 실행 파일을 준비하지 못했습니다.');
    return found.path;
  }

  async function tempWorkDir() {
    try {
      const cache = await Neutralino.os.getPath('cache');
      if (cache) {
        const dir = `${cache}\\yt-mp3-converter`;
        try { await Neutralino.filesystem.createDirectory(dir); } catch {}
        return dir;
      }
    } catch {}

    const fallback = `${getRoot()}\\.tmp`;
    try { await Neutralino.filesystem.createDirectory(fallback); } catch {}
    return fallback;
  }

  async function runtimeBinDir() {
    const pathNames = ['data', 'cache'];
    for (const name of pathNames) {
      try {
        const base = await Neutralino.os.getPath(name);
        if (base) {
          const dir = `${base}\\yt-mp3-converter\\bin`;
          try { await Neutralino.filesystem.createDirectory(dir); } catch {}
          return dir;
        }
      } catch {}
    }

    const fallback = `${getRoot()}\\.tmp\\bin`;
    try { await Neutralino.filesystem.createDirectory(fallback); } catch {}
    return fallback;
  }

  async function ffmpegInstallPath() {
    return `${await runtimeBinDir()}\\ffmpeg.exe`;
  }

  async function ytdlpInstallPath() {
    return `${await runtimeBinDir()}\\yt-dlp.exe`;
  }

  async function cleanupTempScripts(dir) {
    try {
      if (!dir) dir = await tempWorkDir();
      const entries = await Neutralino.filesystem.readDirectory(dir);
      const tempScript = /^(_run_|yt-cmd-|yt-dlp-run-).+\.cmd$/i;
      await Promise.all(entries
        .filter(e => e.type === 'FILE' && tempScript.test(e.entry))
        .map(e => Neutralino.filesystem.removeFile(`${dir}\\${e.entry}`).catch(() => {})));
    } catch {}
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForFileReady(filePath, timeoutMs = 4000) {
    if (!filePath) return filePath;
    const startedAt = Date.now();
    let lastSize = -1;
    let stableHits = 0;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const stats = await Neutralino.filesystem.getStats(filePath);
        const size = Number(stats?.size || stats?.length || 0);
        if (size > 0 && size === lastSize) {
          stableHits += 1;
          if (stableHits >= 2) return filePath;
        } else {
          stableHits = 0;
          lastSize = size;
        }
      } catch {}
      await sleep(250);
    }

    return filePath;
  }

  function quoteArg(value) {
    return `"${String(value || '').replace(/"/g, '\\"')}"`;
  }

  function escapeCmdPercents(value) {
    return String(value || '').replace(/%/g, '%%');
  }

  // ────────────────────────────────────────────────────────────────
  //  의존성 확인
  // ────────────────────────────────────────────────────────────────
  async function checkDeps(opts = {}) {
    const refresh = !!opts.refresh;
    if (refresh) {
      _cache.ffmpeg = null;
      _cache.ytdlp = null;
    }
    if (!refresh && _cache.deps && _cache.depsAt && (Date.now() - _cache.depsAt) < 5 * 60 * 1000) {
      return _cache.deps;
    }
    const result = {
      ffmpeg: { ok: false, version: '' },
      ytdlp:  { ok: false, version: '' }
    };

    const ff = await probeFfmpeg();
    if (ff.ok) result.ffmpeg = { ok: true, path: ff.path || '', version: ff.version || '(설치됨)' };

    const yd = await probeYtdlp();
    if (yd.ok) result.ytdlp = { ok: true, path: yd.path || '', version: yd.version };

    _cache.deps = result;
    _cache.depsAt = Date.now();
    return result;
  }

  // ────────────────────────────────────────────────────────────────
  //  영상 정보 가져오기
  // ────────────────────────────────────────────────────────────────
  async function getVideoInfo(url) {
    const yd  = await ytdlpExe();
    const cmd = `"${yd}" --dump-json --no-playlist "${url}"`;
    const r   = await runCmd(cmd);
    const out = (r.stdOut || '').trim();

    if (!out) {
      const err = (r.stdErr || '').trim();
      throw new Error(err || 'yt-dlp 응답 없음');
    }

    const jsonLine = out.split('\n').find(l => l.trim().startsWith('{'));
    if (!jsonLine) throw new Error('JSON 응답 파싱 실패');

    const info = JSON.parse(jsonLine);
    return {
      title:     info.title           || '제목 없음',
      thumbnail: info.thumbnail       || '',
      duration:  info.duration_string || formatDuration(info.duration),
      uploader:  info.uploader        || info.channel || '',
    };
  }

  // ────────────────────────────────────────────────────────────────
  //  다운로드 + MP3 변환
  //  onProgress(pct, speed, eta, phase) 콜백으로 진행률 전달
  //
  //  핵심 동작:
  //  1) 임시 .cmd 파일 생성 — yt-dlp 명령어 + > 로그 리다이렉트 포함
  //     %(title)s 같은 % 문자를 .cmd 안에서 %%로 이스케이프 (파일명 버그 방지)
  //  2) cmd /c "script.cmd" 실행 (background:false = 완료까지 대기)
  //  3) setInterval로 로그 파일을 읽어 진행률 파싱
  //  4) execCommand 완료 후 최신 오디오 파일 경로 반환
  // ────────────────────────────────────────────────────────────────
  async function download({ url, quality, format, savePath,
                             embedThumb, embedMeta,
                             proxy, rateLimit, onProgress, signal }) {

    const normalizedUrl = String(url || '').trim();
    if (!/^https?:\/\/\S+/i.test(normalizedUrl)) {
      throw new Error('URL을 다시 확인해 주세요.');
    }

    const yd   = await ytdlpExe();
    const ff   = await ffmpegExe();
    const tempDir = await tempWorkDir();
    const log  = `${tempDir}\\_progress.log`;
    const startedAt = Date.now();

    await cleanupTempScripts(tempDir);

    // 이전 로그 삭제
    try { await Neutralino.filesystem.removeFile(log); } catch (e) { /* 없으면 무시 */ }

    // UI에 즉시 작업 중 상태 표시
    onProgress && onProgress(3, '', '준비 중', 'download');

    // ── yt-dlp 인자 구성 ──────────────────────────────────────────
    // 주의: % 문자는 이후 .cmd 파일 작성 시 %% 로 치환됨
    const outTemplate = savePath.replace(/\\/g, '/') + '/%(title)s.%(ext)s';

    const args = [
      `-x`,
      `--audio-format "${format || 'mp3'}"`,
      `--audio-quality ${quality || '192'}`,
      `--ffmpeg-location "${ff}"`,
      `-o "${outTemplate}"`,
      `--no-playlist`,
      `--newline`,
      `--progress`,
      `--encoding utf-8`,
    ];

    if (embedThumb) {
      args.push('--embed-thumbnail');
      args.push('--convert-thumbnails jpg');
    }
    if (embedMeta)  args.push('--add-metadata');
    if (proxy)      args.push(`--proxy "${proxy}"`);
    if (rateLimit)  args.push(`-r ${rateLimit}`);

    // 최종 yt-dlp 명령어 (리다이렉션 없음 — .cmd 파일에서 추가)
    const ytdlpCmd = `"${yd}" ${args.join(' ')} "${normalizedUrl}"`;

    // .cmd 파일 내용 구성
    // % → %% 로 이스케이프: %(title)s → %%(title)s
    // CMD가 .cmd를 실행할 때 %% → % 로 복원되므로 yt-dlp는 %(title)s 를 받게 됨
    const cmdLine = `${ytdlpCmd} > "${log}" 2>&1`;
    const escapedLine = cmdLine.replace(/%/g, '%%');
    const exitPath = `${tempDir}\\_exit_${Date.now()}.txt`;
    const scriptContent = [
      '@echo off',
      'chcp 65001 >nul',
      'set PYTHONUTF8=1',
      'set PYTHONIOENCODING=utf-8',
      escapedLine,
      'set "_YTMP3_EXIT=%ERRORLEVEL%"',
      `> "${exitPath}" echo %_YTMP3_EXIT%`,
      'exit /b %_YTMP3_EXIT%'
    ].join('\r\n') + '\r\n';

    const scriptPath = `${tempDir}\\_run_${Date.now()}.cmd`;

    // ── 폴링 설정 ─────────────────────────────────────────────────
    let pollTimer = null;
    let activityTimer = null;
    let lastPct   = -1;
    let warmupPct = 3;
    let currentPhase = 'download';

    function reportProgress(pct, speed, eta, phase) {
      currentPhase = phase || currentPhase;
      const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
      if (safePct !== lastPct || currentPhase === 'convert' || speed || eta) {
        lastPct = safePct;
        onProgress && onProgress(safePct, speed || '', eta || '', currentPhase);
      }
    }

    function startActivityPulse() {
      activityTimer = setInterval(() => {
        if (signal && signal.aborted) return;
        if (currentPhase === 'convert') {
          const next = Math.min(98, Math.max(lastPct, 92) + 0.4);
          reportProgress(next, '', '변환 중', 'convert');
          return;
        }
        if (lastPct < 15) {
          warmupPct = Math.min(15, warmupPct + 1.5);
          reportProgress(warmupPct, '', '연결 중', 'download');
        }
      }, 1200);
    }

    function startPolling() {
      pollTimer = setInterval(async () => {
        try {
          const content = await Neutralino.filesystem.readFile(log);
          if (!content) return;
          parseProgress(content, reportProgress);
        } catch (e) { /* 로그 파일이 아직 없으면 무시 */ }
      }, 800);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
    }

    try {
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      startPolling();
      startActivityPulse();

      if (signal && signal.aborted) throw new Error('CANCELLED');

      const commandPromise = runCmdInBackground(`cmd /c "${scriptPath}"`, exitPath, signal);
      commandPromise.catch(() => {});

      let r = null;
      if (signal) {
        let abortHandler = null;
        const abortPromise = new Promise((_, reject) => {
          abortHandler = () => {
            void cancelActiveDownload();
            reject(new Error('CANCELLED'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        });

        try {
          r = await Promise.race([commandPromise, abortPromise]);
        } finally {
          if (abortHandler) signal.removeEventListener('abort', abortHandler);
        }
      } else {
        r = await commandPromise;
      }

      stopPolling();

      // 취소 확인
      if (signal && signal.aborted) throw new Error('CANCELLED');

      // 스크립트 정리
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch (e) { /* ignored */ }
      try { await Neutralino.filesystem.removeFile(exitPath); } catch (e) { /* ignored */ }

      // 최종 로그 읽기 및 오류 확인
      let finalLog = '';
      try { finalLog = await Neutralino.filesystem.readFile(log); } catch (e) { /* ignored */ }
      parseProgress(finalLog, reportProgress);

      if (r.exitCode !== 0) {
        const errLine = finalLog.split('\n').reverse().find(l =>
          l.trim() && /error/i.test(l) && !l.includes('[debug]')
        );
        throw new Error(errLine || `yt-dlp 오류 (종료 코드: ${r.exitCode})`);
      }

      // 완료
      reportProgress(100, '', '', 'convert');
      const filePath = parseFinalFilePath(finalLog, savePath) ||
        await findLatestFile(savePath, startedAt - 5000) ||
        savePath;
      return filePath === savePath ? filePath : await waitForFileReady(filePath);

    } catch (e) {
      stopPolling();
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch (_) { /* ignored */ }
      try { await Neutralino.filesystem.removeFile(exitPath); } catch (_) { /* ignored */ }
      throw e;
    } finally {
      activeDownloadPid = 0;
    }
  }

  function videoFormatSelector(quality, outputFormat) {
    const maxHeight = ['1080', '720', '480'].includes(String(quality)) ? String(quality) : '';
    const heightFilter = maxHeight ? `[height<=${maxHeight}]` : '';
    const fallback = maxHeight ? `/best[height<=${maxHeight}]/best` : '/best';

    if (outputFormat === 'mp4') {
      return `bv*${heightFilter}[ext=mp4]+ba[ext=m4a]/b${heightFilter}[ext=mp4]${fallback}`;
    }

    if (outputFormat === 'webm') {
      return `bv*${heightFilter}[ext=webm]+ba[ext=webm]/b${heightFilter}[ext=webm]${fallback}`;
    }

    return `bv*${heightFilter}+ba/b${heightFilter}${fallback}`;
  }

  function isProtectedChromiumCookieBrowser(cookieBrowser) {
    const browser = String(cookieBrowser || '').toLowerCase();
    return browser === 'chrome' || browser === 'edge';
  }

  const douyinCookieDomains = ['douyin.com', 'iesdouyin.com', 'amemv.com'];
  const douyinUsefulCookieNames = new Set([
    'ttwid',
    'mstoken',
    's_v_web_id',
    'passport_csrf_token',
    'odin_tt',
    'sid_guard',
    'sessionid',
    'sid_tt',
    'uid_tt'
  ]);

  function normalizeCookieDomain(domain) {
    return String(domain || '')
      .replace(/^#HttpOnly_/i, '')
      .replace(/^\./, '')
      .toLowerCase();
  }

  function parseCookieFileText(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && (!line.startsWith('#') || /^#HttpOnly_/i.test(line)))
      .map(line => {
        const fields = line.split('\t');
        if (fields.length < 7) return null;
        return {
          domain: normalizeCookieDomain(fields[0]),
          expiry: Number(fields[4]) || 0,
          name: String(fields[5] || '').toLowerCase()
        };
      })
      .filter(Boolean);
  }

  function inspectCookieTextForSource(source, text) {
    if (source !== 'douyin') return { ok: true, warning: '' };

    const content = String(text || '').trim();
    if (!content) {
      return { ok: false, message: 'cookies.txt 파일이 비어 있습니다.' };
    }
    if (/^[\[{]/.test(content)) {
      return { ok: false, message: 'cookies.txt가 Netscape 형식이 아닙니다. 브라우저 확장에서 "Netscape cookies.txt" 형식으로 다시 내보내세요.' };
    }

    const cookies = parseCookieFileText(content);
    if (!cookies.length) {
      return { ok: false, message: 'cookies.txt 형식을 읽을 수 없습니다. 탭으로 구분된 Netscape cookies.txt 파일을 선택해야 합니다.' };
    }

    const douyinCookies = cookies.filter(cookie =>
      douyinCookieDomains.some(domain =>
        cookie.domain === domain || cookie.domain.endsWith(`.${domain}`)
      )
    );
    if (!douyinCookies.length) {
      return { ok: false, message: 'cookies.txt 안에 Douyin 쿠키가 없습니다. Douyin 페이지에서 현재 사이트 쿠키를 다시 내보낸 파일을 선택하세요.' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const activeCookies = douyinCookies.filter(cookie =>
      cookie.expiry === 0 || cookie.expiry > nowSeconds
    );
    if (!activeCookies.length) {
      return { ok: false, message: 'cookies.txt 안의 Douyin 쿠키가 모두 만료되었습니다. Douyin을 브라우저에서 다시 연 뒤 cookies.txt를 새로 내보내세요.' };
    }

    const hasUsefulCookie = activeCookies.some(cookie =>
      douyinUsefulCookieNames.has(cookie.name)
    );

    return {
      ok: true,
      warning: hasUsefulCookie
        ? ''
        : 'Douyin 도메인 쿠키는 있지만 세션 쿠키가 부족할 수 있습니다. 실패하면 Douyin을 새로 연 뒤 현재 사이트 쿠키를 다시 내보내세요.'
    };
  }

  async function inspectCookieFileForSource(source, cookieFile) {
    if (!cookieFile || source !== 'douyin') return { ok: true, warning: '' };

    try {
      const content = await Neutralino.filesystem.readFile(cookieFile);
      return inspectCookieTextForSource(source, content);
    } catch {
      return { ok: false, message: 'cookies.txt 파일을 읽을 수 없습니다. 파일 경로와 권한을 확인하세요.' };
    }
  }

  async function validateCookieFileForSource(source, cookieFile) {
    const result = await inspectCookieFileForSource(source, cookieFile);
    if (!result.ok) throw new Error(result.message || 'cookies.txt 파일을 확인할 수 없습니다.');
    return result;
  }

  function defaultCookieUrlForSource(source) {
    if (source === 'douyin') return 'https://www.douyin.com/';
    return 'https://example.com/';
  }

  async function generatedCookieFilePath(source, browser) {
    const safeSource = String(source || 'site').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const safeBrowser = String(browser || 'browser').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    return `${await tempWorkDir()}\\${safeSource}_${safeBrowser}_cookies.txt`;
  }

  async function runYtdlpCookieExport({ source, browser, cookieFile, url }) {
    const yd = await ytdlpExe();
    const tempDir = await tempWorkDir();
    const log = `${tempDir}\\_cookie_export_${Date.now()}.log`;
    const scriptPath = `${tempDir}\\_run_cookie_export_${Date.now()}.cmd`;
    const targetUrl = url || defaultCookieUrlForSource(source);
    const ytdlpCmd = [
      quoteArg(yd),
      '--cookies',
      quoteArg(cookieFile),
      '--cookies-from-browser',
      quoteArg(browser),
      '--skip-download',
      '--simulate',
      '--no-playlist',
      '--encoding utf-8',
      quoteArg(targetUrl)
    ].join(' ');

    const scriptContent = [
      '@echo off',
      'chcp 65001 >nul',
      'set PYTHONUTF8=1',
      'set PYTHONIOENCODING=utf-8',
      `${escapeCmdPercents(ytdlpCmd)} > ${quoteArg(log)} 2>&1`,
      'exit /b %ERRORLEVEL%'
    ].join('\r\n') + '\r\n';

    try {
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      const result = await runCmd(`cmd /c "${scriptPath}"`, false);
      let logText = '';
      try { logText = await Neutralino.filesystem.readFile(log); } catch {}
      return { ...result, logText };
    } finally {
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
    }
  }

  function browserCookieExportErrorMessage(source, browser, text) {
    const browserName = cookieBrowserLabel(browser);
    const details = String(text || '');
    if (isDpapiCookieError(details)) return chromiumDpapiCookieErrorMessage(browser);
    if (isBrowserCookieCopyError(details)) return browserCookieCopyErrorMessage(browser);
    if (/could not find|not found|no such file|profile/i.test(details)) {
      return `${browserName} 쿠키를 찾을 수 없습니다. ${browserName}가 설치되어 있고 Douyin을 한 번 연 뒤 다시 시도하세요.`;
    }
    if (source === 'douyin') {
      return `${browserName}에서 Douyin 쿠키를 자동으로 가져오지 못했습니다. ${browserName}에서 Douyin 페이지를 한 번 연 뒤 다시 시도하세요.`;
    }
    return `${browserName} 쿠키를 자동으로 가져오지 못했습니다.`;
  }

  function isAutoCookieFilePath(cookieFile) {
    return /[\\/]douyin_firefox_cookies\.txt$/i.test(String(cookieFile || ''));
  }

  async function refreshCookieFileFromBrowser({ source = 'douyin', browser = 'firefox', url = '', force = false } = {}) {
    const normalizedSource = String(source || '').toLowerCase();
    const normalizedBrowser = String(browser || 'firefox').toLowerCase();
    if (normalizedSource !== 'douyin') {
      throw new Error('자동 쿠키 가져오기는 현재 Douyin에만 사용합니다.');
    }
    if (isProtectedChromiumCookieBrowser(normalizedBrowser)) {
      throw new Error(chromiumDpapiCookieErrorMessage(normalizedBrowser));
    }
    if (!normalizedBrowser) {
      throw new Error('자동 쿠키를 가져올 브라우저를 선택하세요.');
    }

    const cacheKey = `${normalizedSource}:${normalizedBrowser}`;
    const cached = autoCookieCache[cacheKey];
    if (!force && cached) {
      const check = await inspectCookieFileForSource(normalizedSource, cached);
      if (check.ok) return { cookieFile: cached, browser: normalizedBrowser, warning: check.warning || '', reused: true };
    }

    const cookieFile = await generatedCookieFilePath(normalizedSource, normalizedBrowser);
    try { await Neutralino.filesystem.removeFile(cookieFile); } catch {}

    let r = null;
    let logText = '';
    try {
      r = await runYtdlpCookieExport({
        source: normalizedSource,
        browser: normalizedBrowser,
        cookieFile,
        url: url || defaultCookieUrlForSource(normalizedSource)
      });
    } catch (e) {
      logText = e.message || String(e || '');
    }

    const check = await inspectCookieFileForSource(normalizedSource, cookieFile);
    if (!check.ok) {
      const detailText = logText || r?.logText || r?.stdErr || r?.stdOut || '';
      const exportMessage = detailText
        ? browserCookieExportErrorMessage(normalizedSource, normalizedBrowser, detailText)
        : '';
      const shouldPreferExportMessage = check.message && /읽을 수 없습니다|read/i.test(check.message);
      throw new Error((shouldPreferExportMessage && exportMessage) || check.message || exportMessage || 'cookies.txt 파일을 자동으로 만들지 못했습니다.');
    }

    autoCookieCache[cacheKey] = cookieFile;
    return { cookieFile, browser: normalizedBrowser, warning: check.warning || '', reused: false };
  }

  async function resolveCookieFileForSource({ source, cookieBrowser, cookieFile, url, onProgress }) {
    if (source !== 'douyin') return cookieFile || '';

    const browser = isProtectedChromiumCookieBrowser(cookieBrowser) ? 'firefox' : (cookieBrowser || 'firefox');
    const shouldPreferFirefox = browser === 'firefox' && (!cookieFile || isAutoCookieFilePath(cookieFile));

    if (shouldPreferFirefox) {
      try {
        onProgress && onProgress(4, '', 'Firefox 쿠키 최신화 중', 'download');
        const result = await refreshCookieFileFromBrowser({ source, browser, url, force: true });
        if (result.warning) {
          onProgress && onProgress(5, '', result.warning, 'download');
        }
        return result.cookieFile;
      } catch (e) {
        if (!cookieFile) throw e;
        onProgress && onProgress(4, '', 'Firefox 자동 쿠키 갱신 실패, 저장된 cookies.txt 확인 중', 'download');
      }
    }

    if (cookieFile) {
      const check = await inspectCookieFileForSource(source, cookieFile);
      if (check.ok) return cookieFile;
      onProgress && onProgress(4, '', `${check.message || 'cookies.txt를 사용할 수 없습니다.'} Firefox 쿠키로 자동 전환합니다.`, 'download');
    }

    onProgress && onProgress(4, '', `${cookieBrowserLabel(browser)} 쿠키 가져오는 중`, 'download');
    const result = await refreshCookieFileFromBrowser({ source, browser, url, force: true });
    if (result.warning) {
      onProgress && onProgress(5, '', result.warning, 'download');
    }
    return result.cookieFile;
  }

  function douyinReferer({ source, rawUrl }) {
    if (source !== 'douyin') return '';
    const raw = String(rawUrl || '').trim();
    if (/^https?:\/\/\S+/i.test(raw)) return raw;
    return 'https://www.douyin.com/';
  }

  function douyinRequestArgs({ source, rawUrl }) {
    if (source !== 'douyin') return [];
    const referer = douyinReferer({ source, rawUrl });
    return [
      `--referer "${referer}"`,
      '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"',
      '--add-header "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8,ko;q=0.7"'
    ];
  }

  function videoCookieArgs({ source, cookieBrowser, cookieFile }) {
    if (source !== 'douyin') return [];

    const args = [];
    if (cookieFile) {
      args.push(`--cookies "${cookieFile}"`);
    } else if (isProtectedChromiumCookieBrowser(cookieBrowser)) {
      throw new Error(chromiumDpapiCookieErrorMessage(cookieBrowser));
    } else if (cookieBrowser) {
      args.push(`--cookies-from-browser "${cookieBrowser}"`);
    }
    return args;
  }

  function isDouyinCookieError(source, text) {
    return source === 'douyin' && /fresh cookies|cookies?.*needed|login/i.test(String(text || ''));
  }

  function isDouyinEmptyWebDetailError(source, text) {
    const details = String(text || '');
    return source === 'douyin' &&
      /web detail JSON/i.test(details) &&
      /Failed to parse JSON|Expecting value/i.test(details) &&
      /Fresh cookies/i.test(details);
  }

  function isBrowserCookieCopyError(text) {
    return /could not copy .*cookie database|permission denied.*(?:cookie|cookies)|cookie database.*(?:locked|copy)/i.test(String(text || ''));
  }

  function isDpapiCookieError(text) {
    return /failed to decrypt with dpapi|app-?bound|nonetype.*decode|github\.com\/yt-dlp\/yt-dlp\/issues\/10927/i.test(String(text || ''));
  }

  function cookieBrowserLabel(cookieBrowser) {
    const browser = String(cookieBrowser || '').toLowerCase();
    if (browser === 'chrome') return 'Chrome';
    if (browser === 'edge') return 'Edge';
    if (browser === 'firefox') return 'Firefox';
    return '선택한 브라우저';
  }

  function browserCookieCopyErrorMessage(cookieBrowser) {
    const browser = cookieBrowserLabel(cookieBrowser);
    return `${browser} 쿠키 데이터베이스가 잠겨 있습니다. 설정 > 사이트 쿠키에서 브라우저 프로세스 정리를 누른 뒤 다시 시도하거나, cookies.txt를 지정해 주세요.`;
  }

  function chromiumDpapiCookieErrorMessage(cookieBrowser) {
    const browser = cookieBrowserLabel(cookieBrowser);
    return `${browser} 쿠키는 Windows DPAPI/App-Bound 보호 때문에 yt-dlp가 복호화할 수 없습니다. 설정 > 사이트 쿠키에서 Firefox를 선택하고 Firefox에서 Douyin에 한 번 접속한 뒤 다시 시도하거나, cookies.txt를 지정해 주세요.`;
  }

  function douyinCookieErrorMessage() {
    return 'Douyin이 받은 쿠키를 최신 세션으로 인정하지 않았습니다. cookies.txt를 쓰는 중이면 Douyin 페이지를 새로 열고 현재 사이트 쿠키를 다시 내보낸 파일로 교체하세요. 브라우저 쿠키를 쓰는 중이면 Firefox에서 Douyin을 한 번 연 뒤 다시 시도하세요.';
  }

  async function douyinDownloadErrorMessage({ source, errorText, cookieFile }) {
    if (!isDouyinEmptyWebDetailError(source, errorText)) {
      return douyinCookieErrorMessage();
    }

    const cookieCheck = cookieFile
      ? await inspectCookieFileForSource('douyin', cookieFile)
      : { ok: false };

    if (!cookieCheck.ok) {
      return douyinCookieErrorMessage();
    }

    return 'Firefox 쿠키는 정상적으로 가져왔지만 Douyin 웹 상세 API가 빈 응답을 반환했습니다. 현재 yt-dlp의 Douyin 추출기가 필요한 서명/검증 쿠키를 자동 생성하지 못해 이 URL은 바로 다운로드할 수 없습니다. 앱과 yt-dlp를 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.';
  }

  const douyinWebUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

  function douyinAwemeIdFromUrl(url) {
    const text = String(url || '');
    const queryId = text.match(/[?&](?:modal_id|aweme_id|item_id)=(\d{10,})/i)?.[1];
    if (queryId) return queryId;
    return text.match(/\/video\/(\d{10,})/i)?.[1] || '';
  }

  function readCookieValue(cookieValues, name) {
    return cookieValues[String(name || '').toLowerCase()] || '';
  }

  async function readCookieValuesForSource(source, cookieFile) {
    const values = {};
    if (!cookieFile || source !== 'douyin') return values;

    const content = await Neutralino.filesystem.readFile(cookieFile);
    const nowSeconds = Math.floor(Date.now() / 1000);
    String(content || '').split(/\r?\n/).forEach(line => {
      if (!line || (!/^#HttpOnly_/i.test(line) && line.startsWith('#'))) return;
      const fields = line.trim().split('\t');
      if (fields.length < 7) return;
      const domain = normalizeCookieDomain(fields[0]);
      const isDouyin = douyinCookieDomains.some(item =>
        domain === item || domain.endsWith(`.${item}`)
      );
      if (!isDouyin) return;
      const expiry = Number(fields[4]) || 0;
      if (expiry && expiry <= nowSeconds) return;
      values[String(fields[5] || '').toLowerCase()] = String(fields[6] || '');
    });
    return values;
  }

  function randomDouyinToken(length = 120) {
    const chars = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
    let value = '';
    for (let i = 0; i < length; i += 1) {
      value += chars[Math.floor(Math.random() * chars.length)];
    }
    return value;
  }

  function encodeDouyinQuery(params) {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }

  function buildDouyinDetailUrl(awemeId, cookieValues) {
    const svWebId = readCookieValue(cookieValues, 's_v_web_id');
    const params = {
      aweme_id: awemeId,
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      update_version_code: '170400',
      pc_client_type: '1',
      version_code: '190500',
      version_name: '19.5.0',
      cookie_enabled: 'true',
      screen_width: readCookieValue(cookieValues, 'dy_swidth') || '1920',
      screen_height: readCookieValue(cookieValues, 'dy_sheight') || '1080',
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Firefox',
      browser_version: '140.0',
      browser_online: 'true',
      engine_name: 'Gecko',
      engine_version: '140.0',
      os_name: 'Windows',
      os_version: '10',
      cpu_core_num: readCookieValue(cookieValues, 'device_web_cpu_core') || '8',
      device_memory: readCookieValue(cookieValues, 'device_web_memory_size') || '8',
      platform: 'PC',
      downlink: '10',
      effective_type: '4g',
      round_trip_time: '50',
      verifyFp: svWebId,
      fp: svWebId,
      msToken: readCookieValue(cookieValues, 'mstoken') || randomDouyinToken()
    };
    return `https://www.douyin.com/aweme/v1/web/aweme/detail/?${encodeDouyinQuery(params)}&a_bogus=`;
  }

  async function runCurlToFile({ url, outputFile, cookieFile = '', referer = '', headers = [], timeoutSeconds = 60, signal }) {
    const tempDir = await tempWorkDir();
    const stamp = Date.now();
    const log = `${tempDir}\\_curl_${stamp}.log`;
    const exitPath = `${tempDir}\\_curl_exit_${stamp}.txt`;
    const scriptPath = `${tempDir}\\_run_curl_${stamp}.cmd`;
    const headerArgs = headers.map(header => `-H ${quoteArg(header)}`);
    const args = [
      'curl.exe',
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '--connect-timeout 20',
      `--max-time ${Math.max(10, Number(timeoutSeconds) || 60)}`,
      cookieFile ? `-b ${quoteArg(cookieFile)}` : '',
      `-A ${quoteArg(douyinWebUserAgent)}`,
      referer ? `-e ${quoteArg(referer)}` : '',
      ...headerArgs,
      '-o',
      quoteArg(outputFile),
      quoteArg(url)
    ].filter(Boolean).join(' ');
    const scriptContent = [
      '@echo off',
      'chcp 65001 >nul',
      `${escapeCmdPercents(args)} > ${quoteArg(log)} 2>&1`,
      'set "_YTMP3_EXIT=%ERRORLEVEL%"',
      `> ${quoteArg(exitPath)} echo %_YTMP3_EXIT%`,
      'exit /b %_YTMP3_EXIT%'
    ].join('\r\n') + '\r\n';

    try {
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      const result = await runCmdInBackground(`cmd /c "${scriptPath}"`, exitPath, signal);
      const logText = await Neutralino.filesystem.readFile(log).catch(() => '');
      if (result.exitCode !== 0) {
        throw new Error(logText.trim() || `curl 오류 (종료 코드: ${result.exitCode})`);
      }
      return outputFile;
    } finally {
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
      try { await Neutralino.filesystem.removeFile(exitPath); } catch {}
    }
  }

  async function fetchDouyinAwemeDetail({ awemeId, cookieFile, rawUrl, signal }) {
    const cookieValues = await readCookieValuesForSource('douyin', cookieFile);
    const detailUrl = buildDouyinDetailUrl(awemeId, cookieValues);
    const tempDir = await tempWorkDir();
    const detailFile = `${tempDir}\\douyin_detail_${awemeId}_${Date.now()}.json`;
    try {
      await runCurlToFile({
        url: detailUrl,
        outputFile: detailFile,
        cookieFile,
        referer: rawUrl || `https://www.douyin.com/video/${awemeId}`,
        headers: [
          'Accept: application/json, text/plain, */*',
          'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
          'sec-fetch-site: same-origin',
          'sec-fetch-mode: cors',
          'sec-fetch-dest: empty'
        ],
        timeoutSeconds: 45,
        signal
      });
      const text = await Neutralino.filesystem.readFile(detailFile);
      if (!String(text || '').trim()) {
        throw new Error('Douyin 상세 API가 빈 응답을 반환했습니다.');
      }
      const data = JSON.parse(text);
      const detail = data?.aweme_detail;
      if (!detail?.video) {
        throw new Error('Douyin 영상 정보를 찾지 못했습니다.');
      }
      return detail;
    } finally {
      try { await Neutralino.filesystem.removeFile(detailFile); } catch {}
    }
  }

  function firstUrlFromAddr(addr) {
    const list = addr?.url_list || addr?.urlList || [];
    if (Array.isArray(list)) return list.find(item => /^https?:\/\//i.test(String(item || ''))) || '';
    return '';
  }

  function pushDouyinFormat(formats, addr, meta = {}) {
    const url = firstUrlFromAddr(addr);
    if (!url) return;
    formats.push({
      url,
      width: Number(addr?.width || meta.width || 0),
      height: Number(addr?.height || meta.height || 0),
      bitrate: Number(addr?.bit_rate || addr?.bitrate || meta.bitrate || 0),
      size: Number(addr?.data_size || addr?.size || meta.size || 0),
      id: meta.id || addr?.uri || addr?.url_key || 'video'
    });
  }

  function collectDouyinFormats(detail) {
    const video = detail?.video || {};
    const formats = [];
    (video.bit_rate || []).forEach((item, index) => {
      pushDouyinFormat(formats, item?.play_addr, {
        id: item?.gear_name || item?.quality_type || `bitrate-${index + 1}`,
        bitrate: item?.bit_rate,
        size: item?.play_addr?.data_size
      });
    });
    pushDouyinFormat(formats, video.play_addr_h264, { id: 'play_addr_h264' });
    pushDouyinFormat(formats, video.play_addr_265, { id: 'play_addr_265' });
    pushDouyinFormat(formats, video.play_addr, {
      id: 'play_addr',
      width: video.width,
      height: video.height
    });
    pushDouyinFormat(formats, video.download_addr, {
      id: 'download_addr',
      width: video.width,
      height: video.height
    });

    const seen = new Set();
    return formats.filter(format => {
      if (!format.url || seen.has(format.url)) return false;
      seen.add(format.url);
      return true;
    });
  }

  function selectDouyinFormat(formats, quality) {
    const maxHeight = ['1080', '720', '480'].includes(String(quality)) ? Number(quality) : 0;
    const candidates = maxHeight
      ? formats.filter(format => !format.height || format.height <= maxHeight)
      : formats;
    return (candidates.length ? candidates : formats)
      .slice()
      .sort((a, b) =>
        (Number(b.height) || 0) - (Number(a.height) || 0) ||
        (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0) ||
        (Number(b.size) || 0) - (Number(a.size) || 0)
      )[0] || null;
  }

  function sanitizeFileName(value, fallback = 'douyin-video') {
    const cleaned = String(value || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 140);
    const name = cleaned || fallback;
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `${name}_` : name;
  }

  async function filePathExists(filePath) {
    try {
      await Neutralino.filesystem.getStats(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function uniqueOutputFile(dir, title, ext) {
    const baseDir = String(dir || '').replace(/[\\/]+$/, '');
    const safeTitle = sanitizeFileName(title);
    const safeExt = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
    let candidate = `${baseDir}\\${safeTitle}.${safeExt}`;
    for (let index = 1; await filePathExists(candidate); index += 1) {
      candidate = `${baseDir}\\${safeTitle} (${index}).${safeExt}`;
    }
    return candidate;
  }

  async function pollDownloadProgress(filePath, totalBytes, onProgress, shouldStop) {
    let lastSize = -1;
    while (!shouldStop()) {
      try {
        const stats = await Neutralino.filesystem.getStats(filePath);
        const size = Number(stats?.size || stats?.length || 0);
        if (size !== lastSize) {
          lastSize = size;
          const pct = totalBytes > 0
            ? 12 + (Math.min(size, totalBytes) / totalBytes) * 78
            : Math.min(90, 12 + Math.log10(Math.max(1, size)) * 10);
          onProgress && onProgress(pct, '', totalBytes > 0
            ? `${mb(size)} MB / ${mb(totalBytes)} MB`
            : `${mb(size)} MB`, 'download');
        }
      } catch {}
      await sleep(500);
    }
  }

  async function downloadDouyinMediaUrl({ url, dest, cookieFile, rawUrl, totalBytes, signal, onProgress }) {
    let done = false;
    const poller = pollDownloadProgress(dest, totalBytes, onProgress, () => done).catch(() => {});
    try {
      await runCurlToFile({
        url,
        outputFile: dest,
        cookieFile,
        referer: rawUrl || 'https://www.douyin.com/',
        headers: [
          'Accept: */*',
          'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8'
        ],
        timeoutSeconds: 60 * 60,
        signal
      });
    } finally {
      done = true;
      await poller;
    }
    return waitForFileReady(dest);
  }

  async function remuxDouyinVideo({ inputFile, outputFile, outputFormat, signal, onProgress }) {
    const ff = await ffmpegExe();
    const tempDir = await tempWorkDir();
    const stamp = Date.now();
    const log = `${tempDir}\\_douyin_ffmpeg_${stamp}.log`;
    const exitPath = `${tempDir}\\_douyin_ffmpeg_exit_${stamp}.txt`;
    const scriptPath = `${tempDir}\\_run_douyin_ffmpeg_${stamp}.cmd`;
    const codecArgs = outputFormat === 'webm'
      ? '-c:v libvpx-vp9 -b:v 0 -crf 32 -c:a libopus'
      : '-c copy';
    const command = `${quoteArg(ff)} -y -i ${quoteArg(inputFile)} ${codecArgs} ${quoteArg(outputFile)}`;
    const scriptContent = [
      '@echo off',
      'chcp 65001 >nul',
      `${escapeCmdPercents(command)} > ${quoteArg(log)} 2>&1`,
      'set "_YTMP3_EXIT=%ERRORLEVEL%"',
      `> ${quoteArg(exitPath)} echo %_YTMP3_EXIT%`,
      'exit /b %_YTMP3_EXIT%'
    ].join('\r\n') + '\r\n';

    try {
      onProgress && onProgress(94, '', '파일 정리 중', 'convert');
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      const result = await runCmdInBackground(`cmd /c "${scriptPath}"`, exitPath, signal);
      const logText = await Neutralino.filesystem.readFile(log).catch(() => '');
      if (result.exitCode !== 0) {
        throw new Error(logText.split('\n').reverse().find(line => line.trim()) || `ffmpeg 오류 (종료 코드: ${result.exitCode})`);
      }
      return waitForFileReady(outputFile);
    } finally {
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
      try { await Neutralino.filesystem.removeFile(exitPath); } catch {}
    }
  }

  async function downloadDouyinVideoDirect({ url, videoQuality, format, savePath,
                                            cookieBrowser, cookieFile, rawUrl,
                                            onProgress, signal }) {
    const normalizedUrl = String(url || '').trim();
    const awemeId = douyinAwemeIdFromUrl(rawUrl) || douyinAwemeIdFromUrl(normalizedUrl);
    if (!awemeId) throw new Error('Douyin 영상 ID를 찾지 못했습니다.');

    const resolvedCookieFile = await resolveCookieFileForSource({
      source: 'douyin',
      cookieBrowser,
      cookieFile,
      url: rawUrl || normalizedUrl,
      onProgress
    });

    onProgress && onProgress(7, '', 'Douyin 영상 정보 가져오는 중', 'download');
    const detail = await fetchDouyinAwemeDetail({
      awemeId,
      cookieFile: resolvedCookieFile,
      rawUrl: rawUrl || normalizedUrl,
      signal
    });
    const formatInfo = selectDouyinFormat(collectDouyinFormats(detail), videoQuality);
    if (!formatInfo) throw new Error('Douyin 다운로드 URL을 찾지 못했습니다.');

    const outputFormat = ['mp4', 'mkv', 'webm'].includes(String(format || '').toLowerCase())
      ? String(format).toLowerCase()
      : 'mp4';
    const title = detail.desc || detail.caption || awemeId;
    const finalFile = await uniqueOutputFile(savePath, title, outputFormat);
    const downloadFile = outputFormat === 'mp4'
      ? finalFile
      : await uniqueOutputFile(savePath, `${title} 원본`, 'mp4');

    onProgress && onProgress(10, '', 'Douyin CDN 다운로드 중', 'download');
    await downloadDouyinMediaUrl({
      url: formatInfo.url,
      dest: downloadFile,
      cookieFile: resolvedCookieFile,
      rawUrl: rawUrl || normalizedUrl,
      totalBytes: formatInfo.size,
      signal,
      onProgress
    });

    if (outputFormat !== 'mp4') {
      try {
        await remuxDouyinVideo({
          inputFile: downloadFile,
          outputFile: finalFile,
          outputFormat,
          signal,
          onProgress
        });
        try { await Neutralino.filesystem.removeFile(downloadFile); } catch {}
      } catch (e) {
        return downloadFile;
      }
    }

    onProgress && onProgress(100, '', '', 'convert');
    return finalFile;
  }

  async function downloadVideo({ url, videoQuality, format, savePath,
                                source, cookieBrowser, cookieFile,
                                rawUrl, proxy, rateLimit, onProgress, signal }) {

    const normalizedUrl = String(url || '').trim();
    if (!/^https?:\/\/\S+/i.test(normalizedUrl)) {
      throw new Error('URL을 다시 확인해 주세요.');
    }

    const outputFormat = ['mp4', 'mkv', 'webm'].includes(String(format || '').toLowerCase())
      ? String(format).toLowerCase()
      : 'mp4';
    if (source === 'douyin') {
      return downloadDouyinVideoDirect({
        url: normalizedUrl,
        videoQuality,
        format: outputFormat,
        savePath,
        cookieBrowser,
        cookieFile,
        rawUrl,
        onProgress,
        signal
      });
    }

    await ensureFreshYtdlpForSource(source, onProgress);
    const yd = await ytdlpExe();
    const ff = await ffmpegExe();
    const tempDir = await tempWorkDir();
    const log = `${tempDir}\\_video_progress.log`;
    const startedAt = Date.now();
    const videoExts = /\.(mp4|mkv|webm|mov|avi|m4v)$/i;

    await cleanupTempScripts(tempDir);

    try { await Neutralino.filesystem.removeFile(log); } catch (e) { /* 없으면 무시 */ }

    onProgress && onProgress(3, '', '준비 중', 'download');

    const resolvedCookieFile = await resolveCookieFileForSource({
      source,
      cookieBrowser,
      cookieFile,
      url: rawUrl || normalizedUrl,
      onProgress
    });

    const outTemplate = savePath.replace(/\\/g, '/') + '/%(title)s.%(ext)s';
    const args = [
      `-f "${videoFormatSelector(videoQuality, outputFormat)}"`,
      `--ffmpeg-location "${ff}"`,
      `--merge-output-format "${outputFormat}"`,
      `-o "${outTemplate}"`,
      `--no-playlist`,
      `--newline`,
      `--progress`,
      `--encoding utf-8`,
      `--add-metadata`
    ];

    args.push(...videoCookieArgs({ source, cookieBrowser, cookieFile: resolvedCookieFile }));
    args.push(...douyinRequestArgs({ source, rawUrl }));

    if (proxy) args.push(`--proxy "${proxy}"`);
    if (rateLimit) args.push(`-r ${rateLimit}`);

    const ytdlpCmd = `"${yd}" ${args.join(' ')} "${normalizedUrl}"`;
    const cmdLine = `${ytdlpCmd} > "${log}" 2>&1`;
    const escapedLine = cmdLine.replace(/%/g, '%%');
    const exitPath = `${tempDir}\\_video_exit_${Date.now()}.txt`;
    const scriptContent = [
      '@echo off',
      'chcp 65001 >nul',
      'set PYTHONUTF8=1',
      'set PYTHONIOENCODING=utf-8',
      escapedLine,
      'set "_YTMP3_EXIT=%ERRORLEVEL%"',
      `> "${exitPath}" echo %_YTMP3_EXIT%`,
      'exit /b %_YTMP3_EXIT%'
    ].join('\r\n') + '\r\n';

    const scriptPath = `${tempDir}\\_run_video_${Date.now()}.cmd`;
    let pollTimer = null;
    let activityTimer = null;
    let lastPct = -1;
    let warmupPct = 3;
    let currentPhase = 'download';

    function reportProgress(pct, speed, eta, phase) {
      currentPhase = phase || currentPhase;
      const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
      if (safePct !== lastPct || currentPhase === 'convert' || speed || eta) {
        lastPct = safePct;
        onProgress && onProgress(safePct, speed || '', eta || '', currentPhase);
      }
    }

    function startActivityPulse() {
      activityTimer = setInterval(() => {
        if (signal && signal.aborted) return;
        if (currentPhase === 'convert') {
          const next = Math.min(98, Math.max(lastPct, 92) + 0.4);
          reportProgress(next, '', '파일 정리 중', 'convert');
          return;
        }
        if (lastPct < 15) {
          warmupPct = Math.min(15, warmupPct + 1.5);
          reportProgress(warmupPct, '', '연결 중', 'download');
        }
      }, 1200);
    }

    function startPolling() {
      pollTimer = setInterval(async () => {
        try {
          const content = await Neutralino.filesystem.readFile(log);
          if (!content) return;
          parseProgress(content, reportProgress);
        } catch (e) { /* 로그 파일이 아직 없으면 무시 */ }
      }, 800);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
    }

    try {
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      startPolling();
      startActivityPulse();

      if (signal && signal.aborted) throw new Error('CANCELLED');

      const commandPromise = runCmdInBackground(`cmd /c "${scriptPath}"`, exitPath, signal);
      commandPromise.catch(() => {});

      let r = null;
      if (signal) {
        let abortHandler = null;
        const abortPromise = new Promise((_, reject) => {
          abortHandler = () => {
            void cancelActiveDownload();
            reject(new Error('CANCELLED'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        });

        try {
          r = await Promise.race([commandPromise, abortPromise]);
        } finally {
          if (abortHandler) signal.removeEventListener('abort', abortHandler);
        }
      } else {
        r = await commandPromise;
      }

      stopPolling();

      if (signal && signal.aborted) throw new Error('CANCELLED');

      try { await Neutralino.filesystem.removeFile(scriptPath); } catch (e) { /* ignored */ }
      try { await Neutralino.filesystem.removeFile(exitPath); } catch (e) { /* ignored */ }

      let finalLog = '';
      try { finalLog = await Neutralino.filesystem.readFile(log); } catch (e) { /* ignored */ }
      parseProgress(finalLog, reportProgress);

      if (r.exitCode !== 0) {
        const errLine = finalLog.split('\n').reverse().find(l =>
          l.trim() && /error/i.test(l) && !l.includes('[debug]')
        );
        const errorText = errLine || finalLog;
        if (isDpapiCookieError(errorText)) {
          throw new Error(chromiumDpapiCookieErrorMessage(cookieBrowser));
        }
        if (isBrowserCookieCopyError(errorText)) {
          throw new Error(browserCookieCopyErrorMessage(cookieBrowser));
        }
        if (isDouyinCookieError(source, errorText)) {
          throw new Error(await douyinDownloadErrorMessage({
            source,
            errorText,
            cookieFile: resolvedCookieFile
          }));
        }
        throw new Error(errLine || `yt-dlp 오류 (종료 코드: ${r.exitCode})`);
      }

      reportProgress(100, '', '', 'convert');
      const filePath = parseFinalFilePath(finalLog, savePath, videoExts) ||
        await findLatestFile(savePath, startedAt - 5000, videoExts) ||
        savePath;
      return filePath === savePath ? filePath : await waitForFileReady(filePath);

    } catch (e) {
      stopPolling();
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch (_) { /* ignored */ }
      try { await Neutralino.filesystem.removeFile(exitPath); } catch (_) { /* ignored */ }
      throw e;
    } finally {
      activeDownloadPid = 0;
    }
  }

  function cleanPathText(value) {
    return String(value || '')
      .trim()
      .replace(/^"|"$/g, '')
      .replace(/\r/g, '');
  }

  function isInsideDir(filePath, dir) {
    const normalizedFile = String(filePath || '').replace(/\//g, '\\').toLowerCase();
    const normalizedDir = String(dir || '').replace(/\//g, '\\').replace(/[\\]+$/, '').toLowerCase();
    return !!normalizedDir && normalizedFile.startsWith(`${normalizedDir}\\`);
  }

  function parseFinalFilePath(log, savePath, mediaExts = /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i) {
    if (!log) return '';

    const candidates = [];
    const patterns = [
      /\[ExtractAudio\]\s+Destination:\s+(.+)$/i,
      /\[ExtractAudio\]\s+Not converting audio\s+(.+?);\s+file is already/i,
      /\[Metadata\]\s+Adding metadata to\s+"(.+?)"/i,
      /\[EmbedThumbnail\]\s+ffmpeg:\s+Adding thumbnail to\s+"(.+?)"/i,
      /\[download\]\s+(.+?)\s+has already been downloaded/i,
      /\[download\]\s+Destination:\s+(.+)$/i,
      /\[Merger\]\s+Merging formats into\s+"(.+?)"/i,
      /\[MoveFiles\]\s+Moving file\s+.+?\s+to\s+"(.+?)"/i,
      /\[VideoRemuxer\]\s+Remuxing video from\s+".+?"\s+to\s+"(.+?)"/i,
      /\[VideoRemuxer\]\s+Not remuxing media file\s+"(.+?)"/i
    ];

    String(log).split(/\r?\n/).forEach((line, index) => {
      const marker = '__YTMP3_FILE__:';
      const markerIndex = line.indexOf(marker);
      if (markerIndex >= 0) {
        candidates.push({ path: cleanPathText(line.slice(markerIndex + marker.length)), index });
        return;
      }

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          candidates.push({ path: cleanPathText(match[1]), index });
          return;
        }
      }
    });

    return candidates
      .filter(item => item.path && !/%\([^)]+\)s/.test(item.path))
      .map(item => ({
        path: item.path,
        score: (mediaExts.test(item.path) ? 10 : 0) +
          (isInsideDir(item.path, savePath) ? 5 : 0) +
          (item.index / 1000)
      }))
      .sort((a, b) => b.score - a.score)[0]?.path || '';
  }

  // ────────────────────────────────────────────────────────────────
  //  진행률 파싱
  //  yt-dlp --newline 옵션으로 한 줄씩 출력됨
  // ────────────────────────────────────────────────────────────────
  function parseProgress(content, cb) {
    if (!content) return;
    const lines = content.split('\n');

    // 역순으로 순회해 가장 최신 진행 정보를 찾음
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      // ffmpeg/변환 단계 감지
      if (line.includes('[ExtractAudio]') ||
          line.includes('[ffmpeg]') ||
          line.includes('[EmbedThumbnail]') ||
          line.includes('[Metadata]') ||
          line.includes('Deleting original file')) {
        cb(99, '', '', 'convert');
        return;
      }

      // 다운로드 진행률: [download]  55.2% of ~3.50MiB at 1.20MiB/s ETA 00:02
      if (line.startsWith('[download]') && line.includes('%')) {
        const pctM = line.match(/([\d.]+)%/);
        const spdM = line.match(/([\d.]+\s*[KMG]i?B\/s)/i);
        const etaM = line.match(/ETA\s+([\d:]+)/i);
        if (pctM) {
          cb(
            Math.min(99, parseFloat(pctM[1])),
            spdM ? spdM[1] : '',
            etaM ? etaM[1] : '',
            'download'
          );
          return;
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  저장 폴더에서 가장 최근 오디오 파일 찾기
  // ────────────────────────────────────────────────────────────────
  async function findLatestFile(dir, minModifiedAt = 0, mediaExts = /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i) {
    try {
      const entries = await Neutralino.filesystem.readDirectory(dir);
      const fileTime = entry => {
        const raw = entry.modifiedAt || entry.createdAt || 0;
        const numeric = Number(raw);
        if (numeric) return numeric < 10000000000 ? numeric * 1000 : numeric;
        return Date.parse(raw) || 0;
      };
      const audioFiles = entries
        .filter(e => e.type === 'FILE' && mediaExts.test(e.entry))
        .map(e => ({ entry: e.entry, time: fileTime(e) }))
        .sort((a, b) => b.time - a.time);

      const hasReliableTime = audioFiles.some(e => e.time > 0);
      const candidates = hasReliableTime && minModifiedAt
        ? audioFiles.filter(e => e.time >= minModifiedAt)
        : audioFiles;

      if (candidates.length > 0) {
        return dir.replace(/[\\/]+$/, '') + '\\' + candidates[0].entry;
      }
    } catch (e) { /* ignored */ }
    return '';
  }

  // ────────────────────────────────────────────────────────────────
  //  yt-dlp 업데이트
  // ────────────────────────────────────────────────────────────────
  async function updateYtdlp(onMessage) {
    return installYtdlp(onMessage);
  }

  function notifyInstall(onMessage, payload) {
    try {
      if (typeof onMessage === 'function') onMessage(payload);
    } catch {}
  }

  function mb(bytes) {
    return Math.round((Number(bytes) || 0) / 1024 / 1024 * 10) / 10;
  }

  async function getRemoteContentLength(url) {
    const tempDir = await tempWorkDir();
    const scriptPath = `${tempDir}\\head_${Date.now()}.ps1`;
    const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
    const scriptContent = [
      `$ProgressPreference='SilentlyContinue';`,
      `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;`,
      `$r=Invoke-WebRequest -Uri ${psQuote(url)} -Method Head -MaximumRedirection 10 -UseBasicParsing;`,
      `$len=$r.Headers['Content-Length'];`,
      `if ($len -is [array]) { $len=$len[0] };`,
      `[Console]::Write($len)`,
    ].join('\r\n');
    try {
      await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
      const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
      const size = Number(String(r.stdOut || '').trim());
      return Number.isFinite(size) && size > 0 ? size : 0;
    } catch {
      return 0;
    } finally {
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
    }
  }

  async function pollLocalFileProgress(filePath, totalBytes, onMessage, label, startPct, endPct, shouldStop) {
    let lastSize = -1;
    while (!shouldStop()) {
      try {
        const stats = await Neutralino.filesystem.getStats(filePath);
        const size = Number(stats?.size || stats?.length || 0);
        if (size !== lastSize) {
          lastSize = size;
          if (totalBytes > 0) {
            const pct = startPct + (Math.min(size, totalBytes) / totalBytes) * (endPct - startPct);
            notifyInstall(onMessage, {
              phase: 'download',
              pct,
              message: `${label} 다운로드 중 (${mb(size)} MB / ${mb(totalBytes)} MB)`
            });
          } else {
            notifyInstall(onMessage, {
              phase: 'download',
              pct: null,
              message: `${label} 다운로드 중 (${mb(size)} MB)`
            });
          }
        }
      } catch {}
      await sleep(350);
    }
  }

  async function runInstallScript(scriptPath, scriptContent) {
    await Neutralino.filesystem.writeFile(scriptPath, scriptContent);
    const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, false);
    if (r.exitCode !== 0) {
      const output = `${r.stdOut || ''}\n${r.stdErr || ''}`.trim();
      throw new Error(output || `PowerShell 종료 코드 ${r.exitCode}`);
    }
    return r;
  }

  async function downloadFileWithProgress(url, dest, label, onMessage, startPct, endPct) {
    const tempDir = await tempWorkDir();
    const scriptPath = `${tempDir}\\download_${label.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.ps1`;
    const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
    const totalBytes = await getRemoteContentLength(url);
    const scriptContent = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
      `$url = ${psQuote(url)}`,
      `$dest = ${psQuote(dest)}`,
      `New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null`,
      `if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }`,
      `Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -MaximumRedirection 10`
    ].join('\r\n');

    notifyInstall(onMessage, { phase: 'download', pct: startPct, message: `${label} 다운로드 시작` });
    let done = false;
    const poller = pollLocalFileProgress(dest, totalBytes, onMessage, label, startPct, endPct, () => done).catch(() => {});
    try {
      await runInstallScript(scriptPath, scriptContent);
    } catch (e) {
      const fallback = `cmd /c curl.exe -L --fail --silent --show-error -o "${dest}" "${url}"`;
      const r = await runCmd(fallback, false);
      if (r.exitCode !== 0) {
        const output = `${r.stdOut || ''}\n${r.stdErr || ''}`.trim();
        throw new Error(output || e.message || e);
      }
    } finally {
      done = true;
      await poller;
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
    }
    notifyInstall(onMessage, { phase: 'download', pct: endPct, message: `${label} 다운로드 완료` });
    return dest;
  }

  async function installYtdlp(onMessage = () => {}) {
    const url  = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    const dest = await ytdlpInstallPath();

    notifyInstall(onMessage, { phase: 'prepare', pct: 0, message: 'yt-dlp 다운로드 준비 중…' });
    try {
      await downloadFileWithProgress(url, dest, 'yt-dlp', onMessage, 5, 88);
      notifyInstall(onMessage, { phase: 'verify', pct: 92, message: 'yt-dlp 실행 확인 중' });

      _cache.ytdlp = null;
      _cache.deps = null;
      _cache.depsAt = 0;

      const deps = await checkDeps({ refresh: true });
      if (!deps.ytdlp.ok) {
        throw new Error('설치 후 yt-dlp 실행 확인에 실패했습니다.');
      }

      notifyInstall(onMessage, { phase: 'done', pct: 100, message: `yt-dlp ${deps.ytdlp.version} 설치 완료` });
      return deps;
    } catch (e) {
      notifyInstall(onMessage, { phase: 'error', pct: 100, message: `yt-dlp 설치 실패: ${e.message || e}` });
      throw e;
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  ffmpeg 설치 / 업데이트
  // ────────────────────────────────────────────────────────────────
  async function installFfmpeg(onMessage = () => {}) {
    const dest = await ffmpegInstallPath();
    const tempDir = await tempWorkDir();
    const scriptPath = `${tempDir}\\install_ffmpeg_${Date.now()}.ps1`;
    const zip = `${tempDir}\\ffmpeg_${Date.now()}.zip`;
    const urls = [
      'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    ];

    const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
    const scriptContent = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
      `$dest = ${psQuote(dest)}`,
      `$zip = ${psQuote(zip)}`,
      `$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ytmp3-ffmpeg-' + [guid]::NewGuid().ToString())`,
      `New-Item -ItemType Directory -Force -Path $tmp | Out-Null`,
      `New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null`,
      `Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force`,
      `$exe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Where-Object { $_.FullName -match '\\\\bin\\\\ffmpeg\\.exe$' } | Select-Object -First 1`,
      `if (-not $exe) { $exe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1 }`,
      `if (-not $exe) { throw '압축 파일 안에서 ffmpeg.exe를 찾지 못했습니다.' }`,
      `Copy-Item -LiteralPath $exe.FullName -Destination $dest -Force`,
      `& $dest -version | Out-Null`,
      `Remove-Item -LiteralPath $tmp -Recurse -Force`,
      `Write-Output "ffmpeg installed: $dest"`
    ].join('\r\n');

    notifyInstall(onMessage, { phase: 'prepare', pct: 0, message: 'ffmpeg 다운로드 준비 중…' });
    try {
      let lastError = null;
      for (const url of urls) {
        try {
          await downloadFileWithProgress(url, zip, 'ffmpeg', onMessage, 5, 62);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (lastError) {
        throw lastError;
      }
      notifyInstall(onMessage, { phase: 'extract', pct: 72, message: 'ffmpeg 압축 해제 중' });
      await runInstallScript(scriptPath, scriptContent);
      notifyInstall(onMessage, { phase: 'verify', pct: 95, message: 'ffmpeg 실행 확인 중' });

      _cache.ffmpeg = null;
      _cache.deps = null;
      _cache.depsAt = 0;

      const deps = await checkDeps({ refresh: true });
      if (!deps.ffmpeg.ok) {
        throw new Error('설치 후 ffmpeg 실행 확인에 실패했습니다.');
      }

      notifyInstall(onMessage, { phase: 'done', pct: 100, message: `ffmpeg ${deps.ffmpeg.version} 설치 완료` });
      return deps;
    } catch (e) {
      notifyInstall(onMessage, { phase: 'error', pct: 100, message: `ffmpeg 설치 실패: ${e.message || e}` });
      throw e;
    } finally {
      try { await Neutralino.filesystem.removeFile(scriptPath); } catch {}
      try { await Neutralino.filesystem.removeFile(zip); } catch {}
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  유틸
  // ────────────────────────────────────────────────────────────────
  function formatDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  return { checkDeps, getVideoInfo, download, downloadVideo, inspectCookieFileForSource, refreshCookieFileFromBrowser, updateYtdlp, installYtdlp, installFfmpeg, cancelActiveDownload, cleanupTempScripts };
})();
