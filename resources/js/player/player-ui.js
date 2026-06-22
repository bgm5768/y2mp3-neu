/**
 * resources/js/player/player-ui.js
 * DOM helpers and rendering for the music player.
 */

import { playerState as state } from './player-state.js';
import { el, setText } from '../core/dom.js';

export { el, setText };

let currentTrack = () => null;
let displayDuration = () => 0;
let displayCurrentTime = () => 0;
let formatTime = seconds => String(seconds || 0);
let formatBytes = size => String(size || '');
let metadataLine = () => '';
let metadataPairs = () => [];
let ensureTrackMetadata = async track => track;
let savePlayerSettings = () => {};
let rebuildQueue = () => {};
let activePlaylist = () => null;
let activePlaylistName = () => 'All music';
let playlistSourceTracks = () => state.tracks;
let renderPlaylistDropdown = () => {};
let sortLabel = () => 'Title';
let sortDirectionLabel = () => 'Ascending';

export function configurePlayerUi(deps = {}) {
  currentTrack = deps.currentTrack || currentTrack;
  displayDuration = deps.displayDuration || displayDuration;
  displayCurrentTime = deps.displayCurrentTime || displayCurrentTime;
  formatTime = deps.formatTime || formatTime;
  formatBytes = deps.formatBytes || formatBytes;
  metadataLine = deps.metadataLine || metadataLine;
  metadataPairs = deps.metadataPairs || metadataPairs;
  ensureTrackMetadata = deps.ensureTrackMetadata || ensureTrackMetadata;
  savePlayerSettings = deps.savePlayerSettings || savePlayerSettings;
  rebuildQueue = deps.rebuildQueue || rebuildQueue;
  activePlaylist = deps.activePlaylist || activePlaylist;
  activePlaylistName = deps.activePlaylistName || activePlaylistName;
  playlistSourceTracks = deps.playlistSourceTracks || playlistSourceTracks;
  renderPlaylistDropdown = deps.renderPlaylistDropdown || renderPlaylistDropdown;
  sortLabel = deps.sortLabel || sortLabel;
  sortDirectionLabel = deps.sortDirectionLabel || sortDirectionLabel;
}

export function setPlayerLoading(isLoading) {
  document.querySelector('.player-card')?.classList.toggle('is-loading', !!isLoading);
}

