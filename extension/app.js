/**
 * extension/app.js
 * Neutralinojs Extension – Node.js 프로세스로 실행됩니다.
 * yt-dlp-wrap + ffmpeg-static 을 사용하여 다운로드/변환 처리.
 */

'use strict';

const path        = require('path');
const fs          = require('fs');
const fse         = require('fs-extra');
const { execFile, spawn } = require('child_process');
const YTDlpWrap   = require('yt-dlp-wrap').default;
const ffmpegPath  = require('ffmpeg-static');
const WebSocket   = require('ws');

// ─── Neutralinojs Extension WebSocket 연결 ────────────────────────────
const NL_PORT   = process.env.NL_PORT;
const NL_TOKEN  = process.env.NL_TOKEN;
const EXT_ID    = 'js.neutralino.ytmp3';

let ws;
let activeProcess = null;   // 취소를 위한 현재 실행 중인 프로세스

function connectWS() {
  ws = new WebSocket(`ws://localhost:${NL_PORT}?extensionId=${EXT_ID}`);

  ws.on('open', () => {
    console.log('[ext] WebSocket 연결됨');
    sendEvent('ready', { status: 'ok' });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(msg);
    } catch (e) {
      console.error('[ext] 메시지 파싱 오류:', e);
    }
  });

  ws.on('close', () => {
    console.log('[ext] WebSocket 닫힘 – 2초 후 재연결');
    setTimeout(connectWS, 2000);
  });

  ws.on('error', (err) => console.error('[ext] WS 오류:', err.message));
}

function sendEvent(event, data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    id:    Date.now().toString(),
    method: 'app.broadcast',
    accessToken: NL_TOKEN,
    data: {
      event: `${EXT_ID}:${event}`,
      data: JSON.stringify(data)
    }
  }));
}

// ─── 메시지 라우터 ────────────────────────────────────────────────────
async function handleMessage(msg) {
  // Neutralinojs Extension 메시지 구조:
  // { event: "extensionReady" | "...", data: "..." }
  // extensions.dispatch() 로 보낸 메시지는:
  // { event: "eventName", data: "{...JSON...}" }
  const event   = msg.event;
  const rawData = msg.data;

  let data = {};
  if (rawData) {
    try { data = JSON.parse(rawData); } catch { data = {}; }
  }

  console.log('[ext] 수신 이벤트:', event, data);

  switch (event) {
    case 'getVideoInfo':   await handleGetVideoInfo(data);  break;
    case 'startDownload':  await handleStartDownload(data); break;
    case 'cancelDownload': handleCancel();                  break;
    case 'checkDeps':      await handleCheckDeps();         break;
    case 'installFfmpeg':  await handleInstallFfmpeg();     break;
    case 'updateYtdlp':    await handleUpdateYtdlp(data);   break;
    case 'startQueue':     await handleStartQueue(data);    break;
  }
}

// ─── yt-dlp 바이너리 경로 결정 ───────────────────────────────────────
function getYtdlpBinPath() {
  const localBin = path.join(process.env.NL_PATH || __dirname, 'bin',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localBin)) return localBin;
  // 시스템 PATH에 있는 경우
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function createYtDlp() {
  return new YTDlpWrap(getYtdlpBinPath());
}

