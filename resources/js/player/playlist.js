/**
 * resources/js/player/playlist.js
 * Playlist management backed by the shared player state.
 */

import { playerState as state } from './player-state.js';
import { el, render } from './player-ui.js';

let Toast = { show() {} };
let Settings = null;
let Neutralino = null;
let savePlayerSettings = () => {};
let sortTracks = list => [...list];
let clearAudioSource = () => {};
let currentTrack = () => null;
let hydrateTrackDurations = async () => {};
let joinPath = (base, child) => `${String(base || '').replace(/[\\/]+$/, '')}\\${String(child || '').replace(/^[\\/]+/, '')}`;
let directoryName = path => {
  const value = String(path || '');
  const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  return index >= 0 ? value.slice(0, index) : '';
};
let fileName = path => String(path || '').split(/[\\/]/).pop() || '';
let pathExists = async () => false;
let validateFileName = name => {
  const value = String(name || '');
  if (!value.trim()) return '파일 이름을 입력해 주세요.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(value)) return '파일 이름에 사용할 수 없는 문자가 포함되어 있습니다.';
  if (/[. ]$/.test(value)) return '파일 이름은 공백이나 점으로 끝날 수 없습니다.';
  if (value === '.' || value === '..') return '사용할 수 없는 파일 이름입니다.';
  const base = value.replace(/\.[^.]*$/, '').toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) return 'Windows 예약어는 파일 이름으로 사용할 수 없습니다.';
  return '';
};
let Dialog = {
  prompt: async () => null,
  confirm: async () => false
};

export function configurePlaylist(deps = {}) {
  Toast = deps.Toast || Toast;
  Settings = deps.Settings || Settings;
  Neutralino = deps.Neutralino || Neutralino;
  savePlayerSettings = deps.savePlayerSettings || savePlayerSettings;
  sortTracks = deps.sortTracks || sortTracks;
  clearAudioSource = deps.clearAudioSource || clearAudioSource;
  currentTrack = deps.currentTrack || currentTrack;
  hydrateTrackDurations = deps.hydrateTrackDurations || hydrateTrackDurations;
  joinPath = deps.joinPath || joinPath;
  directoryName = deps.directoryName || directoryName;
  fileName = deps.fileName || fileName;
  pathExists = deps.pathExists || pathExists;
  validateFileName = deps.validateFileName || validateFileName;
  Dialog = deps.Dialog || Dialog;
}

