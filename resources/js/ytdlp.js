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
      const killTools = 'taskkill /F /IM yt-dlp.exe /T >nul 2>&1 & taskkill /F /IM ffmpeg.exe /T >nul 2>&1';
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
      throw new Error('YouTube URL을 다시 확인해 주세요.');
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

  function parseFinalFilePath(log, savePath) {
    if (!log) return '';

    const audioExts = /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i;
    const candidates = [];
    const patterns = [
      /\[ExtractAudio\]\s+Destination:\s+(.+)$/i,
      /\[ExtractAudio\]\s+Not converting audio\s+(.+?);\s+file is already/i,
      /\[Metadata\]\s+Adding metadata to\s+"(.+?)"/i,
      /\[EmbedThumbnail\]\s+ffmpeg:\s+Adding thumbnail to\s+"(.+?)"/i,
      /\[download\]\s+(.+?)\s+has already been downloaded/i,
      /\[download\]\s+Destination:\s+(.+)$/i,
      /\[Merger\]\s+Merging formats into\s+"(.+?)"/i,
      /\[MoveFiles\]\s+Moving file\s+.+?\s+to\s+"(.+?)"/i
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
        score: (audioExts.test(item.path) ? 10 : 0) +
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
  async function findLatestFile(dir, minModifiedAt = 0) {
    try {
      const entries = await Neutralino.filesystem.readDirectory(dir);
      const audioExts = /\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i;
      const fileTime = entry => {
        const raw = entry.modifiedAt || entry.createdAt || 0;
        const numeric = Number(raw);
        if (numeric) return numeric < 10000000000 ? numeric * 1000 : numeric;
        return Date.parse(raw) || 0;
      };
      const audioFiles = entries
        .filter(e => e.type === 'FILE' && audioExts.test(e.entry))
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

  return { checkDeps, getVideoInfo, download, updateYtdlp, installYtdlp, installFfmpeg, cancelActiveDownload, cleanupTempScripts };
})();
