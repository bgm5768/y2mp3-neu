const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'neutralino.config.json');
const distDir = path.join(root, 'dist');
const appDistDir = path.join(distDir, 'yt-mp3');
const sourceResources = path.join(appDistDir, 'resources.neu');
const releaseResources = path.join(distDir, 'resources.neu');
const manifestPath = path.join(distDir, 'update.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureFile(file, message) {
  if (!fs.existsSync(file)) {
    throw new Error(`${message}: ${file}`);
  }
}

const config = readJson(configPath);
const repository = process.env.GITHUB_REPOSITORY || 'bgm5768/y2mp3-neu';
const tag = process.env.RELEASE_TAG || `v${config.version}`;
const resourcesAsset = process.env.NEUTRALINO_RESOURCES_ASSET || 'resources.neu';

ensureFile(sourceResources, 'resources.neu 파일이 없습니다. 먼저 npm run build를 실행하세요');
fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(sourceResources, releaseResources);

const manifest = {
  applicationId: config.applicationId,
  version: config.version,
  resourcesURL: `https://github.com/${repository}/releases/download/${tag}/${resourcesAsset}`,
  data: {
    repository,
    tag,
    generatedAt: new Date().toISOString()
  }
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Generated ${path.relative(root, manifestPath)}`);
console.log(`Prepared ${path.relative(root, releaseResources)}`);
console.log(`Release tag: ${tag}`);

