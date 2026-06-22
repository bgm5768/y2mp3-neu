/**
 * resources/js/player/playlist.js
 * Playlist management backed by the shared player state.
 */

import { playerState as state } from './player-state.js';
import { el, render } from './player-ui.js';

let Toast = { show() {} };
let savePlayerSettings = () => {};
let sortTracks = list => [...list];
let clearAudioSource = () => {};
let currentTrack = () => null;
let rebuildQueue = () => {};
let hydrateTrackDurations = async () => {};

export function configurePlaylist(deps = {}) {
  Toast = deps.Toast || Toast;
  savePlayerSettings = deps.savePlayerSettings || savePlayerSettings;
  sortTracks = deps.sortTracks || sortTracks;
  clearAudioSource = deps.clearAudioSource || clearAudioSource;
  currentTrack = deps.currentTrack || currentTrack;
  rebuildQueue = deps.rebuildQueue || rebuildQueue;
  hydrateTrackDurations = deps.hydrateTrackDurations || hydrateTrackDurations;
}

function normalizePlaylistName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function createPlaylistId() {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizePlaylists(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  return value
    .map(playlist => {
      const name = normalizePlaylistName(playlist?.name);
      const id = String(playlist?.id || '').trim() || createPlaylistId();
      const trackIds = Array.isArray(playlist?.trackIds)
        ? [...new Set(playlist.trackIds.map(trackId => String(trackId || '').toLowerCase()).filter(Boolean))]
        : [];
      return { id, name, trackIds };
    })
    .filter(playlist => {
      const key = playlist.name.toLocaleLowerCase();
      if (!playlist.name || playlist.id === 'all' || seenIds.has(playlist.id) || seenNames.has(key)) return false;
      seenIds.add(playlist.id);
      seenNames.add(key);
      return true;
    });
}

export function activePlaylist() {
  if (state.activePlaylistId === 'all') return null;
  return state.playlists.find(playlist => playlist.id === state.activePlaylistId) || null;
}

export function activePlaylistName() {
  return activePlaylist()?.name || '내 음악';
}

export function playlistSourceTracks() {
  const playlist = activePlaylist();
  if (!playlist) return state.tracks;
  const ids = new Set(playlist.trackIds);
  return state.tracks.filter(track => ids.has(track.id));
}

export function savePlaylists(extraPatch = {}) {
  savePlayerSettings({
    playerPlaylists: state.playlists,
    playerActivePlaylistId: state.activePlaylistId,
    ...extraPatch
  }, { immediate: true });
}

export function trimMissingPlaylistTracks() {
  const existing = new Set(state.tracks.map(track => track.id));
  let changed = false;
  state.playlists = state.playlists.map(playlist => {
    const nextTrackIds = playlist.trackIds.filter(trackId => existing.has(trackId));
    if (nextTrackIds.length !== playlist.trackIds.length) changed = true;
    return changed ? { ...playlist, trackIds: nextTrackIds } : playlist;
  });
  if (state.activePlaylistId !== 'all' && !state.playlists.some(playlist => playlist.id === state.activePlaylistId)) {
    state.activePlaylistId = 'all';
    changed = true;
  }
  if (changed) savePlaylists();
}
function closePlaylistActionMenus(exceptPlaylistId = '') {
  const menu = el('player-playlist-menu');
  if (!menu) return;

  menu.querySelectorAll('[data-playlist-action-menu]').forEach(actionMenu => {
    const playlistId = actionMenu.dataset.playlistActionMenu || '';
    const shouldKeepOpen = exceptPlaylistId && playlistId === exceptPlaylistId;
    actionMenu.classList.toggle('hidden', !shouldKeepOpen);

    const moreButton = menu.querySelector(
      `button[data-playlist-action="toggle-actions"][data-playlist-id="${CSS.escape(playlistId)}"]`
    );
    moreButton?.setAttribute('aria-expanded', shouldKeepOpen ? 'true' : 'false');
  });
}

export function closePlaylistMenu() {
  closePlaylistActionMenus();
  el('player-playlist-menu')?.classList.add('hidden');
  el('player-playlist-btn')?.setAttribute('aria-expanded', 'false');
}

export function togglePlaylistMenu() {
  const menu = el('player-playlist-menu');
  const button = el('player-playlist-btn');
  if (!menu || !button) return;
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

export function renderPlaylistDropdown() {
  const button = el('player-playlist-btn');
  const menu = el('player-playlist-menu');
  if (!button || !menu) return;

  button.innerHTML = '';
  const buttonLabel = document.createElement('span');
  buttonLabel.className = 'player-playlist-btn-label';
  buttonLabel.textContent = activePlaylistName();
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '⌄';
  button.append(buttonLabel, arrow);

  menu.innerHTML = '';

  const options = [
    { id: 'all', name: '내 음악', count: state.tracks.length },
    ...state.playlists.map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      count: playlist.trackIds.length
    }))
  ];

  options.forEach(option => {
    const row = document.createElement('div');
    row.className = `player-playlist-row ${state.activePlaylistId === option.id ? 'active' : ''}`;
    row.dataset.playlistId = option.id;

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'player-playlist-item';
    selectButton.dataset.playlistAction = 'select';
    selectButton.dataset.playlistId = option.id;
    selectButton.setAttribute('role', 'menuitemradio');
    selectButton.setAttribute('aria-checked', state.activePlaylistId === option.id ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'player-playlist-name';
    name.textContent = option.name;

    const meta = document.createElement('span');
    meta.className = 'player-playlist-count';
    meta.textContent = `${option.count}곡`;

    const check = document.createElement('span');
    check.className = 'player-playlist-check';
    check.textContent = state.activePlaylistId === option.id ? '✓' : '';

    selectButton.append(name, meta, check);
    row.appendChild(selectButton);

    // 기본 목록인 "내 음악"은 이름 변경 및 삭제 대상에서 제외합니다.
    if (option.id !== 'all') {
      const actions = document.createElement('div');
      actions.className = 'player-playlist-actions';

      const moreButton = document.createElement('button');
      moreButton.type = 'button';
      moreButton.className = 'player-playlist-more';
      moreButton.dataset.playlistAction = 'toggle-actions';
      moreButton.dataset.playlistId = option.id;
      moreButton.setAttribute('aria-label', `${option.name} 관리`);
      moreButton.setAttribute('aria-haspopup', 'menu');
      moreButton.setAttribute('aria-expanded', 'false');
      moreButton.textContent = '⋯';

      const actionMenu = document.createElement('div');
      actionMenu.className = 'player-playlist-action-menu hidden';
      actionMenu.dataset.playlistActionMenu = option.id;
      actionMenu.setAttribute('role', 'menu');

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'player-playlist-action-item';
      renameButton.dataset.playlistAction = 'rename';
      renameButton.dataset.playlistId = option.id;
      renameButton.setAttribute('role', 'menuitem');
      renameButton.textContent = '이름 변경';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'player-playlist-action-item danger';
      deleteButton.dataset.playlistAction = 'delete';
      deleteButton.dataset.playlistId = option.id;
      deleteButton.setAttribute('role', 'menuitem');
      deleteButton.textContent = '삭제';

      actionMenu.append(renameButton, deleteButton);
      actions.append(moreButton, actionMenu);
      row.appendChild(actions);
    }

    menu.appendChild(row);
  });

  const divider = document.createElement('div');
  divider.className = 'player-playlist-divider';
  menu.appendChild(divider);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'player-playlist-item create';
  add.dataset.playlistAction = 'create';
  add.setAttribute('role', 'menuitem');
  add.textContent = '+ 새 플레이리스트';
  menu.appendChild(add);
}