export function ensureListDom() {
  const tab = el('tab-player');

  if (!el('player-summary') && tab) {
    const header = document.createElement('div');
    header.className = 'player-list-header';
    const heading = document.createElement('div');
    heading.className = 'player-list-heading';
    const titleRow = document.createElement('div');
    titleRow.className = 'player-list-title-row';
    const title = document.createElement('h2');
    title.textContent = '음악';
    const playlistWrap = document.createElement('div');
    playlistWrap.className = 'player-playlist-dropdown';
    const playlistBtn = document.createElement('button');
    playlistBtn.id = 'player-playlist-btn';
    playlistBtn.className = 'player-playlist-btn';
    playlistBtn.type = 'button';
    playlistBtn.setAttribute('aria-haspopup', 'menu');
    playlistBtn.setAttribute('aria-expanded', 'false');
    playlistBtn.innerHTML = '내 음악 <span aria-hidden="true">⌄</span>';
    const playlistMenu = document.createElement('div');
    playlistMenu.id = 'player-playlist-menu';
    playlistMenu.className = 'player-playlist-menu hidden';
    playlistMenu.setAttribute('role', 'menu');
    playlistWrap.append(playlistBtn, playlistMenu);
    titleRow.append(title, playlistWrap);
    const summary = document.createElement('p');
    summary.id = 'player-summary';
    summary.className = 'queue-summary';
    summary.textContent = '음악 파일 0개';
    heading.append(titleRow, summary);
    const toolbar = document.createElement('div');
    toolbar.className = 'player-list-toolbar';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'player-search-wrap';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'player-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '⌕';
    const search = document.createElement('input');
    search.id = 'player-search';
    search.className = 'player-search';
    search.type = 'search';
    search.placeholder = '음악 검색';
    search.autocomplete = 'off';
    search.spellcheck = false;
    searchWrap.append(searchIcon, search);
    const tools = document.createElement('div');
    tools.className = 'player-list-tools';
    const sortLabel = document.createElement('label');
    sortLabel.className = 'player-sort-label';
    sortLabel.setAttribute('for', 'player-sort-select');
    sortLabel.textContent = '정렬';
    const sortSelect = document.createElement('select');
    sortSelect.id = 'player-sort-select';
    sortSelect.className = 'player-sort-select';
    [
      ['title', '제목순'],
      ['duration', '재생시간순']
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      sortSelect.appendChild(option);
    });
    const sortDir = document.createElement('button');
    sortDir.id = 'player-sort-dir-btn';
    sortDir.className = 'player-sort-dir-btn';
    sortDir.type = 'button';
    sortDir.title = '정렬 방향 변경';
    sortDir.setAttribute('aria-label', '정렬 방향 변경');
    sortDir.textContent = '오름차순';
    tools.append(sortLabel, sortSelect, sortDir);
    toolbar.append(searchWrap, tools);
    header.append(heading, toolbar);
    tab.appendChild(header);
  }

  if (!el('player-empty') && tab) {
    const empty = document.createElement('div');
    empty.id = 'player-empty';
    empty.className = 'queue-empty hidden';
    empty.textContent = '현재 저장 위치에서 재생 가능한 음악 파일을 찾지 못했습니다.';
    tab.appendChild(empty);
  }

  if (!el('player-list') && tab) {
    const list = document.createElement('div');
    list.id = 'player-list';
    list.className = 'player-list';
    tab.appendChild(list);
  }

  const header = tab?.querySelector('.player-list-header');
  if (!el('player-selection-bar') && header) {
    const selectionBar = document.createElement('div');
    selectionBar.id = 'player-selection-bar';
    selectionBar.className = 'player-selection-bar hidden';

    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'player-select-all';
    const selectAll = document.createElement('input');
    selectAll.id = 'player-select-all';
    selectAll.type = 'checkbox';
    selectAll.dataset.playerSelectionAction = 'toggle-all';
    const selectAllText = document.createElement('span');
    selectAllText.textContent = '전체 선택';
    selectAllLabel.append(selectAll, selectAllText);

    const status = document.createElement('span');
    status.id = 'player-selection-status';
    status.className = 'player-selection-status';
    status.textContent = '';

    const actions = document.createElement('div');
    actions.className = 'player-selection-actions';
    const addButton = document.createElement('button');
    addButton.id = 'player-selection-add-btn';
    addButton.type = 'button';
    addButton.className = 'btn btn-primary btn-sm';
    addButton.dataset.playerSelectionAction = 'add-selected';
    addButton.textContent = '플레이리스트에 추가';
    const deleteButton = document.createElement('button');
    deleteButton.id = 'player-selection-delete-btn';
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-danger btn-sm';
    deleteButton.dataset.playerSelectionAction = 'delete-selected';
    deleteButton.textContent = '선택 삭제';
    const clearButton = document.createElement('button');
    clearButton.id = 'player-selection-clear-btn';
    clearButton.type = 'button';
    clearButton.className = 'btn btn-ghost btn-sm';
    clearButton.dataset.playerSelectionAction = 'clear';
    clearButton.textContent = '선택 해제';
    actions.append(addButton, deleteButton, clearButton);

    selectionBar.append(selectAllLabel, status, actions);
    header.appendChild(selectionBar);
  }

  return {
    list: el('player-list'),
    empty: el('player-empty'),
    summary: el('player-summary')
  };
}

function ensureSelectionSet() {
  if (state.selectedTrackIds instanceof Set) return state.selectedTrackIds;
  state.selectedTrackIds = new Set(Array.isArray(state.selectedTrackIds) ? state.selectedTrackIds : []);
  return state.selectedTrackIds;
}

