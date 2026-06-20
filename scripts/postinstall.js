/**
 * scripts/postinstall.js
 * npm install 후 자동 실행 – yt-dlp 바이너리 다운로드 및 ffmpeg 확인
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { execFile } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const RES_BIN_DIR = path.join(__dirname, '..', 'resources', 'bin');
const IS_WIN  = process.platform === 'win32';
const YTDLP_BIN = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

// GitHub 최신 릴리즈에서 yt-dlp 다운로드 URL
const YTDLP_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : process.platform === 'darwin'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

async function main() {
  console.log('\n🎵 YT→MP3 Converter 설치 후 스크립트 실행 중...\n');

  // 1. bin 폴더 생성
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log(`📁 bin 디렉터리 생성: ${BIN_DIR}`);
  }

  // 2. yt-dlp 다운로드 (프로젝트 루트 bin) 및 resources/bin 복사
  try {
    if (!fs.existsSync(YTDLP_BIN)) {
      console.log(`⬇  yt-dlp 다운로드 중 (${IS_WIN ? 'Windows' : process.platform})...`);
      await downloadFile(YTDLP_URL, YTDLP_BIN);
      if (!IS_WIN) fs.chmodSync(YTDLP_BIN, 0o755);
      console.log(`✅ yt-dlp 다운로드 완료: ${YTDLP_BIN}`);
    } else {
      console.log(`✅ yt-dlp 이미 존재: ${YTDLP_BIN}`);
    }

    // resources/bin 폴더로 복사 (빌드 시 패키징 용)
    await fse.ensureDir(RES_BIN_DIR);
    const resYtdlp = path.join(RES_BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
    await fse.copy(YTDLP_BIN, resYtdlp, { overwrite: true });
    if (!IS_WIN) fs.chmodSync(resYtdlp, 0o755);
    console.log(`✅ yt-dlp 복사 완료: ${resYtdlp}`);
  } catch (err) {
    console.warn(`⚠  yt-dlp 처리 실패: ${err.message}`);
  }

  // 3. ffmpeg-static 확인 및 resources/bin 복사
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      console.log(`✅ ffmpeg-static 확인됨: ${ffmpegPath}`);
      try {
        await fse.ensureDir(RES_BIN_DIR);
        const resFfmpeg = path.join(RES_BIN_DIR, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
        await fse.copy(ffmpegPath, resFfmpeg, { overwrite: true });
        if (!IS_WIN) fs.chmodSync(resFfmpeg, 0o755);
        console.log(`✅ ffmpeg 복사 완료: ${resFfmpeg}`);
      } catch (copyErr) {
        console.warn('⚠ ffmpeg 복사 실패:', copyErr.message);
      }
    } else {
      console.warn('⚠  ffmpeg-static 경로를 확인할 수 없습니다. npm install을 다시 실행하세요.');
    }
  } catch (err) {
    console.warn('⚠  ffmpeg-static 모듈 로드 실패:', err.message);
  }

  // 4. Neutralinojs 바이너리 다운로드 (neu update)
  console.log('\n📦 Neutralinojs 바이너리 확인 중 (neu update)...');
  try {
    await runCommand('npx', ['neu', 'update'], path.join(__dirname, '..'));
    console.log('✅ Neutralinojs 바이너리 준비 완료');
  } catch (err) {
    console.warn('⚠  neu update 실패 (나중에 수동으로 실행하세요): ', err.message);
  }

  console.log('\n🎉 설치 완료! `npm run dev` 로 앱을 시작하세요.\n');
}

// ── 파일 다운로드 (리다이렉트 지원) ─────────────────────────────────
function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('너무 많은 리다이렉트'));

    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'yt-mp3-installer/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, redirectCount + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (total) {
          const pct = Math.round(received / total * 100);
          process.stdout.write(`\r   ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
      file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = require('child_process').spawn(
      isWin ? cmd + '.cmd' : cmd,
      args,
      { cwd, stdio: 'inherit', shell: isWin }
    );
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}`));
    });
    child.on('error', reject);
  });
}

main().catch(err => {
  console.error('설치 스크립트 오류:', err);
  process.exit(1);
});
