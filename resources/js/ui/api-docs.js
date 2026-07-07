/**
 * resources/js/ui/api-docs.js
 * API documentation tab rendering and copy actions.
 */

export function createApiDocs({ Settings, Neutralino, Toast }) {
  const sampleUrls = {
    audio: 'https://www.youtube.com/watch?v=...',
    video: 'https://www.tiktok.com/@user/video/...'
  };

  const snippets = [
    'api-snippet-global',
    'api-snippet-module',
    'api-snippet-batch',
    'api-snippet-progress',
    'api-snippet-tool'
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function jsString(value) {
    return JSON.stringify(String(value || ''));
  }

  function selectedMode() {
    return el('api-mode-select')?.value === 'video' ? 'video' : 'audio';
  }

  function currentSavePath(mode) {
    const override = el('api-save-path-input')?.value.trim();
    if (override) return override;
    return Settings.getActiveSavePath(mode) || '';
  }

  function selectedUrl(mode) {
    const value = el('api-url-input')?.value.trim();
    return value || sampleUrls[mode];
  }

  function optionLines(mode, savePath, indent = '  ') {
    const lines = [
      `${indent}mode: ${jsString(mode)},`
    ];

    if (savePath) {
      lines.push(`${indent}savePath: ${jsString(savePath)},`);
    }

    if (mode === 'video') {
      lines.push(`${indent}videoQuality: 'best',`);
      lines.push(`${indent}videoFormat: 'mp4',`);
    } else {
      lines.push(`${indent}quality: '192',`);
      lines.push(`${indent}format: 'mp3',`);
      lines.push(`${indent}embedThumb: true,`);
      lines.push(`${indent}embedMeta: true,`);
    }

    return lines;
  }

  function renderGlobalSnippet(mode, url, savePath) {
    return `const api = window.YtMp3ConversionApi;

const result = await api.convertItem({
  url: ${jsString(url)},
  mode: ${jsString(mode)}
}, {
${optionLines(mode, savePath).join('\n')}
  onProgress: (pct, speed, eta, phase) => {
    console.log({ pct, speed, eta, phase });
  }
});

console.log('saved:', result.filePath);`;
  }

  function renderModuleSnippet(mode, url, savePath) {
    return `import { createConversionApi } from './converter/conversion-api.js';

await Settings.load();

const api = createConversionApi({
  YTDlp,
  Settings,
  Neutralino
});

const result = await api.convertItem({
  url: ${jsString(url)},
  mode: ${jsString(mode)}
}, {
${optionLines(mode, savePath).join('\n')}
});

console.log(result.filePath);`;
  }

  function renderBatchSnippet(mode, url, savePath) {
    const batchInput = `${url}\nhttps://www.youtube.com/watch?v=...`;
    return `const api = window.YtMp3ConversionApi;
const input = ${jsString(batchInput)};

const { analysis, results } = await api.convertInput(input, {
${optionLines(mode, savePath).join('\n')}
  stopOnError: false,
  onProgress: (pct, speed, eta, phase) => {
    console.log(\`[\${phase}] \${pct}% \${speed} \${eta}\`);
  }
});

console.log('valid:', analysis.valid.length);
console.log('invalid:', analysis.invalid);
console.log(results.map(item => ({
  status: item.status,
  filePath: item.filePath,
  error: item.error?.message || ''
})));`;
  }

  function renderProgressSnippet(mode, url, savePath) {
    return `const api = window.YtMp3ConversionApi;
const controller = new AbortController();

// 취소가 필요하면 controller.abort()를 호출하세요.
const result = await api.convertItem({
  url: ${jsString(url)},
  mode: ${jsString(mode)}
}, {
${optionLines(mode, savePath).join('\n')}
  signal: controller.signal,
  onProgress: (pct, speed, eta, phase) => {
    const message = phase === 'convert'
      ? '파일 정리 중'
      : (eta || '다운로드 중');

    console.log({
      percent: Math.round(pct),
      speed,
      message
    });
  }
});

return result.filePath;`;
  }

  function renderToolSnippet(mode, url, savePath) {
    return `async function downloadMediaTool(args = {}) {
  const api = window.YtMp3ConversionApi;
  const mode = args.mode || ${jsString(mode)};
  const input = Array.isArray(args.urls)
    ? args.urls.join('\\n')
    : (args.url || ${jsString(url)});

  const { analysis, results } = await api.convertInput(input, {
    mode,
    savePath: args.savePath || ${jsString(savePath)},
    quality: args.quality || '192',
    format: args.format || 'mp3',
    videoQuality: args.videoQuality || 'best',
    videoFormat: args.videoFormat || 'mp4',
    stopOnError: false
  });

  return {
    validCount: analysis.valid.length,
    invalidUrls: analysis.invalid,
    files: results
      .filter(item => item.status === 'done')
      .map(item => item.filePath),
    errors: results
      .filter(item => item.status === 'error')
      .map(item => item.error?.message || 'unknown error')
  };
}

// 예시
await downloadMediaTool({
  mode: ${jsString(mode)},
  urls: [${jsString(url)}]
});`;
  }

  function renderSnippets() {
    const mode = selectedMode();
    const url = selectedUrl(mode);
    const savePath = currentSavePath(mode);
    const currentPath = el('api-current-path');

    if (currentPath) {
      currentPath.textContent = savePath
        ? `현재 샘플 저장 위치: ${savePath}`
        : '저장 위치가 비어 있습니다. 설정 탭에서 저장 폴더를 지정하거나 위 입력칸에 직접 넣으세요.';
    }

    const content = {
      'api-snippet-global': renderGlobalSnippet(mode, url, savePath),
      'api-snippet-module': renderModuleSnippet(mode, url, savePath),
      'api-snippet-batch': renderBatchSnippet(mode, url, savePath),
      'api-snippet-progress': renderProgressSnippet(mode, url, savePath),
      'api-snippet-tool': renderToolSnippet(mode, url, savePath)
    };

    snippets.forEach(id => {
      const node = el(id);
      if (node) node.textContent = content[id] || '';
    });
  }

  async function copyText(text) {
    if (!text) return;
    if (Neutralino?.clipboard?.writeText) {
      await Neutralino.clipboard.writeText(text);
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  async function copySnippet(id) {
    const text = el(id)?.textContent || '';
    try {
      await copyText(text);
      Toast.show('API 예시 코드를 복사했습니다.', 'success', 2200);
    } catch {
      Toast.show('복사하지 못했습니다.', 'error', 3000);
    }
  }

  function syncUrlPlaceholder() {
    const mode = selectedMode();
    const input = el('api-url-input');
    if (!input) return;
    input.placeholder = sampleUrls[mode];
    if (!input.value.trim() || Object.values(sampleUrls).includes(input.value.trim())) {
      input.value = sampleUrls[mode];
    }
  }

  function initApiTab() {
    const root = el('tab-api');
    if (!root) return;

    el('api-mode-select')?.addEventListener('change', () => {
      syncUrlPlaceholder();
      renderSnippets();
    });
    el('api-url-input')?.addEventListener('input', renderSnippets);
    el('api-save-path-input')?.addEventListener('input', renderSnippets);

    root.addEventListener('click', event => {
      const button = event.target.closest('button[data-api-copy-target]');
      if (!button) return;
      void copySnippet(button.dataset.apiCopyTarget);
    });

    syncUrlPlaceholder();
    renderSnippets();
  }

  return {
    initApiTab,
    renderSnippets
  };
}