export function togglePlaylistActionMenu(playlistId) {
  const menu = el('player-playlist-menu');
  if (!menu) return;

  const actionMenu = [...menu.querySelectorAll('[data-playlist-action-menu]')]
    .find(node => node.dataset.playlistActionMenu === playlistId);
  if (!actionMenu) return;

  const willOpen = actionMenu.classList.contains('hidden');
  closePlaylistActionMenus(willOpen ? playlistId : '');
}

export function renamePlaylist(playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const input = window.prompt('새 플레이리스트 이름을 입력하세요.', playlist.name);
  if (input === null) return;

  const nextName = normalizePlaylistName(input);
  if (!nextName) {
    Toast.show('플레이리스트 이름을 입력해 주세요.', 'warning', 4000);
    return;
  }

  const duplicated = state.playlists.some(item =>
    item.id !== playlistId &&
    item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase()
  );

  if (duplicated || nextName.toLocaleLowerCase() === '내 음악'.toLocaleLowerCase()) {
    Toast.show('같은 이름의 플레이리스트가 이미 있습니다.', 'error', 5000);
    return;
  }

  if (playlist.name === nextName) {
    closePlaylistActionMenus();
    return;
  }

  const previousName = playlist.name;
  state.playlists = state.playlists.map(item =>
    item.id === playlistId ? { ...item, name: nextName } : item
  );

  renderPlaylistDropdown();
  render();
  savePlaylists();
  Toast.show(`“${previousName}”을(를) “${nextName}”으로 변경했습니다.`, 'success', 4000);
}

export function deletePlaylist(playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const confirmed = window.confirm(
    `“${playlist.name}” 플레이리스트를 삭제할까요?\n\n플레이리스트만 삭제되며 음악 파일은 삭제되지 않습니다.`
  );
  if (!confirmed) return;

  const deletingActivePlaylist = state.activePlaylistId === playlistId;
  const currentId = currentTrack()?.id || '';

  state.playlists = state.playlists.filter(item => item.id !== playlistId);
  if (deletingActivePlaylist) {
    resetPlaybackForPlaylistChange();
    state.activePlaylistId = 'all';
    state.searchQuery = '';
    const search = el('player-search');
    if (search) search.value = '';
    state.queue = sortTracks(playlistSourceTracks());
    state.queuePosition = -1;
  }

  closePlaylistActionMenus();
  renderPlaylistDropdown();
  render();
  savePlaylists();
  Toast.show(`“${playlist.name}” 플레이리스트를 삭제했습니다.`, 'success', 4000);
}