// ─── 영상 정보 가져오기 ───────────────────────────────────────────────
async function handleGetVideoInfo({ url }) {
  try {
    const ytdlp = createYtDlp();
    const info = await ytdlp.getVideoInfo(url);
    sendEvent('videoInfo', {
      ok:        true,
      title:     info.title,
      thumbnail: info.thumbnail,
      duration:  info.duration_string || formatDuration(info.duration),
      uploader:  info.uploader,
      url
    });
  } catch (err) {
    sendEvent('videoInfo', { ok: false, error: err.message });
  }
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ─── 다운로드 + 변환 ──────────────────────────────────────────────────
async function handleStartDownload({ url, quality, format, savePath,
                                     embedThumb, embedMeta, cookiePath,
                                     proxy, rateLimit, itemId }) {

  sendEvent('progress', { itemId, phase: 'download', pct: 0, speed: '', eta: '' });

  const ytdlp = createYtDlp();
  const outputTemplate = path.join(savePath, '%(title)s.%(ext)s');

  const args = buildYtdlpArgs({
    url, quality, format, outputTemplate,
    embedThumb, embedMeta, cookiePath, proxy, rateLimit
  });

  try {
    await new Promise((resolve, reject) => {
      const proc = ytdlp.exec(args);
      activeProcess = proc;

      proc.on('ytDlpEvent', (type, line) => {
        if (type === 'download') {
          const pct    = parseFloat(line.match(/(\d+\.?\d*)%/)?.[1] || 0);
          const speed  = line.match(/at\s+([\d.]+\w+\/s)/)?.[1] || '';
          const eta    = line.match(/ETA\s+([\d:]+)/)?.[1] || '';
          sendEvent('progress', { itemId, phase: 'download', pct, speed, eta });
        }
      });

      proc.on('error', (err) => {
        activeProcess = null;
        reject(err);
      });

      proc.on('close', (code) => {
        activeProcess = null;
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp 종료 코드: ${code}`));
      });
    });

    // 저장된 파일 탐색
    const savedFile = findLatestFile(savePath);
    sendEvent('done', {
      ok:       true,
      itemId,
      filePath: savedFile,
      fileName: path.basename(savedFile)
    });

  } catch (err) {
    if (err.message === 'CANCELLED') {
      sendEvent('cancelled', { itemId });
    } else {
      sendEvent('done', { ok: false, itemId, error: err.message });
    }
  }
}

function buildYtdlpArgs({ url, quality, format, outputTemplate,
                           embedThumb, embedMeta, cookiePath, proxy, rateLimit }) {
  const args = [
    url,
    '--extract-audio',
    '--audio-format', format || 'mp3',
    '--audio-quality', quality || '192',
    '--ffmpeg-location', ffmpegPath,
    '-o', outputTemplate,
    '--no-playlist',
    '--progress'
  ];

  if (embedThumb) {
    args.push('--embed-thumbnail');
    args.push('--convert-thumbnails', 'jpg');
  }
  if (embedMeta)  args.push('--add-metadata');
  if (cookiePath && fs.existsSync(cookiePath)) {
    args.push('--cookies', cookiePath);
  }
  if (proxy)      args.push('--proxy', proxy);
  if (rateLimit)  args.push('--rate-limit', rateLimit);

  return args;
}

// 취소
function handleCancel() {
  if (activeProcess) {
    try { activeProcess.kill('SIGTERM'); } catch {}
    activeProcess = null;
  }
  sendEvent('cancelled', {});
}

// 저장 폴더에서 가장 최근 파일 탐색
function findLatestFile(dir) {
  if (!fs.existsSync(dir)) return dir;
  const files = fs.readdirSync(dir)
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].name) : dir;
}

// ─── 배치 대기열 처리 ────────────────────────────────────────────────
async function handleStartQueue({ items, quality, format, savePath,
                                   embedThumb, embedMeta, cookiePath,
                                   proxy, rateLimit }) {
  for (const item of items) {
    if (!item.url) continue;
    await handleStartDownload({
      url: item.url, quality, format, savePath,
      embedThumb, embedMeta, cookiePath,
      proxy, rateLimit, itemId: item.id
    });
  }
  sendEvent('queueDone', { total: items.length });
}

// ─── 의존성 확인 ─────────────────────────────────────────────────────
async function handleCheckDeps() {
  const result = { ffmpeg: null, ytdlp: null };

  // ffmpeg – ffmpeg-static 번들 경로를 직접 체크
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    try {
      const ver = await getFfmpegVersion(ffmpegPath);
      result.ffmpeg = { ok: true, version: ver };
    } catch (e) {
      // 실행은 되지만 파싱 실패 → 존재는 함
      result.ffmpeg = { ok: true, version: 'ffmpeg-static (번들)' };
    }
  } else {
    result.ffmpeg = { ok: false, version: '' };
  }

  // yt-dlp
  const ytdlpBin = getYtdlpBinPath();
  try {
    const ver = await getVersion(ytdlpBin, ['--version']);
    result.ytdlp = { ok: true, version: ver };
  } catch {
    result.ytdlp = { ok: false, version: '' };
  }

  console.log('[ext] depsStatus:', JSON.stringify(result));
  sendEvent('depsStatus', result);
}

/** ffmpeg -version : 첫 줄에 "ffmpeg version X.Y.Z ..." 형태 */
function getFfmpegVersion(bin) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      const output = stdout || stderr || '';
      const match  = output.match(/ffmpeg version ([\S]+)/i);
      if (match) return resolve(match[1]);
      if (output.trim()) return resolve(output.split('\n')[0].trim());
      reject(new Error('버전 파싱 실패'));
    });
  });
}

function getVersion(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return reject(err);
      const v = (stdout || stderr || '').split('\n')[0].trim();
      if (!v) return reject(new Error('empty output'));
      resolve(v);
    });
  });
}

// ─── ffmpeg 설치 유도 ────────────────────────────────────────────────
async function handleInstallFfmpeg() {
  // ffmpeg-static 은 npm 패키지로 이미 번들되어 있으므로
  // 실제로는 ffmpegPath 를 사용하면 됩니다.
  // 여기서는 시스템 PATH 에 없는 경우 안내 메시지를 보냅니다.
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    sendEvent('installFfmpegResult', {
      ok: true,
      message: `ffmpeg-static 번들 사용 중: ${ffmpegPath}`
    });
  } else {
    sendEvent('installFfmpegResult', {
      ok: false,
      message: 'ffmpeg 바이너리를 찾을 수 없습니다. npm install을 다시 실행하세요.'
    });
  }
}

// ─── yt-dlp 업데이트 ─────────────────────────────────────────────────
async function handleUpdateYtdlp({ binDir }) {
  try {
    const targetDir = binDir || path.join(process.env.NL_PATH || __dirname, 'bin');
    await fse.ensureDir(targetDir);
    sendEvent('ytdlpUpdateProgress', { message: 'yt-dlp 최신 버전 다운로드 중…' });
    await YTDlpWrap.downloadFromGithub(targetDir);
    sendEvent('ytdlpUpdateProgress', { message: '업데이트 완료!' });
    await handleCheckDeps();
  } catch (err) {
    sendEvent('ytdlpUpdateProgress', { message: `오류: ${err.message}`, error: true });
  }
}

// ─── 시작 ─────────────────────────────────────────────────────────────
connectWS();
