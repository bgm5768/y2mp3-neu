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

  return {
    list: el('player-list'),
    empty: el('player-empty'),
    summary: el('player-summary')
  };
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
    item.dataset.index = String(index);
    item.dataset.trackId = track.id;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const number = document.createElement('span');
    number.className = 'player-track-number';
    number.textContent = String(index + 1).padStart(2, '0');

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

    item.append(number, info, duration, action, more);
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