function normalizePlaylistName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validatePlaylistName(value, currentPlaylistId = '') {
  const nextName = normalizePlaylistName(value);
  if (!nextName) return '플레이리스트 이름을 입력해 주세요.';
  const invalidFolderName = validateFileName(nextName);
  if (invalidFolderName) return invalidFolderName.replace('파일 이름', '플레이리스트 이름');

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

function normalizePathKey(path) {
  return String(path || '').replace(/\//g, '\\').toLocaleLowerCase();
}

function samePath(a, b) {
  return normalizePathKey(a) === normalizePathKey(b);
}

function trackTitleFromFileName(name) {
  return String(name || '').replace(/\.[^.]+$/, '') || '제목 없음';
}

function audioRootPath() {
  const getter = Settings?.getActiveSavePath;
  return String(getter ? getter.call(Settings, 'audio') : '').trim();
}

function requireAudioRootPath() {
  const root = audioRootPath();
  if (!root) throw new Error('음악 저장 위치를 먼저 설정해 주세요.');
  return root;
}

function playlistFolderPath(playlist) {
  return joinPath(requireAudioRootPath(), normalizePlaylistName(playlist?.name));
}

async function ensureDirectory(path) {
  if (!Neutralino?.filesystem) throw new Error('파일 시스템을 사용할 수 없습니다.');
  if (await pathExists(path)) return;
  await Neutralino.filesystem.createDirectory(path);
}

async function ensurePlaylistFolder(playlist) {
  const folderPath = playlistFolderPath(playlist);
  await ensureDirectory(folderPath);
  return folderPath;
}

async function removeDirectoryIfEmpty(path) {
  if (!path || !(await pathExists(path))) return;
  try {
    const entries = await Neutralino.filesystem.readDirectory(path);
    if (Array.isArray(entries) && entries.length === 0) {
      await Neutralino.filesystem.remove(path);
    }
  } catch {
    // 폴더 안에 사용자가 둔 파일이 있거나 접근할 수 없으면 폴더를 남겨 둔다.
  }
}

function splitFileName(name) {
  const value = String(name || 'audio').trim() || 'audio';
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0) return { base: value, ext: '' };
  return { base: value.slice(0, dotIndex), ext: value.slice(dotIndex) };
}

async function uniqueDestinationPath(targetDir, preferredName, currentPath = '') {
  const safeName = fileName(preferredName) || fileName(currentPath) || 'audio';
  let candidate = joinPath(targetDir, safeName);
  if (samePath(candidate, currentPath) || !(await pathExists(candidate))) return candidate;

  const { base, ext } = splitFileName(safeName);
  for (let index = 2; index < 10000; index += 1) {
    candidate = joinPath(targetDir, `${base} (${index})${ext}`);
    if (samePath(candidate, currentPath) || !(await pathExists(candidate))) return candidate;
  }

  throw new Error('사용 가능한 파일 이름을 만들지 못했습니다.');
}

function idMatches(a, b) {
  return String(a || '').toLocaleLowerCase() === String(b || '').toLocaleLowerCase();
}

function updateSelectedTrackId(oldId, nextId) {
  if (!(state.selectedTrackIds instanceof Set) || idMatches(oldId, nextId)) return;
  if (state.selectedTrackIds.has(oldId)) {
    state.selectedTrackIds.delete(oldId);
    state.selectedTrackIds.add(nextId);
  }
}

function updateTrackCaches(oldId, nextId) {
  state.metadataPromises?.delete(oldId);
  state.streamInfoPromises?.delete(oldId);
  if (state.thumbnailHydrationTrackIds instanceof Set && state.thumbnailHydrationTrackIds.has(oldId)) {
    state.thumbnailHydrationTrackIds.delete(oldId);
    state.thumbnailHydrationTrackIds.add(nextId);
  }
  if (state.listCoverObjectUrls instanceof Map && state.listCoverObjectUrls.has(oldId)) {
    const cached = state.listCoverObjectUrls.get(oldId);
    state.listCoverObjectUrls.delete(oldId);
    state.listCoverObjectUrls.set(nextId, cached);
  }
  if (state.coverTrackId === oldId) state.coverTrackId = nextId;
  if (state.sourceTrackId === oldId) state.sourceTrackId = nextId;
}

function replaceTrackIdInPlaylists(oldId, nextId) {
  state.playlists = state.playlists.map(playlist => {
    const seen = new Set();
    const trackIds = playlist.trackIds
      .map(trackId => idMatches(trackId, oldId) ? nextId : trackId)
      .filter(trackId => {
        const key = String(trackId || '').toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return { ...playlist, trackIds };
  });
}

function updateTrackPathInState(oldId, nextPath) {
  const nextId = String(nextPath || '').toLocaleLowerCase();
  const nextFileName = fileName(nextPath);
  const nextExt = nextFileName.split('.').pop()?.toLocaleLowerCase() || '';
  const seenTracks = new Set();

  [...state.tracks, ...state.queue].forEach(track => {
    if (!track || !idMatches(track.id, oldId) || seenTracks.has(track)) return;
    seenTracks.add(track);
    const previousFileTitle = trackTitleFromFileName(track.fileName || fileName(track.path));
    const usesFileTitle = !track.metadataLoaded || !track.title || track.title === previousFileTitle;
    track.id = nextId;
    track.path = nextPath;
    track.fileName = nextFileName;
    track.ext = nextExt;
    if (usesFileTitle) track.title = trackTitleFromFileName(nextFileName);
  });

  updateTrackCaches(oldId, nextId);
  updateSelectedTrackId(oldId, nextId);
  replaceTrackIdInPlaylists(oldId, nextId);
  return nextId;
}

async function moveTrackToDirectory(track, targetDir) {
  const oldId = track.id;
  const sourcePath = track.path;
  const nextPath = await uniqueDestinationPath(targetDir, track.fileName || fileName(sourcePath), sourcePath);

  if (!samePath(sourcePath, nextPath)) {
    await Neutralino.filesystem.move(sourcePath, nextPath);
  }

  const nextId = idMatches(oldId, nextPath) ? oldId : updateTrackPathInState(oldId, nextPath);
  return { track, oldId, nextId, oldPath: sourcePath, nextPath };
}

async function moveTracksToDirectory(tracks, targetDir) {
  await ensureDirectory(targetDir);
  const moved = [];
  const failures = [];

  for (const track of tracks) {
    try {
      moved.push(await moveTrackToDirectory(track, targetDir));
    } catch (error) {
      failures.push({ track, error });
    }
  }

  return { moved, failures };
}

function trackIdsFromMoveResults(results) {
  const ids = [];
  const seen = new Set();
  results.forEach(result => {
    [result.oldId, result.nextId].forEach(trackId => {
      const key = String(trackId || '').toLocaleLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      ids.push(trackId);
    });
  });
  return ids;
}

function uniqueTrackIds(trackIds) {
  const seen = new Set();
  return trackIds.filter(trackId => {
    const key = String(trackId || '').toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeTrackIdsFromAllPlaylists(trackIds) {
  const removing = new Set(trackIds.map(trackId => String(trackId || '').toLocaleLowerCase()));
  state.playlists = state.playlists.map(playlist => ({
    ...playlist,
    trackIds: playlist.trackIds.filter(trackId => !removing.has(String(trackId || '').toLocaleLowerCase()))
  }));
}

function assignTrackIdsToPlaylist(playlistId, trackIds, movedTrackIds = trackIds) {
  const removing = new Set(movedTrackIds.map(trackId => String(trackId || '').toLocaleLowerCase()));
  const adding = uniqueTrackIds(trackIds);
  state.playlists = state.playlists.map(playlist => {
    const baseIds = playlist.trackIds.filter(trackId => !removing.has(String(trackId || '').toLocaleLowerCase()));
    if (playlist.id !== playlistId) return { ...playlist, trackIds: baseIds };
    return { ...playlist, trackIds: uniqueTrackIds([...baseIds, ...adding]) };
  });
}

function rebuildQueueFromSource(preserveTrackId = '', { keepUnselected = false } = {}) {
  state.queue = sortTracks(playlistSourceTracks());
  if (keepUnselected) {
    state.queuePosition = -1;
    return;
  }
  if (preserveTrackId) {
    state.queuePosition = state.queue.findIndex(track => idMatches(track.id, preserveTrackId));
  } else {
    state.queuePosition = state.queue.length ? 0 : -1;
  }
  if (state.queuePosition < 0 && state.queue.length) state.queuePosition = 0;
}

function anyTrackIsCurrent(tracks) {
  const current = currentTrack();
  return !!current && tracks.some(track => idMatches(track.id, current.id));
}

function playlistHadAnyTrack(playlistId, trackIds) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return false;
  const ids = new Set(trackIds.map(trackId => String(trackId || '').toLocaleLowerCase()));
  return playlist.trackIds.some(trackId => ids.has(String(trackId || '').toLocaleLowerCase()));
}

function isPathInsideDirectory(path, dir) {
  const pathKey = normalizePathKey(path);
  const dirKey = normalizePathKey(dir).replace(/[\\]+$/, '');
  return !!pathKey && !!dirKey && pathKey.startsWith(`${dirKey}\\`);
}

function relativePathFromDirectory(path, dir) {
  const normalizedPath = String(path || '').replace(/\//g, '\\');
  const normalizedDir = String(dir || '').replace(/\//g, '\\').replace(/[\\]+$/, '');
  if (!isPathInsideDirectory(normalizedPath, normalizedDir)) return fileName(path);
  return normalizedPath.slice(normalizedDir.length).replace(/^[\\]+/, '') || fileName(path);
}

async function renamePlaylistFolder(playlist, nextName, tracks) {
  const previousFolderPath = playlistFolderPath(playlist);
  const nextFolderPath = playlistFolderPath({ ...playlist, name: nextName });
  if (samePath(previousFolderPath, nextFolderPath)) return { moved: [], failures: [] };

  const previousFolderExists = await pathExists(previousFolderPath);
  const nextFolderExists = await pathExists(nextFolderPath);
  const movingCurrent = anyTrackIsCurrent(tracks);
  if (movingCurrent) resetPlaybackForPlaylistChange();

  if (previousFolderExists && nextFolderExists) {
    throw new Error('같은 이름의 폴더가 이미 있습니다.');
  }

  if (previousFolderExists) {
    await Neutralino.filesystem.move(previousFolderPath, nextFolderPath);
    const moved = [];
    tracks.forEach(track => {
      if (!isPathInsideDirectory(track.path, previousFolderPath)) return;
      const oldId = track.id;
      const oldPath = track.path;
      const nextPath = joinPath(nextFolderPath, relativePathFromDirectory(track.path, previousFolderPath));
      const nextId = updateTrackPathInState(oldId, nextPath);
      moved.push({ track, oldId, nextId, oldPath, nextPath });
    });

    const outsideTracks = tracks.filter(track => !isPathInsideDirectory(track.path, nextFolderPath));
    if (!outsideTracks.length) return { moved, failures: [] };

    const extraMove = await moveTracksToDirectory(outsideTracks, nextFolderPath);
    return { moved: [...moved, ...extraMove.moved], failures: extraMove.failures };
  }

  const result = await moveTracksToDirectory(tracks, nextFolderPath);
  return result;
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
  const tracks = tracksByIds(playlist.trackIds);
  const movingCurrent = anyTrackIsCurrent(tracks);
  const preserveId = movingCurrent ? '' : currentTrack()?.id || '';

  try {
    const result = await renamePlaylistFolder(playlist, nextName, tracks);
    if (result.failures?.length) {
      Toast.show(`폴더 이름은 변경했지만 ${result.failures.length}곡을 이동하지 못했습니다.`, 'error', 7000);
    }

    state.playlists = state.playlists.map(item =>
      item.id === playlistId ? { ...item, name: nextName } : item
    );

    if (state.activePlaylistId !== 'all') {
      rebuildQueueFromSource(preserveId, { keepUnselected: movingCurrent || !preserveId });
    } else if (movingCurrent) {
      rebuildQueueFromSource('', { keepUnselected: true });
    } else {
      rebuildQueueFromSource(preserveId, { keepUnselected: !preserveId });
    }
    closePlaylistActionMenus();
    renderPlaylistDropdown();
    render();
    savePlaylists();
    Toast.show(`“${previousName}”을(를) “${nextName}”으로 변경했습니다.`, 'success', 4000);
  } catch (error) {
    Toast.show(`플레이리스트 이름을 변경하지 못했습니다: ${error.message || error}`, 'error', 7000);
  }
}

export async function deletePlaylist(playlistId) {
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist) return;

  const confirmed = await Dialog.confirm({
    title: '플레이리스트 삭제',
    message: `“${playlist.name}” 플레이리스트를 삭제할까요?`,
    detail: '플레이리스트 폴더의 음악 파일은 삭제하지 않고 음악 루트 폴더로 옮깁니다.',
    confirmText: '삭제',
    danger: true
  });
  if (!confirmed) return;

  const deletingActivePlaylist = state.activePlaylistId === playlistId;
  const tracks = tracksByIds(playlist.trackIds);
  const movingCurrent = anyTrackIsCurrent(tracks);
  const preserveId = movingCurrent ? '' : currentTrack()?.id || '';

  try {
    if (deletingActivePlaylist || movingCurrent) resetPlaybackForPlaylistChange();

    const rootPath = requireAudioRootPath();
    const result = await moveTracksToDirectory(tracks, rootPath);
    const movedIds = trackIdsFromMoveResults(result.moved);

    if (result.failures.length) {
      if (movedIds.length) {
        removeTrackIdsFromAllPlaylists(movedIds);
      }
      if (deletingActivePlaylist) {
        state.activePlaylistId = 'all';
        state.searchQuery = '';
        const search = el('player-search');
        if (search) search.value = '';
        rebuildQueueFromSource('', { keepUnselected: true });
      } else if (movingCurrent) {
        rebuildQueueFromSource('', { keepUnselected: true });
      } else {
        rebuildQueueFromSource(preserveId, { keepUnselected: !preserveId });
      }
      closePlaylistActionMenus();
      renderPlaylistDropdown();
      render();
      savePlaylists();
      Toast.show(`${result.failures.length}곡을 루트 폴더로 옮기지 못해 플레이리스트 삭제를 중단했습니다.`, 'error', 7000);
      return;
    }

    removeTrackIdsFromAllPlaylists([...playlist.trackIds, ...movedIds]);
    state.playlists = state.playlists.filter(item => item.id !== playlistId);
    await removeDirectoryIfEmpty(playlistFolderPath(playlist));
    if (deletingActivePlaylist) {
      state.activePlaylistId = 'all';
      state.searchQuery = '';
      const search = el('player-search');
      if (search) search.value = '';
      rebuildQueueFromSource('', { keepUnselected: true });
    } else if (state.activePlaylistId !== 'all') {
      rebuildQueueFromSource(preserveId, { keepUnselected: !preserveId });
    } else if (movingCurrent) {
      rebuildQueueFromSource('', { keepUnselected: true });
    } else {
      rebuildQueueFromSource(preserveId, { keepUnselected: !preserveId });
    }

    closePlaylistActionMenus();
    renderPlaylistDropdown();
    render();
    savePlaylists();
    Toast.show(`“${playlist.name}” 플레이리스트를 삭제하고 음악 파일을 루트 폴더로 옮겼습니다.`, 'success', 4500);
  } catch (error) {
    Toast.show(`플레이리스트를 삭제하지 못했습니다: ${error.message || error}`, 'error', 7000);
  }
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
  try {
    await ensurePlaylistFolder(playlist);
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
    Toast.show(`${name} 플레이리스트와 폴더를 만들었습니다.`, 'success', 4000);
  } catch (error) {
    Toast.show(`플레이리스트 폴더를 만들지 못했습니다: ${error.message || error}`, 'error', 7000);
  }
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

export async function addKnownTrackIdsToPlaylist(trackIds, playlistId, { silent = false } = {}) {
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
  const activePlaylistWasSource = state.activePlaylistId !== 'all'
    && state.activePlaylistId !== playlist.id
    && playlistHadAnyTrack(state.activePlaylistId, tracks.map(track => track.id));
  const wasQueueEmpty = activePlaylistUpdated && state.queue.length === 0;
  const wasTrackSelected = activePlaylistUpdated && state.queuePosition >= 0 && !!currentTrack();
  const addableTracks = tracks.filter(track => playlistAddableTrackIds(playlist, [track]).length > 0);
  if (!addableTracks.length) {
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

  const movingCurrent = anyTrackIsCurrent(addableTracks);
  const preserveId = movingCurrent ? '' : currentTrack()?.id || '';

  try {
    if (movingCurrent) resetPlaybackForPlaylistChange();
    const targetDir = await ensurePlaylistFolder(playlist);
    const result = await moveTracksToDirectory(addableTracks, targetDir);
    const addedTrackIds = uniqueTrackIds(result.moved.map(item => item.nextId));
    const movedTrackIds = trackIdsFromMoveResults(result.moved);

    if (!addedTrackIds.length) {
      if (!silent) {
        Toast.show(
          result.failures.length
            ? `${result.failures.length}곡을 플레이리스트 폴더로 옮기지 못했습니다.`
            : '플레이리스트에 추가할 곡이 없습니다.',
          result.failures.length ? 'error' : 'info',
          6000
        );
      }
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

    assignTrackIdsToPlaylist(playlist.id, addedTrackIds, movedTrackIds);
    savePlaylists();
    renderPlaylistDropdown();
    if (activePlaylistUpdated) {
      rebuildQueueFromSource(preserveId || addedTrackIds[0], { keepUnselected: movingCurrent });
    } else if (activePlaylistWasSource || (state.activePlaylistId !== 'all' && movingCurrent)) {
      rebuildQueueFromSource(preserveId, { keepUnselected: movingCurrent || !preserveId });
    } else if (state.activePlaylistId === 'all') {
      if (movingCurrent) rebuildQueueFromSource('', { keepUnselected: true });
      else rebuildQueueFromSource(preserveId, { keepUnselected: !preserveId });
    }
    render();

    if (!silent) {
      Toast.show(
        addedTrackIds.length === 1
          ? `${playlist.name}에 추가하고 폴더로 옮겼습니다.`
          : `${playlist.name}에 ${addedTrackIds.length}곡을 추가하고 폴더로 옮겼습니다.`,
        'success',
        4000
      );
    }

    if (result.failures.length && !silent) {
      Toast.show(`${result.failures.length}곡은 파일 이동에 실패했습니다.`, 'error', 7000);
    }

    return {
      addedCount: addedTrackIds.length,
      addedTrackIds,
      playlistId: playlist.id,
      playlistName: playlist.name,
      activePlaylistUpdated,
      wasQueueEmpty,
      wasTrackSelected: movingCurrent ? false : wasTrackSelected
    };
  } catch (error) {
    if (!silent) Toast.show(`플레이리스트에 추가하지 못했습니다: ${error.message || error}`, 'error', 7000);
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

  return await addKnownTrackIdsToPlaylist(addableTrackIds, playlist.id);
}

export async function addTrackToPlaylist(trackId) {
  return addTracksToPlaylist([trackId]);
}

export async function removeTrackFromActivePlaylist(trackId) {
  const playlist = activePlaylist();
  if (!playlist) return;
  const track = tracksByIds([trackId])[0];
  const before = playlist.trackIds.length;
  if (!playlist.trackIds.some(id => idMatches(id, trackId))) return;

  try {
    const movingCurrent = !!track && anyTrackIsCurrent([track]);
    const preserveId = movingCurrent ? '' : currentTrack()?.id || '';
    if (movingCurrent) resetPlaybackForPlaylistChange();

    let movedIds = [trackId];
    if (track) {
      const rootPath = requireAudioRootPath();
      const result = await moveTracksToDirectory([track], rootPath);
      if (result.failures.length) {
        Toast.show('음악 파일을 루트 폴더로 옮기지 못해 플레이리스트에서 제거하지 않았습니다.', 'error', 7000);
        return;
      }
      movedIds = trackIdsFromMoveResults(result.moved);
    }

    removeTrackIdsFromAllPlaylists(movedIds);
    const afterPlaylist = state.playlists.find(item => item.id === playlist.id);
    if (!afterPlaylist || afterPlaylist.trackIds.length === before) return;

    rebuildQueueFromSource(preserveId, { keepUnselected: movingCurrent || !preserveId });
    renderPlaylistDropdown();
    render();
    savePlaylists();
    Toast.show(`${playlist.name}에서 제거하고 음악 파일을 루트 폴더로 옮겼습니다.`, 'success', 4500);
  } catch (error) {
    Toast.show(`플레이리스트에서 제거하지 못했습니다: ${error.message || error}`, 'error', 7000);
  }
}