function updateSelectionBar(canSelect, filteredTracks) {
  const selectionBar = el('player-selection-bar');
  if (!selectionBar) return;

  const selectedIds = ensureSelectionSet();
  selectionBar.classList.toggle('hidden', !canSelect);
  if (!canSelect) {
    selectedIds.clear();
    return;
  }

  const visibleIds = filteredTracks.map(({ track }) => track.id);
  const selectedCount = selectedIds.size;
  const selectedVisibleCount = visibleIds.filter(id => selectedIds.has(id)).length;
  const selectAll = el('player-select-all');
  const status = el('player-selection-status');
  const addButton = el('player-selection-add-btn');
  const deleteButton = el('player-selection-delete-btn');
  const clearButton = el('player-selection-clear-btn');

  if (selectAll) {
    selectAll.disabled = visibleIds.length === 0;
    selectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  }
  if (status) {
    status.textContent = selectedCount
      ? `${selectedCount}곡 선택됨`
      : '';
  }
  if (addButton) {
    addButton.disabled = selectedCount === 0 || state.playlists.length === 0;
    addButton.title = state.playlists.length ? '' : '먼저 플레이리스트를 만들어 주세요.';
  }
  if (deleteButton) deleteButton.disabled = selectedCount === 0;
  if (clearButton) clearButton.disabled = selectedCount === 0;
}

function ensureThumbnailCache() {
  if (state.listCoverObjectUrls instanceof Map) return state.listCoverObjectUrls;
  state.listCoverObjectUrls = new Map();
  return state.listCoverObjectUrls;
}

function ensureThumbnailHydrationSet() {
  if (state.thumbnailHydrationTrackIds instanceof Set) return state.thumbnailHydrationTrackIds;
  state.thumbnailHydrationTrackIds = new Set(Array.isArray(state.thumbnailHydrationTrackIds) ? state.thumbnailHydrationTrackIds : []);
  return state.thumbnailHydrationTrackIds;
}

function trackThumbnailUrl(track) {
  if (!track?.cover?.data?.length) return '';

  const cache = ensureThumbnailCache();
  const key = `${track.id}:${track.cover.mime || 'image/jpeg'}:${track.cover.data.length}`;
  const cached = cache.get(track.id);
  if (cached?.key === key) return cached.url;

  if (cached?.url) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(new Blob([track.cover.data], { type: track.cover.mime || 'image/jpeg' }));
  cache.set(track.id, { key, url });
  return url;
}

function purgeUnusedThumbnailUrls(visibleTrackIds) {
  const cache = ensureThumbnailCache();
  for (const [trackId, cached] of cache.entries()) {
    if (visibleTrackIds.has(trackId)) continue;
    if (cached?.url) URL.revokeObjectURL(cached.url);
    cache.delete(trackId);
  }
}

function hydrateVisibleThumbnails(filteredTracks) {
  const hydrating = ensureThumbnailHydrationSet();
  const targets = filteredTracks
    .map(({ track }) => track)
    .filter(track => track && !track.metadataLoaded && !hydrating.has(track.id))
    .slice(0, 30);

  if (!targets.length) return;
  targets.forEach(track => hydrating.add(track.id));

  void Promise.all(targets.map(async track => {
    try {
      await ensureTrackMetadata(track);
    } catch {
      track.metadataLoaded = true;
    } finally {
      hydrating.delete(track.id);
    }
  })).then(() => {
    renderList();
  });
}

export function setCurrentArtwork(track) {
  const art = el('player-art');
  if (!art) return;
  const coverKey = `${track?.id || ''}:${track?.cover?.data?.length || 0}`;
  if (state.coverTrackId === coverKey) return;

  if (state.coverObjectUrl) {
    URL.revokeObjectURL(state.coverObjectUrl);
    state.coverObjectUrl = '';
  }
  state.coverTrackId = coverKey;
  art.innerHTML = '';
  art.classList.remove('has-cover');

  if (track?.cover?.data?.length) {
    state.coverObjectUrl = URL.createObjectURL(new Blob([track.cover.data], { type: track.cover.mime || 'image/jpeg' }));
    const img = document.createElement('img');
    img.src = state.coverObjectUrl;
    img.alt = '';
    art.appendChild(img);
    art.classList.add('has-cover');
  } else {
    art.textContent = '♪';
  }
}

