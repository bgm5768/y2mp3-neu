/**
 * resources/js/converter/queue-ui.js
 * Conversion queue rendering and queue action handling.
 */

export function createQueueUi({ Queue, appState }) {
  function itemButton(action, id, label, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${className} btn-sm`;
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.textContent = label;
    return btn;
  }

  function modeActionLabel(item) {
    return item?.mode === 'video' ? '다운로드' : '변환';
  }

  function statusLabel(status, item) {
    return ({
      waiting: '대기 중',
      loading: '정보 불러오는 중',
      running: `${modeActionLabel(item)} 중`,
      done: '완료',
      error: '실패',
      cancelled: '취소됨'
    })[status] || status;
  }

  const QueueUI = {
    render() {
      const panel = document.getElementById('queue-panel');
      const list = document.getElementById('queue-list');
      const empty = document.getElementById('queue-empty');
      const items = Queue.getAll();

      panel.classList.toggle('hidden', items.length === 0);
      empty.classList.toggle('hidden', items.length > 0);
      list.innerHTML = '';
      items.forEach(item => list.appendChild(this.createItemEl(item)));

      this.updateSummary();
      this.updateToolbar();
    },

    createItemEl(item) {
      const el = document.createElement('div');
      el.className = `queue-item queue-item-${item.status}`;
      el.id = `queue-item-${item.id}`;

      const thumb = document.createElement('div');
      thumb.className = `queue-thumb ${item.thumbnail ? '' : 'queue-thumb-empty'}`;
      if (item.thumbnail) {
        const img = document.createElement('img');
        img.src = item.thumbnail;
        img.alt = '';
        thumb.appendChild(img);
      }

      const info = document.createElement('div');
      info.className = 'queue-info';

      const title = document.createElement('div');
      title.className = 'queue-title';
      title.textContent = item.title || item.url;

      const url = document.createElement('div');
      url.className = 'queue-url';
      url.textContent = item.url;

      const meta = document.createElement('div');
      meta.className = 'queue-meta';
      meta.textContent = [
        item.modeLabel,
        item.sourceLabel,
        item.uploader,
        item.duration
      ].filter(Boolean).join(' · ');
      meta.classList.toggle('hidden', !meta.textContent);

      const progress = document.createElement('div');
      progress.className = 'queue-progress-wrap';
      const progressBar = document.createElement('div');
      progressBar.className = 'queue-progress-bar';
      progressBar.style.width = `${Math.max(0, Math.min(100, Number(item.pct) || 0))}%`;
      progress.appendChild(progressBar);
      progress.classList.toggle('hidden', !['loading', 'running', 'done'].includes(item.status));

      const detail = document.createElement('div');
      detail.className = 'queue-detail';
      detail.textContent = [item.speed ? `속도: ${item.speed}` : '', item.eta ? `상태: ${item.eta}` : '']
        .filter(Boolean)
        .join(' ? ');
      detail.classList.toggle('hidden', !detail.textContent || !['loading', 'running'].includes(item.status));

      const error = document.createElement('div');
      error.className = 'queue-error';
      error.textContent = item.errorMsg || '';
      error.classList.toggle('hidden', !item.errorMsg);

      info.append(title, url, meta, progress, detail, error);

      const status = document.createElement('span');
      status.className = `queue-status ${item.status}`;
      status.textContent = statusLabel(item.status, item);

      const actions = document.createElement('div');
      actions.className = 'queue-item-actions';
      this.appendItemActions(actions, item);

      el.append(thumb, info, status, actions);
      return el;
    },

    appendItemActions(container, item) {
      if (item.status === 'running' || item.status === 'loading') {
        container.appendChild(itemButton('cancel', item.id, '취소', 'btn-danger'));
        return;
      }

      if (item.status === 'error' || item.status === 'cancelled') {
        container.appendChild(itemButton('retry', item.id, '재시도', 'btn-secondary'));
      }

      if (item.status === 'done' && item.filePath) {
        container.appendChild(itemButton('open', item.id, '파일 열기', 'btn-secondary'));
      }

      container.appendChild(itemButton('remove', item.id, '항목 지우기', 'btn-ghost'));
    },

    updateItem(id, patch) {
      Queue.update(id, patch);
      this.render();
    },

    updateSummary() {
      const summary = document.getElementById('queue-summary');
      const items = Queue.getAll();
      if (!items.length) {
        summary.textContent = '대기 중인 항목이 없습니다.';
        return;
      }

      const counts = items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      const parts = [`총 ${items.length}개`];
      [
        ['waiting', '대기 중'],
        ['loading', '정보 불러오는 중'],
        ['running', '진행 중'],
        ['done', '완료'],
        ['error', '실패'],
        ['cancelled', '취소됨']
      ].forEach(([key, label]) => {
        if (counts[key]) parts.push(`${label} ${counts[key]}개`);
      });

      summary.textContent = parts.join(' · ');
    },

    updateToolbar() {
      const startBtn = document.getElementById('start-all-btn');
      const clearDoneBtn = document.getElementById('clear-completed-btn');
      const clearBtn = document.getElementById('clear-queue-btn');
      const runnable = Queue.getRunnable();
      const hasErrors = Queue.getAll().some(item => item.status === 'error' || item.status === 'cancelled');
      const hasDone = Queue.getAll().some(item => item.status === 'done');

      startBtn.textContent = hasErrors && !Queue.getAll().some(item => item.status === 'waiting')
        ? '전체 재시도'
        : '전체 시작';
      startBtn.disabled = appState.isQueueRunning || runnable.length === 0;
      clearDoneBtn.disabled = appState.isQueueRunning || !hasDone;
      clearBtn.disabled = appState.isQueueRunning || Queue.getAll().length === 0;
    }
  };

  return QueueUI;
}

export function createQueueActionHandler({
  appState,
  Queue,
  QueueUI,
  YTDlp,
  runQueue,
  openDownloadedFile,
  updateUrlAnalysisView
}) {
  return function handleQueueAction(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    const item = Queue.getById(id);
    const action = btn.dataset.action;

    if (action === 'cancel') {
      if (appState.currentItemId === id && appState.cancelController) {
        appState.cancelRequested = true;
        appState.cancelController.abort();
        void YTDlp.cancelActiveDownload();
      } else {
        QueueUI.updateItem(id, { status: 'cancelled', errorMsg: '사용자가 취소했습니다.' });
      }
      return;
    }

    if (!item) return;

    if (action === 'retry') {
      Queue.resetForRetry(id);
      QueueUI.render();
      if (!appState.isQueueRunning) void runQueue([id]);
    } else if (action === 'open') {
      void openDownloadedFile(item.filePath);
    } else if (action === 'remove') {
      Queue.remove(id);
      QueueUI.render();
      updateUrlAnalysisView();
    }
  };
}
