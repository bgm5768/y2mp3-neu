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
let Dialog = {
  prompt: async () => null,
  confirm: async () => false
};

export function configurePlaylist(deps = {}) {
  Toast = deps.Toast || Toast;
  savePlayerSettings = deps.savePlayerSettings || savePlayerSettings;
  sortTracks = deps.sortTracks || sortTracks;
  clearAudioSource = deps.clearAudioSource || clearAudioSource;
  currentTrack = deps.currentTrack || currentTrack;
  rebuildQueue = deps.rebuildQueue || rebuildQueue;
  hydrateTrackDurations = deps.hydrateTrackDurations || hydrateTrackDurations;
  Dialog = deps.Dialog || Dialog;
}

function normalizePlaylistName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validatePlaylistName(value, currentPlaylistId = '') {
  const nextName = normalizePlaylistName(value);
  if (!nextName) return '플레이리스트 이름을 입력해 주세요.';

  const duplicated = state.playlists.some(item =>
    item.id !== currentPlaylistId &&
    item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase()
  );

  if (duplicated || nextName.toLocaleLowerCase() === '내 음악'.toLocaleLowerCase()) {
    return '같은 이름의 플레이리스트가 이미 있습니다.';
  }

  return { value: nextName };
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

export async function renamePlaylist(playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const input = await Dialog.prompt({
    title: '플레이리스트 이름 변경',
    message: '새 이름을 입력하면 목록과 드롭다운에 바로 반영됩니다.',
    label: '플레이리스트 이름',
    value: playlist.name,
    confirmText: '변경',
    validate: value => validatePlaylistName(value, playlistId)
  });
  if (input === null) return;

  const nextName = normalizePlaylistName(input);

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

export async function deletePlaylist(playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const confirmed = await Dialog.confirm({
    title: '플레이리스트 삭제',
    message: `“${playlist.name}” 플레이리스트를 삭제할까요?`,
    detail: '플레이리스트만 삭제되며 음악 파일은 삭제되지 않습니다.',
    confirmText: '삭제',
    danger: true
  });
  if (!confirmed) return;

  const deletingActivePlaylist = state.activePlaylistId === playlistId;

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

export async function createPlaylist() {
  const input = await Dialog.prompt({
    title: '새 플레이리스트',
    message: '새 플레이리스트를 만들고 바로 선택합니다.',
    label: '플레이리스트 이름',
    value: '새 플레이리스트',
    confirmText: '만들기',
    validate: value => validatePlaylistName(value)
  });
  if (input === null) return;

  const name = normalizePlaylistName(input);

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
function tracksByIds(trackIds) {
  const trackMap = new Map([...state.tracks, ...state.queue].map(track => [track.id, track]));
  const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
  const seen = new Set();
  return ids
    .map(trackId => trackMap.get(trackId))
    .filter(track => {
      if (!track || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
}

function selectedTracksDetail(tracks) {
  const shown = tracks
    .slice(0, 6)
    .map(track => `- ${track.title || track.fileName || '제목 없음'}`);
  if (tracks.length > shown.length) shown.push(`외 ${tracks.length - shown.length}곡`);
  return shown.join('\n');
}

function playlistAddableTrackIds(playlist, tracks) {
  const existing = new Set(playlist.trackIds);
  return tracks.map(track => track.id).filter(trackId => !existing.has(trackId));
}

export function addKnownTrackIdsToPlaylist(trackIds, playlistId, { silent = false } = {}) {
  const tracks = tracksByIds(trackIds);
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist || !tracks.length) {
    return {
      addedCount: 0,
      addedTrackIds: [],
      playlistId: playlist?.id || '',
      playlistName: playlist?.name || '',
      activePlaylistUpdated: false,
      wasQueueEmpty: false,
      wasTrackSelected: false
    };
  }

  const activePlaylistUpdated = state.activePlaylistId === playlist.id;
  const wasQueueEmpty = activePlaylistUpdated && state.queue.length === 0;
  const wasTrackSelected = activePlaylistUpdated && state.queuePosition >= 0 && !!currentTrack();
  const addableTrackIds = playlistAddableTrackIds(playlist, tracks);
  if (!addableTrackIds.length) {
    if (!silent) Toast.show('선택한 곡이 모두 해당 플레이리스트에 이미 있습니다.', 'info', 4000);
    return {
      addedCount: 0,
      addedTrackIds: [],
      playlistId: playlist.id,
      playlistName: playlist.name,
      activePlaylistUpdated,
      wasQueueEmpty,
      wasTrackSelected
    };
  }

  state.playlists = state.playlists.map(item => item.id === playlist.id
    ? { ...item, trackIds: [...item.trackIds, ...addableTrackIds] }
    : item);
  savePlaylists();
  renderPlaylistDropdown();
  if (activePlaylistUpdated) {
    rebuildQueue(currentTrack()?.id || addableTrackIds[0]);
    render();
  }

  if (!silent) {
    Toast.show(
      addableTrackIds.length === 1
        ? `${playlist.name}에 추가했습니다.`
        : `${playlist.name}에 ${addableTrackIds.length}곡을 추가했습니다.`,
      'success',
      4000
    );
  }

  return {
    addedCount: addableTrackIds.length,
    addedTrackIds: addableTrackIds,
    playlistId: playlist.id,
    playlistName: playlist.name,
    activePlaylistUpdated,
    wasQueueEmpty,
    wasTrackSelected
  };
}

export async function addTracksToPlaylist(trackIds) {
  const tracks = tracksByIds(trackIds);
  if (!tracks.length) return { addedCount: 0 };
  if (!state.playlists.length) {
    Toast.show('먼저 플레이리스트를 만들어 주세요.', 'warning', 5000);
    return { addedCount: 0 };
  }

  const defaultPlaylist = state.playlists.find(playlist => playlistAddableTrackIds(playlist, tracks).length > 0)
    || activePlaylist()
    || state.playlists[0];
  const selectedPlaylistId = await Dialog.select({
    title: '플레이리스트에 추가',
    message: tracks.length === 1
      ? `“${tracks[0].title || tracks[0].fileName}”을(를) 추가할 플레이리스트를 선택하세요.`
      : `${tracks.length}곡을 추가할 플레이리스트를 선택하세요.`,
    label: '플레이리스트',
    value: defaultPlaylist?.id || '',
    options: state.playlists.map(playlist => ({
      value: playlist.id,
      label: `${playlist.name} (${playlist.trackIds.length}곡)`
    })),
    detail: selectedTracksDetail(tracks),
    confirmText: '추가',
    validate: value => {
      const playlist = state.playlists.find(item => item.id === value);
      if (!playlist) return '플레이리스트를 찾지 못했습니다.';
      if (!playlistAddableTrackIds(playlist, tracks).length) {
        return tracks.length === 1
          ? '이미 해당 플레이리스트에 있는 곡입니다.'
          : '선택한 곡이 모두 해당 플레이리스트에 이미 있습니다.';
      }
      return { value: playlist.id };
    }
  });
  if (selectedPlaylistId === null) return { addedCount: 0 };

  const playlist = state.playlists.find(item => item.id === selectedPlaylistId);
  if (!playlist) {
    Toast.show('플레이리스트를 찾지 못했습니다.', 'error', 5000);
    return { addedCount: 0 };
  }

  const addableTrackIds = playlistAddableTrackIds(playlist, tracks);
  if (!addableTrackIds.length) {
    Toast.show(
      tracks.length === 1
        ? '이미 해당 플레이리스트에 있는 곡입니다.'
        : '선택한 곡이 모두 해당 플레이리스트에 이미 있습니다.',
      'info',
      4000
    );
    return { addedCount: 0, playlistId: playlist.id };
  }

  return addKnownTrackIdsToPlaylist(addableTrackIds, playlist.id);
}

export async function addTrackToPlaylist(trackId) {
  return addTracksToPlaylist([trackId]);
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