function resetPlaybackForPlaylistChange() {
  // 진행 중인 비동기 곡 로드를 무효화한다.
  state.trackLoadToken += 1;

  const audio = el('audio-player');
  if (audio) clearAudioSource(audio);

  state.queuePosition = -1;
  state.isLoadingTrack = false;
  state.isSeeking = false;
  state.isStreamSeeking = false;
  state.seekPreviewTime = null;
  state.restoredPreviewTime = null;
  state.restoringPosition = null;

  savePlayerSettings({
    playerLastTrackId: '',
    playerLastTrackPath: '',
    playerLastPosition: 0,
    playerLastDuration: 0
  }, { immediate: true });
}

export function setActivePlaylist(playlistId) {
  const nextId = playlistId === 'all' || state.playlists.some(playlist => playlist.id === playlistId)
    ? playlistId
    : 'all';

  // 같은 플레이리스트를 다시 선택한 경우에는 재생을 끊지 않는다.
  if (nextId === state.activePlaylistId) {
    closePlaylistMenu();
    return;
  }

  resetPlaybackForPlaylistChange();
  state.activePlaylistId = nextId;
  state.searchQuery = '';

  const search = el('player-search');
  if (search) search.value = '';

  state.queue = sortTracks(playlistSourceTracks());
  state.queuePosition = -1;

  closePlaylistMenu();
  renderPlaylistDropdown();
  render();
  savePlaylists();
  if (state.sortKey === 'duration') void hydrateTrackDurations();
}

export function createPlaylist() {
  const name = normalizePlaylistName(window.prompt('새 플레이리스트 이름을 입력하세요.', '새 플레이리스트'));
  if (!name) return;
  const exists = state.playlists.some(playlist => playlist.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (exists || name === '내 음악') {
    Toast.show('같은 이름의 플레이리스트가 이미 있습니다.', 'error', 5000);
    return;
  }

  const playlist = { id: createPlaylistId(), name, trackIds: [] };
  resetPlaybackForPlaylistChange();
  state.playlists = [...state.playlists, playlist];
  state.activePlaylistId = playlist.id;
  state.searchQuery = '';
  const search = el('player-search');
  if (search) search.value = '';
  state.queue = sortTracks(playlistSourceTracks());
  state.queuePosition = -1;
  closePlaylistMenu();
  renderPlaylistDropdown();
  render();
  savePlaylists();
  Toast.show(`${name} 플레이리스트를 만들었습니다.`, 'success', 4000);
}
function playlistPromptLabel() {
  return state.playlists
    .map((playlist, index) => `${index + 1}. ${playlist.name}`)
    .join('\n');
}

function findPlaylistByInput(input) {
  const value = normalizePlaylistName(input);
  if (!value) return null;
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= state.playlists.length) {
    return state.playlists[index - 1];
  }
  return state.playlists.find(playlist => playlist.name.toLocaleLowerCase() === value.toLocaleLowerCase()) || null;
}

export async function addTrackToPlaylist(trackId) {
  const track = [...state.tracks, ...state.queue].find(item => item.id === trackId);
  if (!track) return;
  if (!state.playlists.length) {
    Toast.show('먼저 플레이리스트를 만들어 주세요.', 'warning', 5000);
    return;
  }

  const defaultName = activePlaylist()?.name || state.playlists[0].name;
  const input = window.prompt(`추가할 플레이리스트 번호 또는 이름을 입력하세요.\n\n${playlistPromptLabel()}`, defaultName);
  if (input === null) return;

  const playlist = findPlaylistByInput(input);
  if (!playlist) {
    Toast.show('플레이리스트를 찾지 못했습니다.', 'error', 5000);
    return;
  }
  if (playlist.trackIds.includes(track.id)) {
    Toast.show('이미 해당 플레이리스트에 있는 곡입니다.', 'info', 4000);
    return;
  }

  state.playlists = state.playlists.map(item => item.id === playlist.id
    ? { ...item, trackIds: [...item.trackIds, track.id] }
    : item);
  savePlaylists();
  renderPlaylistDropdown();
  if (state.activePlaylistId === playlist.id) {
    rebuildQueue(currentTrack()?.id || track.id);
    render();
  }
  Toast.show(`${playlist.name}에 추가했습니다.`, 'success', 4000);
}

export function removeTrackFromActivePlaylist(trackId) {
  const playlist = activePlaylist();
  if (!playlist) return;
  const before = playlist.trackIds.length;
  state.playlists = state.playlists.map(item => item.id === playlist.id
    ? { ...item, trackIds: item.trackIds.filter(id => id !== trackId) }
    : item);
  const afterPlaylist = state.playlists.find(item => item.id === playlist.id);
  if (!afterPlaylist || afterPlaylist.trackIds.length === before) return;

  const currentId = currentTrack()?.id || '';
  rebuildQueue(currentId === trackId ? '' : currentId);
  renderPlaylistDropdown();
  render();
  savePlaylists();
  Toast.show(`${playlist.name}에서 제거했습니다. 실제 음악 파일은 유지됩니다.`, 'success', 4500);
}