export function setCurrentText(track) {
  setCurrentArtwork(track);
  setText('player-title', track ? track.title : '재생할 음악을 선택하세요');
  setText(
    'player-subtitle',
    track
      ? [metadataLine(track), track.fileName, formatBytes(track.size)].filter(Boolean).join(' · ')
      : '저장 폴더의 음악 파일이 이곳에 표시됩니다.'
  );

  const metadata = el('player-metadata');
  if (!metadata) return;
  metadata.innerHTML = '';
  const pairs = track ? metadataPairs(track) : [];
  metadata.classList.toggle('hidden', pairs.length === 0);
  pairs.forEach(([label, value]) => {
    const item = document.createElement('span');
    item.className = 'player-metadata-item';
    const key = document.createElement('strong');
    key.textContent = label;
    const text = document.createElement('span');
    text.textContent = value;
    item.append(key, text);
    metadata.appendChild(item);
  });
}

export function updateProgress() {
  const audio = el('audio-player');
  if (!audio) return;
  const track = currentTrack();
  const duration = displayDuration(track);
  const current = Math.min(displayCurrentTime(), duration || Number.MAX_SAFE_INTEGER);
  const seek = el('player-seek');
  if (!state.isSeeking && seek) {
    seek.value = duration ? String((current / duration) * 100) : '0';
  }
  setText('player-current-time', formatTime(current));
  setText('player-duration', formatTime(duration));

  const now = Date.now();
  if (track && !state.isSeeking && !state.isStreamSeeking && now - state.lastSavedPositionAt > 3000) {
    state.lastSavedPositionAt = now;
    savePlayerSettings({
      playerLastTrackId: track.id,
      playerLastTrackPath: track.path,
      playerLastPosition: Math.floor(current),
      playerLastDuration: duration || Number(track.streamInfo?.duration) || 0
    });
  }
}

export function updateControls() {
  const audio = el('audio-player');
  if (!audio) return;
  const hasTracks = state.queue.length > 0;
  const playBtn = el('player-play-btn');
  const prevBtn = el('player-prev-btn');
  const nextBtn = el('player-next-btn');
  const playerCard = document.querySelector('.player-card');
  const isPlaying = !audio.paused && hasTracks;
  if (playBtn) {
    playBtn.textContent = isPlaying ? 'Ⅱ' : '▶';
    playBtn.disabled = !hasTracks || state.isLoadingTrack;
  }
  if (prevBtn) prevBtn.disabled = !hasTracks || state.isLoadingTrack;
  if (nextBtn) nextBtn.disabled = !hasTracks || state.isLoadingTrack;
  if (playerCard) playerCard.classList.toggle('is-playing', isPlaying);
  if (!state.isStreamSeeking) {
    setText('player-status-pill', isPlaying ? '지금 재생 중' : (hasTracks ? '대기 중' : '목록 없음'));
  }
}

