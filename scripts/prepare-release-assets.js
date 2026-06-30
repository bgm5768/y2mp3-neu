const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const sourceResources = path.join(distDir, 'yt-mp3', 'resources.neu');
const releaseResources = path.join(distDir, 'resources.neu');
const staleManifest = path.join(distDir, 'update.json');

function ensureFile(file, message) {
  if (!fs.existsSync(file)) {
    throw new Error(`${message}: ${file}`);
  }
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

ensureFile(sourceResources, 'resources.neu 파일이 없습니다. 먼저 npm run build를 실행하세요');
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(sourceResources, releaseResources);
if (fs.existsSync(staleManifest)) {
  fs.unlinkSync(staleManifest);
}

console.log(`Prepared ${path.relative(root, releaseResources)}`);
console.log(`SHA256 ${sha256(releaseResources)}`);
