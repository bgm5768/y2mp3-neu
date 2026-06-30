/**
 * resources/js/queue.js
 * 변환 대기열 상태 관리
 */

const Queue = (() => {
  let items = [];
  let idCounter = 0;

  const runnableStatuses = new Set(['waiting', 'error', 'cancelled']);

  function createItem(input) {
    const url = typeof input === 'string' ? input : input.url;
    return {
      id: ++idCounter,
      url,
      rawUrl: input.rawUrl || input.raw || url,
      urlKey: input.urlKey || url,
      mode: input.mode || 'audio',
      modeLabel: input.modeLabel || 'MP3',
      source: input.source || '',
      sourceLabel: input.sourceLabel || '',
      options: input.options || null,
      title: input.title || url,
      thumbnail: input.thumbnail || '',
      duration: input.duration || '',
      uploader: input.uploader || '',
      status: 'waiting',
      pct: 0,
      speed: '',
      eta: '',
      errorMsg: '',
      filePath: ''
    };
  }

  function add(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    const newItems = list
      .filter(Boolean)
      .map(createItem);

    items = [...items, ...newItems];
    return newItems;
  }

  function remove(id) {
    items = items.filter(i => i.id !== Number(id));
  }

  function removeByStatus(statuses) {
    const statusSet = new Set(statuses);
    items = items.filter(i => !statusSet.has(i.status));
  }

  function clear() {
    items = [];
  }

  function update(id, patch) {
    items = items.map(i => i.id === Number(id) ? { ...i, ...patch } : i);
  }

  function resetForRetry(id) {
    update(id, {
      status: 'waiting',
      pct: 0,
      speed: '',
      eta: '',
      errorMsg: '',
      filePath: ''
    });
  }

  function getById(id) {
    return items.find(i => i.id === Number(id)) || null;
  }

  function getAll() {
    return [...items];
  }

  function getRunnable() {
    return items.filter(i => runnableStatuses.has(i.status));
  }

  function hasRunning() {
    return items.some(i => i.status === 'loading' || i.status === 'running');
  }

  return {
    add,
    remove,
    removeByStatus,
    clear,
    update,
    resetForRetry,
    getById,
    getAll,
    getRunnable,
    hasRunning
  };
})();