export function renderList() {
  const { list, empty, summary } = ensureListDom();
  if (!list) return;
  list.innerHTML = '';

  if (state.tracks.length && !state.queue.length) {
    rebuildQueue();
  }

  const playlist = activePlaylist();
  const sourceTracks = playlistSourceTracks();
  const visibleTracks = state.queue.length ? state.queue : sourceTracks;
  const query = state.searchQuery.trim().toLowerCase();
  const filteredTracks = visibleTracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      if (!query) return true;
      return [track.title, track.fileName]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  const canSelectTracks = !playlist && sourceTracks.length > 0;
  const selectedIds = ensureSelectionSet();
  const sourceIds = new Set(sourceTracks.map(track => track.id));
  [...selectedIds].forEach(trackId => {
    if (!canSelectTracks || !sourceIds.has(trackId)) selectedIds.delete(trackId);
  });
  updateSelectionBar(canSelectTracks, filteredTracks);
  purgeUnusedThumbnailUrls(new Set(filteredTracks.map(({ track }) => track.id)));
  hydrateVisibleThumbnails(filteredTracks);

  if (empty) {
    empty.classList.toggle('hidden', sourceTracks.length > 0 && filteredTracks.length > 0);
    empty.textContent = !state.tracks.length
      ? '현재 저장 위치에서 재생 가능한 음악 파일을 찾지 못했습니다.'
      : (sourceTracks.length ? '검색 결과가 없습니다.' : `${activePlaylistName()}에 등록된 음악이 없습니다.`);
  }
  if (summary) {
    const sortText = `${sortLabel()} · ${sortDirectionLabel()}`;
    const scopeText = playlist ? activePlaylistName() : '내 음악';
    summary.textContent = state.tracks.length
      ? (query ? `검색 결과 ${filteredTracks.length}개 · ${scopeText} ${sourceTracks.length}곡 · ${sortText}` : `${sourceTracks.length}곡 · ${sortText}`)
      : '음악 파일 0개';
  }

  filteredTracks.forEach(({ track, index }) => {
    const item = document.createElement('div');
    item.className = `player-track ${index === state.queuePosition ? 'active' : ''}`;
    const isSelected = selectedIds.has(track.id);
    item.classList.toggle('is-selectable', canSelectTracks);
    item.classList.toggle('is-selected', isSelected);
    item.dataset.index = String(index);
    item.dataset.trackId = track.id;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    item.tabIndex = 0;

    if (canSelectTracks) {
      const selectLabel = document.createElement('label');
      selectLabel.className = 'player-track-select';
      selectLabel.title = `${track.title || track.fileName} 선택`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isSelected;
      checkbox.dataset.playerAction = 'select-track';
      checkbox.dataset.trackId = track.id;
      checkbox.setAttribute('aria-label', `${track.title || track.fileName} 선택`);
      selectLabel.appendChild(checkbox);
      item.appendChild(selectLabel);
    }

    const thumbnail = document.createElement('span');
    thumbnail.className = 'player-track-thumbnail';
    const thumbnailUrl = trackThumbnailUrl(track);
    if (thumbnailUrl) {
      const img = document.createElement('img');
      img.src = thumbnailUrl;
      img.alt = '';
      thumbnail.appendChild(img);
      thumbnail.classList.add('has-image');
    } else {
      thumbnail.textContent = '♪';
    }

    const info = document.createElement('span');
    info.className = 'player-track-info';
    const title = document.createElement('span');
    title.className = 'player-track-title';
    title.textContent = track.title;
    const meta = document.createElement('span');
    meta.className = 'player-track-meta';
    meta.textContent = [metadataLine(track), track.fileName, formatBytes(track.size)].filter(Boolean).join(' · ');
    info.append(title, meta);

    const duration = document.createElement('span');
    duration.className = 'player-track-duration';
    duration.textContent = displayDuration(track)
      ? formatTime(displayDuration(track))
      : '';

    const action = document.createElement('span');
    action.className = 'player-track-action';
    action.textContent = index === state.queuePosition ? '재생 중' : '대기';

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'player-track-more';
    more.dataset.playerAction = 'menu';
    more.dataset.trackId = track.id;
    more.title = '더보기';
    more.setAttribute('aria-label', `${track.title || track.fileName} 더보기`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', state.openMenuTrackId === track.id ? 'true' : 'false');
    more.textContent = '⋮';

    item.append(thumbnail, info, duration, action, more);
    list.appendChild(item);
  });
}

export function render() {
  renderPlaylistDropdown();
  renderList();
  try { setCurrentText(currentTrack()); } catch {}
  try { updateProgress(); } catch {}
  try { updateControls(); } catch {}
}
