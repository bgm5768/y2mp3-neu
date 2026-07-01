/**
 * resources/js/player/player.js
 * Music player orchestration.
 */

import { playerState as state } from './player-state.js';
import {
  configurePlayerUi,
  el,
  setText,
  setPlayerLoading,
  ensureListDom,
  setCurrentText,
  updateProgress,
  updateControls,
  renderList,
  render
} from './player-ui.js';
import {
  configurePlaylist,
  sanitizePlaylists,
  activePlaylist,
  activePlaylistName,
  playlistSourceTracks,
  savePlaylists,
  trimMissingPlaylistTracks,
  closePlaylistMenu,
  togglePlaylistMenu,
  renderPlaylistDropdown,
  togglePlaylistActionMenu,
  renamePlaylist,
  deletePlaylist,
  setActivePlaylist,
  createPlaylist,
  addTrackToPlaylist,
  addTracksToPlaylist,
  addKnownTrackIdsToPlaylist,
  removeTrackFromActivePlaylist
} from './playlist.js';
import { createTrackList } from './track-list.js';
import { createMetadata } from './metadata.js';
import { createAudioStream } from './audio-stream.js';
import { Dialog } from '../ui/dialog.js';

let Settings = null;
let Neutralino = null;
let Toast = { show() {} };
let joinPath = null;
let fileTime = null;
let fileName = null;
let trackTitle = null;
let directoryName = null;
let normalizeRenameFileName = null;
let validateFileName = null;
let pathExists = null;
let formatBytes = null;
let sortTracks = null;
let rebuildQueue = null;
let mergeKnownTrackData = null;
let currentTrack = null;
let queueIndexByTrackId = null;
let scanAudioFiles = null;
let getMp3StreamInfo = null;
let findFrameOffsetNear = null;
let ensureTrackMetadata = null;
let metadataLine = null;
let metadataPairs = null;
let ensureTrackDuration = null;
let clearAudioSource = null;
let loadTrackSource = null;



function savePlayerSettings(patch, { immediate = false } = {}) {
  state.pendingSave = { ...state.pendingSave, ...patch };

  const flush = () => {
    const next = { ...state.pendingSave };
    state.pendingSave = {};
    state.saveTimer = null;
    void Settings.save(next).catch(() => {});
  };

  if (immediate) {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    flush();
    return;
  }

  if (!state.saveTimer) {
    state.saveTimer = setTimeout(flush, 600);
  }
}


function applySavedPlayerSettings() {
  const settings = Settings.get();
  const volume = Number.isFinite(Number(settings.playerVolume))
    ? Math.min(1, Math.max(0, Number(settings.playerVolume)))
    : 0.9;

  state.orderMode = settings.playerOrderMode || state.orderMode;
  state.repeatMode = settings.playerRepeatMode || state.repeatMode;
  state.playlists = sanitizePlaylists(settings.playerPlaylists);
  state.activePlaylistId = settings.playerActivePlaylistId === 'all' || state.playlists.some(playlist => playlist.id === settings.playerActivePlaylistId)
    ? (settings.playerActivePlaylistId || 'all')
    : 'all';
  state.restoringPosition = Math.max(0, Number(settings.playerLastPosition) || 0);

  const volumeEl = el('player-volume');
  const orderEl = el('player-order-select');
  const repeatEl = el('player-repeat-select');
  const audio = el('audio-player');

  if (volumeEl) volumeEl.value = String(volume);
  if (audio) audio.volume = volume;
  if (orderEl) orderEl.value = state.orderMode;
  if (repeatEl) repeatEl.value = state.repeatMode;
  updateSortControls();
  renderPlaylistDropdown();
}




function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const min = Math.floor(safe / 60);
  const sec = String(Math.floor(safe % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

function displayDuration(track = currentTrack()) {
  const audio = el('audio-player');
  const streamDuration = Number(track?.streamInfo?.duration) || 0;
  if (streamDuration > 0) return streamDuration;
  const settings = Settings.get();
  const savedDuration = Number(settings.playerLastDuration) || 0;
  const savedId = String(settings.playerLastTrackId || '').toLowerCase();
  const savedPath = String(settings.playerLastTrackPath || '').toLowerCase();
  if (track && savedDuration > 0 && (track.id === savedId || track.path.toLowerCase() === savedPath)) {
    return savedDuration;
  }
  const current = currentTrack();
  return audio && track && current && track.id === current.id && Number.isFinite(audio.duration) ? audio.duration : 0;
}

function displayCurrentTime() {
  const audio = el('audio-player');
  if (state.seekPreviewTime !== null) return state.seekPreviewTime;
  if (state.restoredPreviewTime !== null && (!audio || !audio.src || state.isLoadingTrack)) return state.restoredPreviewTime;
  return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
}



async function hydrateTrackDurations() {
  const token = ++state.durationHydrationToken;
  state.sortMetricLoading = true;
  try {
    const tracks = [...playlistSourceTracks()];
    for (const track of tracks) {
      if (token !== state.durationHydrationToken) return;
      await ensureTrackDuration(track);
      if (token !== state.durationHydrationToken) return;
      if (state.sortKey === 'duration') {
        rebuildQueue();
      }
      renderList();
    }
  } finally {
    if (token === state.durationHydrationToken) {
      state.sortMetricLoading = false;
      rebuildQueue();
      renderList();
    }
  }
}


function closeTrackMenu() {
  state.openMenuTrackId = '';
  document.getElementById('player-track-context-menu')?.classList.add('hidden');
  document
    .querySelectorAll('.player-track-more[aria-expanded="true"]')
    .forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function ensureTrackMenu() {
  let menu = el('player-track-context-menu');
  if (menu) return menu;

  menu = document.createElement('div');
  menu.id = 'player-track-context-menu';
  menu.className = 'player-track-menu hidden';
  menu.setAttribute('role', 'menu');

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.dataset.trackMenuAction = 'rename';
  rename.setAttribute('role', 'menuitem');
  rename.textContent = '이름 바꾸기';

  const addToPlaylist = document.createElement('button');
  addToPlaylist.type = 'button';
  addToPlaylist.dataset.trackMenuAction = 'add-playlist';
  addToPlaylist.setAttribute('role', 'menuitem');
  addToPlaylist.textContent = '플레이리스트에 추가';

  const removeFromPlaylist = document.createElement('button');
  removeFromPlaylist.type = 'button';
  removeFromPlaylist.dataset.trackMenuAction = 'remove-playlist';
  removeFromPlaylist.setAttribute('role', 'menuitem');
  removeFromPlaylist.textContent = '플레이리스트에서 제거';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.trackMenuAction = 'remove';
  remove.className = 'danger';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = '목록에서 제거';

  menu.append(rename, addToPlaylist, removeFromPlaylist, remove);
  menu.addEventListener('click', event => {
    const button = event.target.closest('button[data-track-menu-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const trackId = menu.dataset.trackId || '';
    const action = button.dataset.trackMenuAction;
    closeTrackMenu();

    if (action === 'rename') {
      void renameTrackFile(trackId);
    } else if (action === 'add-playlist') {
      void addTrackToPlaylist(trackId).then(result => autoplayAddedTrackIfIdle(result));
    } else if (action === 'remove-playlist') {
      void removeTrackFromActivePlaylist(trackId);
    } else if (action === 'remove') {
      void removeTrackFile(trackId);
    }
  });

  document.body.appendChild(menu);
  return menu;
}

function openTrackMenu(trackId, anchor) {
  const menu = ensureTrackMenu();
  state.openMenuTrackId = trackId;
  menu.dataset.trackId = trackId;
  menu.querySelector('[data-track-menu-action="add-playlist"]')?.classList.toggle('hidden', state.playlists.length === 0);
  menu.querySelector('[data-track-menu-action="remove-playlist"]')?.classList.toggle('hidden', !activePlaylist());
  menu.classList.remove('hidden');
  menu.style.visibility = 'hidden';

  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 10;
  const width = menuRect.width || 156;
  const height = menuRect.height || 92;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  const left = Math.min(maxLeft, Math.max(margin, rect.right - width));
  const top = Math.min(maxTop, Math.max(margin, rect.bottom + 8));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';

  document
    .querySelectorAll('.player-track-more')
    .forEach(button => button.setAttribute('aria-expanded', button === anchor ? 'true' : 'false'));
}

function selectedTrackIds() {
  if (!(state.selectedTrackIds instanceof Set)) {
    state.selectedTrackIds = new Set(Array.isArray(state.selectedTrackIds) ? state.selectedTrackIds : []);
  }
  return state.selectedTrackIds;
}

function toggleTrackSelection(trackId, selected) {
  if (!trackId || activePlaylist()) return;
  const ids = selectedTrackIds();
  if (selected) ids.add(trackId);
  else ids.delete(trackId);
  renderList();
}

function setVisibleTrackSelection(selected) {
  if (activePlaylist()) return;
  const ids = selectedTrackIds();
  document
    .querySelectorAll('#player-list input[data-player-action="select-track"]')
    .forEach(checkbox => {
      const trackId = checkbox.dataset.trackId || '';
      if (!trackId) return;
      if (selected) ids.add(trackId);
      else ids.delete(trackId);
    });
  renderList();
}

function clearTrackSelection() {
  selectedTrackIds().clear();
  renderList();
}

function toggleMusicFolder(folderPath, currentlyExpanded = false) {
  const key = String(folderPath || '').trim();
  if (!key) return;
  if (!(state.folderCollapsedPaths instanceof Set)) {
    state.folderCollapsedPaths = new Set(Array.isArray(state.folderCollapsedPaths) ? state.folderCollapsedPaths : []);
  }
  if (!(state.folderExpandedPaths instanceof Set)) {
    state.folderExpandedPaths = new Set(Array.isArray(state.folderExpandedPaths) ? state.folderExpandedPaths : []);
  }
  if (currentlyExpanded) {
    state.folderExpandedPaths.delete(key);
    state.folderCollapsedPaths.add(key);
  } else {
    state.folderCollapsedPaths.delete(key);
    state.folderExpandedPaths.add(key);
  }
  closeTrackMenu();
  renderList();
}

function normalizeTrackPathKey(path) {
  return String(path || '').replace(/\//g, '\\').toLowerCase();
}

async function addSelectedTracksToPlaylist() {
  const ids = [...selectedTrackIds()];
  if (!ids.length) return;

  const result = await addTracksToPlaylist(ids);
  if (result?.addedCount) {
    selectedTrackIds().clear();
    renderList();
    void autoplayAddedTrackIfIdle(result);
  }
}

async function autoplayAddedTrackIfIdle(result, { requirePlayerTab = false } = {}) {
  if (!result?.addedCount || !result.activePlaylistUpdated || !result.addedTrackIds?.length) return;
  if (requirePlayerTab && !document.getElementById('tab-player')?.classList.contains('active')) return;
  if (state.isLoadingTrack) return;

  const audio = el('audio-player');
  if (audio && !audio.paused) return;
  if (!result.wasQueueEmpty && result.wasTrackSelected && audio?.src) return;

  const addedIds = new Set(result.addedTrackIds);
  const index = state.queue.findIndex(track => addedIds.has(track.id));
  if (index < 0) return;

  await loadTrack(index, true, { restorePosition: 0 });
}

function playlistOptions() {
  return state.playlists.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    count: playlist.trackIds.length
  }));
}

async function addFilesToPlaylist(filePaths, playlistId) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
  const playlist = state.playlists.find(item => item.id === playlistId);
  if (!playlist || !paths.length) {
    return { addedCount: 0, requestedCount: paths.length, foundCount: 0, playlistName: playlist?.name || '' };
  }

  await loadLibrary({ force: true });

  const wanted = new Set(paths.map(normalizeTrackPathKey));
  const trackIds = state.tracks
    .filter(track => wanted.has(normalizeTrackPathKey(track.path)) || wanted.has(normalizeTrackPathKey(track.id)))
    .map(track => track.id);

  const result = await addKnownTrackIdsToPlaylist(trackIds, playlistId, { silent: true });
  render();
  await autoplayAddedTrackIfIdle(result, { requirePlayerTab: true });
  return {
    ...result,
    requestedCount: paths.length,
    foundCount: trackIds.length
  };
}

function tracksByIds(trackIds) {
  const trackMap = new Map([...state.tracks, ...state.queue].map(track => [track.id, track]));
  const seen = new Set();
  return trackIds
    .map(trackId => trackMap.get(trackId))
    .filter(track => {
      if (!track || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
}

function selectedTracksDeleteDetail(tracks) {
  const names = tracks
    .slice(0, 8)
    .map(track => `- ${track.fileName || fileName(track.path)}`);
  if (tracks.length > names.length) names.push(`외 ${tracks.length - names.length}곡`);
  return [
    '이 작업은 선택한 실제 음악 파일을 삭제합니다. 삭제 후 되돌릴 수 없습니다.',
    '',
    ...names
  ].join('\n');
}

async function confirmRemoveTracks(tracks) {
  if (tracks.length === 1) return confirmRemoveTrack(tracks[0]);
  return Dialog.confirm({
    title: '선택한 음악 파일 삭제',
    message: `${tracks.length}곡을 삭제할까요?`,
    detail: selectedTracksDeleteDetail(tracks),
    confirmText: '삭제',
    danger: true
  });
}

function removeDeletedTracksFromState(deletedIds, preserveId = '') {
  const deletedSet = new Set(deletedIds);
  deletedSet.forEach(trackId => {
    state.metadataPromises.delete(trackId);
    state.streamInfoPromises.delete(trackId);
    if (state.thumbnailHydrationTrackIds instanceof Set) state.thumbnailHydrationTrackIds.delete(trackId);
    const cachedCover = state.listCoverObjectUrls instanceof Map ? state.listCoverObjectUrls.get(trackId) : null;
    if (cachedCover?.url) URL.revokeObjectURL(cachedCover.url);
    if (state.listCoverObjectUrls instanceof Map) state.listCoverObjectUrls.delete(trackId);
  });

  state.playlists = state.playlists.map(playlist => ({
    ...playlist,
    trackIds: playlist.trackIds.filter(trackId => !deletedSet.has(trackId))
  }));
  state.tracks = state.tracks.filter(item => !deletedSet.has(item.id));
  state.queue = sortTracks(playlistSourceTracks());
  state.queuePosition = preserveId
    ? state.queue.findIndex(item => item.id === preserveId)
    : -1;
  if (state.queuePosition < 0 && preserveId && state.queue.length) state.queuePosition = 0;
  deletedSet.forEach(trackId => selectedTrackIds().delete(trackId));
}

async function removeSelectedTrackFiles() {
  const tracks = tracksByIds([...selectedTrackIds()]);
  if (!tracks.length) return;
  if (!(await confirmRemoveTracks(tracks))) return;

  const audio = el('audio-player');
  const current = currentTrack();
  const deletingCurrent = tracks.some(track => track.id === current?.id);
  const preserveId = deletingCurrent ? '' : current?.id || '';
  const deletedIds = [];
  const failures = [];

  try {
    if (deletingCurrent && audio) {
      state.trackLoadToken += 1;
      clearAudioSource(audio);
    }

    for (const track of tracks) {
      try {
        await Neutralino.filesystem.remove(track.path);
        deletedIds.push(track.id);
      } catch (e) {
        failures.push({ track, error: e });
      }
    }

    if (deletedIds.length) {
      removeDeletedTracksFromState(deletedIds, preserveId);
      if (deletingCurrent && deletedIds.includes(current?.id)) {
        savePlayerSettings({
          playerLastTrackId: '',
          playerLastTrackPath: '',
          playerLastPosition: 0,
          playerLastDuration: 0
        }, { immediate: true });
      }
      render();
      renderPlaylistDropdown();
      savePlaylists();
    }

    if (failures.length) {
      Toast.show(`${deletedIds.length}곡 삭제, ${failures.length}곡 실패했습니다.`, 'error', 7000);
      if (deletingCurrent && failures.some(({ track }) => track.id === current?.id)) {
        void loadLibrary({ force: true });
      }
      renderList();
      return;
    }

    Toast.show(`${deletedIds.length}곡을 삭제하고 목록에서 제거했습니다.`, 'success', 4500);
  } catch (e) {
    Toast.show(`선택한 파일을 삭제하지 못했습니다: ${e.message || e}`, 'error', 7000);
    if (deletingCurrent) void loadLibrary({ force: true });
  }
}

function updateTrackPath(oldId, nextPath, oldTitle) {
  const nextId = nextPath.toLowerCase();
  const nextFileName = fileName(nextPath);
  const nextExt = nextFileName.split('.').pop()?.toLowerCase() || '';
  const seen = new Set();

  [...state.tracks, ...state.queue].forEach(track => {
    if (!track || track.id !== oldId || seen.has(track)) return;
    seen.add(track);
    const usesFileTitle = !track.metadataLoaded || !track.title || track.title === oldTitle;
    track.id = nextId;
    track.path = nextPath;
    track.fileName = nextFileName;
    track.ext = nextExt;
    if (usesFileTitle) track.title = trackTitle(nextPath);
  });

  state.metadataPromises.delete(oldId);
  state.streamInfoPromises.delete(oldId);
  state.playlists = state.playlists.map(playlist => ({
    ...playlist,
    trackIds: playlist.trackIds.map(trackId => trackId === oldId ? nextId : trackId)
  }));
  savePlaylists();
  rebuildQueue(currentTrack()?.id === oldId ? nextId : currentTrack()?.id || nextId);
  return nextId;
}

async function renameTrackFile(trackId) {
  const index = queueIndexByTrackId(trackId);
  const track = state.queue[index];
  if (!track) return;

  const oldFileName = track.fileName || fileName(track.path);
  const input = await Dialog.prompt({
    title: '음악 파일 이름 변경',
    message: '새 파일 이름을 입력하세요. 확장자는 자동으로 유지됩니다.',
    label: '파일 이름',
    value: oldFileName,
    confirmText: '변경',
    validate: value => {
      const normalized = normalizeRenameFileName(value, oldFileName);
      return normalized.ok ? { value: normalized.name } : normalized.message;
    }
  });
  if (input === null) return;

  const normalized = normalizeRenameFileName(input, oldFileName);
  if (!normalized.ok) {
    Toast.show(normalized.message, 'error', 5000);
    return;
  }

  const dir = directoryName(track.path);
  if (!dir) {
    Toast.show('파일 경로를 확인할 수 없습니다.', 'error', 5000);
    return;
  }

  const nextPath = joinPath(dir, normalized.name);
  if (nextPath.toLowerCase() === track.path.toLowerCase()) return;

  if (await pathExists(nextPath)) {
    Toast.show('같은 이름의 파일이 이미 있습니다.', 'error', 5000);
    return;
  }

  const audio = el('audio-player');
  const current = currentTrack();
  const oldId = track.id;
  const oldTitle = trackTitle(track.path);
  const wasCurrent = current?.id === oldId;
  const wasPlaying = !!(wasCurrent && audio && !audio.paused);
  const position = wasCurrent ? Math.floor(displayCurrentTime()) : 0;

  try {
    if (wasCurrent && audio) clearAudioSource(audio);
    await Neutralino.filesystem.move(track.path, nextPath);
    const nextId = updateTrackPath(oldId, nextPath, oldTitle);
    const nextIndex = queueIndexByTrackId(nextId);

    if (wasCurrent && nextIndex >= 0) {
      await loadTrack(nextIndex, wasPlaying, { restorePosition: position });
    } else {
      render();
    }

    Toast.show('파일 이름을 변경했습니다.', 'success', 4000);
  } catch (e) {
    Toast.show(`파일 이름을 변경하지 못했습니다: ${e.message || e}`, 'error', 7000);
    if (wasCurrent) void loadLibrary({ force: true });
  }
}

async function confirmRemoveTrack(track) {
  return Dialog.confirm({
    title: '음악 파일 삭제',
    message: track.fileName || fileName(track.path),
    detail: '이 작업은 실제 음악 파일을 삭제합니다. 계속할까요?',
    confirmText: '삭제',
    danger: true
  });
}

async function removeTrackFile(trackId) {
  const index = queueIndexByTrackId(trackId);
  const track = state.queue[index];
  if (!track) return;
  if (!(await confirmRemoveTrack(track))) return;

  const audio = el('audio-player');
  const current = currentTrack();
  const wasCurrent = current?.id === track.id;
  const preserveId = wasCurrent ? '' : current?.id || '';

  try {
    if (wasCurrent && audio) clearAudioSource(audio);
    await Neutralino.filesystem.remove(track.path);

    state.metadataPromises.delete(track.id);
    state.streamInfoPromises.delete(track.id);
    state.playlists = state.playlists.map(playlist => ({
      ...playlist,
      trackIds: playlist.trackIds.filter(trackId => trackId !== track.id)
    }));
    state.tracks = state.tracks.filter(item => item.id !== track.id);
    state.queue = sortTracks(playlistSourceTracks());
    state.queuePosition = preserveId
      ? state.queue.findIndex(item => item.id === preserveId)
      : -1;
    if (state.queuePosition < 0 && preserveId && state.queue.length) state.queuePosition = 0;

    if (wasCurrent) {
      savePlayerSettings({
        playerLastTrackId: '',
        playerLastTrackPath: '',
        playerLastPosition: 0,
        playerLastDuration: 0
      }, { immediate: true });
    }

    render();
    renderPlaylistDropdown();
    savePlaylists();
    Toast.show('파일을 삭제하고 목록에서 제거했습니다.', 'success', 4500);
  } catch (e) {
    Toast.show(`파일을 삭제하지 못했습니다: ${e.message || e}`, 'error', 7000);
    if (wasCurrent) void loadLibrary({ force: true });
  }
}


async function libraryPathCandidates() {
  const activePath = String(Settings.getActiveSavePath() || '').trim();
  return activePath ? [activePath] : [];
}


async function restoreLastTrackIfNeeded() {
  if (state.restoredLastTrack || !state.queue.length || state.sourceTrackId) return false;

  const settings = Settings.get();
  const savedId = String(settings.playerLastTrackId || '').toLowerCase();
  const savedPath = String(settings.playerLastTrackPath || '').toLowerCase();
  if (!savedId && !savedPath) return false;

  const index = state.queue.findIndex(track => track.id === savedId || track.path.toLowerCase() === savedPath);
  if (index < 0) return false;

  state.restoredLastTrack = true;
  state.queuePosition = index;
  state.restoringPosition = Math.max(0, Number(settings.playerLastPosition) || 0);
  state.restoredPreviewTime = state.restoringPosition;
  const track = state.queue[index];
  setPlayerLoading(true);
  const savedDuration = Number(settings.playerLastDuration) || 0;
  if (savedDuration > 0) {
    track.streamInfo = {
      ...(track.streamInfo || {}),
      duration: savedDuration,
      totalSize: Number(track.size) || 0,
      estimated: true
    };
  }
  try {
    await ensureTrackMetadata(track);
    if (/\.mp3$/i.test(track.path)) {
      try {
        await getMp3StreamInfo(track);
      } catch {
        if (!displayDuration(track) && state.restoringPosition > 0) {
          track.streamInfo = {
            ...(track.streamInfo || {}),
            duration: state.restoringPosition,
            totalSize: Number(track.size) || 0,
            estimated: true
          };
        }
      }
    }
    setCurrentText(track);
    renderList();
    updateProgress();
    updateControls();
  } finally {
    setPlayerLoading(false);
  }
  return true;
}

async function loadLibrary({ force = false } = {}) {
  const activePath = Settings.getActiveSavePath();
  setText('player-path', activePath ? `현재 저장 위치: ${activePath}` : '저장 위치가 설정되지 않았습니다.');

  const paths = await libraryPathCandidates();
  if (!paths.length) {
    state.tracks = [];
    state.queue = [];
    state.queuePosition = -1;
    render();
    setPlayerLoading(false);
    return;
  }

  if (!force && paths.includes(state.loadedPath) && state.tracks.length) {
    render();
    setPlayerLoading(false);
    return;
  }

  const currentId = currentTrack()?.id || '';
  setText('player-summary', `음악 파일을 불러오는 중… ${paths[0]}`);
  if (!currentId && !state.tracks.length) setPlayerLoading(true);

  try {
    let loadedPath = paths[0];
    let tracks = [];
    let lastError = null;

    for (const path of paths) {
      try {
        tracks = await scanAudioFiles(path);
        loadedPath = path;
        if (tracks.length) break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!tracks.length && lastError) throw lastError;

    if (state.loadedPath && state.loadedPath.toLowerCase() !== loadedPath.toLowerCase()) {
      state.folderCollapsedPaths?.clear?.();
      state.folderExpandedPaths?.clear?.();
    }
    state.tracks = mergeKnownTrackData(tracks);
    state.loadedPath = loadedPath;
    trimMissingPlaylistTracks();
    rebuildQueue(currentId);
    render();
    void hydrateTrackDurations();
    if (!currentId) {
      await restoreLastTrackIfNeeded();
    }
    setText('player-path', loadedPath === activePath
      ? `현재 저장 위치: ${loadedPath}`
      : `음악 폴더: ${loadedPath}`);
    if (!state.tracks.length) {
      setText('player-summary', `음악 파일 0개 · 스캔 위치: ${loadedPath}`);
    }
  } catch (e) {
    state.tracks = [];
    state.queue = [];
    state.queuePosition = -1;
    render();
    setText('player-summary', `음악 파일을 불러오지 못했습니다 · ${paths[0]}`);
    Toast.show(`음악 파일을 불러오지 못했습니다: ${e.message || e}`, 'error', 6000);
  } finally {
    if (currentId || !state.queue.length || !state.restoredLastTrack) setPlayerLoading(false);
  }
}

async function loadTrack(index, shouldPlay = false, options = {}) {
  const track = state.queue[index];
  if (!track) return;

  const loadToken = ++state.trackLoadToken;
  const audio = el('audio-player');
  if (!audio) {
    Toast.show('오디오 플레이어를 초기화하지 못했습니다.', 'error', 5000);
    return;
  }
  state.queuePosition = index;
  state.isLoadingTrack = true;
  updateControls();
  setCurrentText(track);
  renderList();

  try {
    const restorePosition = Math.max(0, Number(options.restorePosition) || 0);
    if (restorePosition > 0) {
      state.restoredPreviewTime = restorePosition;
      updateProgress();
    }
    await ensureTrackMetadata(track);
    if (loadToken !== state.trackLoadToken) return;
    setCurrentText(track);
    renderList();
    clearAudioSource(audio);
    await loadTrackSource(audio, track, shouldPlay, { startTime: restorePosition });
    if (loadToken !== state.trackLoadToken) {
      clearAudioSource(audio);
      return;
    }
    if (restorePosition > 0) {
      const applyPosition = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        audio.currentTime = duration ? Math.min(restorePosition, Math.max(0, duration - 1)) : restorePosition;
        state.restoredPreviewTime = null;
        updateProgress();
      };

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        applyPosition();
      } else {
        audio.addEventListener('loadedmetadata', applyPosition, { once: true });
      }
    } else {
      state.restoredPreviewTime = null;
    }
    state.restoringPosition = null;

    if (options.persist !== false) {
      savePlayerSettings({
        playerLastTrackId: track.id,
        playerLastTrackPath: track.path,
        playerLastPosition: restorePosition || Math.floor(Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
        playerLastDuration: displayDuration(track)
      }, { immediate: true });
    }
  } catch (e) {
    Toast.show(`재생할 수 없습니다: ${track.fileName}`, 'error', 6000);
  } finally {
    if (loadToken === state.trackLoadToken) {
      state.isLoadingTrack = false;
      updateControls();
      renderList();
    }
  }
}

async function playCurrent() {
  const audio = el('audio-player');
  const track = currentTrack();
  if (!audio) {
    Toast.show('오디오 플레이어를 초기화하지 못했습니다.', 'error', 5000);
    return;
  }
  if (!state.queue.length) {
    Toast.show('재생할 음악 파일이 없습니다.', 'warning');
    return;
  }

  if (state.queuePosition < 0) state.queuePosition = 0;
  if (!audio.src || state.sourceTrackId !== track?.id) {
    await loadTrack(state.queuePosition, true, {
      restorePosition: state.restoringPosition || 0
    });
    return;
  }

  try {
    await audio.play();
    updateControls();
  } catch {
    try {
      if (track) await loadTrackSource(audio, track, true);
    } catch {
      Toast.show('재생을 시작할 수 없습니다.', 'error');
    }
  }
}

function pause() {
  el('audio-player')?.pause();
  updateControls();
}

async function seekTo(time) {
  const audio = el('audio-player');
  const track = currentTrack();
  if (!audio || !track) return;

  const targetTime = Math.max(0, Number(time) || 0);
  const wasPlaying = !!audio.src && !audio.paused;
  const isMp3Track = /\.mp3$/i.test(track.path);
  const shouldOpenStream = isMp3Track && (!audio.src || state.sourceTrackId !== track.id || state.streamSession);
  savePlayerSettings({
    playerLastTrackId: track.id,
    playerLastTrackPath: track.path,
    playerLastPosition: Math.floor(targetTime),
    playerLastDuration: displayDuration(track)
  }, { immediate: true });

  if (shouldOpenStream) {
    state.isStreamSeeking = true;
    state.seekPreviewTime = targetTime;
    state.restoredPreviewTime = targetTime;
    state.restoringPosition = targetTime;
    updateProgress();

    try {
      if (audio.src || state.sourceTrackId) clearAudioSource(audio);
      await loadTrackSource(audio, track, wasPlaying, {
        startTime: targetTime,
        suppressStatus: true
      });
      state.restoredPreviewTime = null;
      state.restoringPosition = null;
      state.seekPreviewTime = null;
      updateProgress();
    } finally {
      state.isStreamSeeking = false;
      updateControls();
    }
    return;
  }

  audio.currentTime = targetTime;
  updateProgress();
}

function nextQueueIndex({ wrap = true } = {}) {
  const count = state.queue.length;
  if (!count) return -1;
  if (state.queuePosition < 0 || state.queuePosition >= count) return 0;
  if (state.queuePosition < count - 1) return state.queuePosition + 1;
  return wrap ? 0 : -1;
}

function previousQueueIndex({ wrap = true } = {}) {
  const count = state.queue.length;
  if (!count) return -1;
  if (state.queuePosition < 0 || state.queuePosition >= count) return wrap ? count - 1 : 0;
  if (state.queuePosition > 0) return state.queuePosition - 1;
  return wrap ? count - 1 : 0;
}

function hasNext() {
  return nextQueueIndex({ wrap: false }) >= 0;
}

async function next({ fromEnded = false } = {}) {
  if (!state.queue.length) return;
  const shouldWrap = !fromEnded || state.repeatMode === 'repeat-queue';
  const index = nextQueueIndex({ wrap: shouldWrap });
  if (index < 0) {
    pause();
    return;
  }
  await loadTrack(index, true);
}

async function previous() {
  if (!state.queue.length) return;
  const audio = el('audio-player');
  if (!audio) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const prevIndex = previousQueueIndex();
  await loadTrack(prevIndex, true);
}

async function handleEnded() {
  const audio = el('audio-player');
  if (!audio) return;
  if (state.repeatMode === 'repeat-one') {
    const index = state.queuePosition;
    if (index < 0 || !state.queue[index]) return;

    state.seekPreviewTime = null;
    state.restoredPreviewTime = 0;
    state.restoringPosition = 0;

    const track = state.queue[index];
    savePlayerSettings({
      playerLastTrackId: track.id,
      playerLastTrackPath: track.path,
      playerLastPosition: 0,
      playerLastDuration: displayDuration(track)
    }, { immediate: true });

    try {
      await loadTrack(index, true, { restorePosition: 0 });
    } catch {
      Toast.show('현재 노래를 반복 재생할 수 없습니다.', 'error', 5000);
    }
    return;
  }

  if (state.repeatMode === 'stop-current') {
    pause();
    return;
  }

  if (state.repeatMode === 'play-through') {
    if (hasNext()) await next({ fromEnded: true });
    else pause();
    return;
  }

  await next({ fromEnded: true });
}

function setOrderMode(mode) {
  state.orderMode = mode;
  rebuildQueue();
  render();
  savePlayerSettings({ playerOrderMode: mode }, { immediate: true });
}

function setRepeatMode(mode) {
  state.repeatMode = mode;
  savePlayerSettings({ playerRepeatMode: mode }, { immediate: true });
}

function sortLabel() {
  return ({
    title: '제목순',
    duration: '재생시간순'
  })[state.sortKey] || '제목순';
}

function sortDirectionLabel() {
  return state.sortDirection === 'desc' ? '내림차순' : '오름차순';
}

function updateSortControls() {
  const select = el('player-sort-select');
  const button = el('player-sort-dir-btn');
  if (select) select.value = state.sortKey;
  if (button) {
    button.textContent = sortDirectionLabel();
    button.title = `${sortLabel()} ${sortDirectionLabel()}`;
    button.setAttribute('aria-label', `정렬 방향: ${sortDirectionLabel()}`);
  }
}

function applyListSort(nextKey = state.sortKey, nextDirection = state.sortDirection) {
  state.sortKey = nextKey;
  state.sortDirection = nextDirection;
  rebuildQueue();
  updateSortControls();
  render();
  if (state.sortKey === 'duration') void hydrateTrackDurations();
}

function invalidate() {
  const activePath = String(Settings.getActiveSavePath() || '').trim();
  const loadedPath = String(state.loadedPath || '').trim();
  const pathChanged = !!loadedPath && !!activePath && loadedPath.toLowerCase() !== activePath.toLowerCase();

  if (pathChanged) {
    const audio = el('audio-player');
    if (audio) clearAudioSource(audio);
    state.tracks = [];
    state.queue = [];
    state.queuePosition = -1;
    state.restoredLastTrack = false;
    state.restoredPreviewTime = null;
    state.seekPreviewTime = null;
    state.folderCollapsedPaths?.clear?.();
    state.folderExpandedPaths?.clear?.();
    setText('player-path', `현재 저장 위치: ${activePath}`);
    setText('player-summary', `음악 파일을 불러오는 중… ${activePath}`);
    render();
  }

  state.loadedPath = '';
  if (document.getElementById('tab-player')?.classList.contains('active')) {
    void loadLibrary({ force: true });
  }
}

function init() {
  if (state.initialized) return;
  state.initialized = true;

  const audio = el('audio-player');
  const volume = el('player-volume');
  applySavedPlayerSettings();
  if (audio) {
    audio.volume = Number.isFinite(Number(volume?.value)) ? Number(volume.value) : 0.9;
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('play', updateControls);
    audio.addEventListener('pause', () => {
      const track = currentTrack();
      if (track) {
        savePlayerSettings({
          playerLastTrackId: track.id,
          playerLastTrackPath: track.path,
          playerLastPosition: Math.floor(Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
          playerLastDuration: displayDuration(track)
        }, { immediate: true });
      }
      updateControls();
    });
    audio.addEventListener('ended', () => void handleEnded());
    audio.addEventListener('error', () => {
      if (state.isLoadingTrack) return;
      const track = currentTrack();
      if (track) Toast.show(`재생 중 오류가 발생했습니다: ${track.fileName}`, 'error', 5000);
    });
  }

  el('player-refresh-btn')?.addEventListener('click', () => void loadLibrary({ force: true }));
  el('player-open-folder-btn')?.addEventListener('click', () => {
    const path = Settings.getActiveSavePath();
    if (path) void Neutralino.os.open(path);
  });
  el('player-play-btn')?.addEventListener('click', () => {
    if (!audio || audio.paused) void playCurrent();
    else pause();
  });
  el('player-prev-btn')?.addEventListener('click', () => void previous());
  el('player-next-btn')?.addEventListener('click', () => void next());
  el('player-order-select')?.addEventListener('change', e => setOrderMode(e.target.value));
  el('player-repeat-select')?.addEventListener('change', e => setRepeatMode(e.target.value));
  el('player-sort-select')?.addEventListener('change', e => applyListSort(e.target.value, state.sortDirection));
  el('player-sort-dir-btn')?.addEventListener('click', () => {
    applyListSort(state.sortKey, state.sortDirection === 'desc' ? 'asc' : 'desc');
  });
  el('player-playlist-btn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    closeTrackMenu();
    togglePlaylistMenu();
  });
  el('player-playlist-menu')?.addEventListener('click', e => {
    const target = e.target.closest('button[data-playlist-action]');
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    closeTrackMenu();

    const action = target.dataset.playlistAction;
    const playlistId = target.dataset.playlistId || '';

    if (action === 'create') {
      closePlaylistMenu();
      void createPlaylist();
      return;
    }

    if (action === 'select') {
      setActivePlaylist(playlistId || 'all');
      return;
    }

    if (action === 'toggle-actions') {
      togglePlaylistActionMenu(playlistId);
      return;
    }

    if (action === 'rename') {
      void renamePlaylist(playlistId);
      return;
    }

    if (action === 'delete') {
      void deletePlaylist(playlistId);
    }
  });
  volume?.addEventListener('input', e => {
    const value = Number(e.target.value);
    if (audio) audio.volume = value;
    savePlayerSettings({ playerVolume: value });
  });
  volume?.addEventListener('change', e => {
    savePlayerSettings({ playerVolume: Number(e.target.value) }, { immediate: true });
  });
  el('player-seek')?.addEventListener('input', e => {
    state.isSeeking = true;
    const duration = displayDuration();
    if (duration) {
      setText('player-current-time', formatTime((Number(e.target.value) / 100) * duration));
    }
  });
  el('player-seek')?.addEventListener('change', e => {
    const duration = displayDuration();
    if (audio && duration) {
      const targetTime = (Number(e.target.value) / 100) * duration;
      state.seekPreviewTime = targetTime;
      updateProgress();
      const track = currentTrack();
      if (track) {
        savePlayerSettings({
          playerLastTrackId: track.id,
          playerLastTrackPath: track.path,
          playerLastPosition: Math.floor(targetTime),
          playerLastDuration: duration
        }, { immediate: true });
      }
      void seekTo(targetTime)
        .catch(() => {
          Toast.show('재생 위치를 이동할 수 없습니다.', 'error', 4000);
        })
        .finally(() => {
          state.isSeeking = false;
          state.seekPreviewTime = null;
          updateProgress();
        });
      return;
    }
    state.isSeeking = false;
  });
  const listDom = ensureListDom().list;
  el('tab-player')?.addEventListener('change', e => {
    const selectAll = e.target.closest('[data-player-selection-action="toggle-all"]');
    if (selectAll) {
      setVisibleTrackSelection(selectAll.checked);
      return;
    }

    const checkbox = e.target.closest('input[data-player-action="select-track"]');
    if (checkbox) {
      toggleTrackSelection(checkbox.dataset.trackId || '', checkbox.checked);
    }
  });
  el('tab-player')?.addEventListener('click', e => {
    const actionButton = e.target.closest('button[data-player-selection-action]');
    if (!actionButton) return;

    e.preventDefault();
    e.stopPropagation();
    const action = actionButton.dataset.playerSelectionAction;
    if (action === 'add-selected') {
      void addSelectedTracksToPlaylist();
    } else if (action === 'delete-selected') {
      void removeSelectedTrackFiles();
    } else if (action === 'clear') {
      clearTrackSelection();
    }
  });
  listDom?.addEventListener('click', e => {
    if (e.target.closest('.player-track-select')) {
      e.stopPropagation();
      return;
    }

    const folderButton = e.target.closest('button[data-player-action="toggle-folder"]');
    if (folderButton) {
      e.preventDefault();
      e.stopPropagation();
      toggleMusicFolder(folderButton.dataset.folderPath || '', folderButton.getAttribute('aria-expanded') === 'true');
      return;
    }

    const menuButton = e.target.closest('button[data-player-action="menu"]');
    if (menuButton) {
      e.preventDefault();
      e.stopPropagation();
      const trackId = menuButton.dataset.trackId || '';
      if (state.openMenuTrackId === trackId) {
        closeTrackMenu();
      } else {
        openTrackMenu(trackId, menuButton);
      }
      return;
    }

    const item = e.target.closest('.player-track');
    if (!item) return;
    closeTrackMenu();
    void loadTrack(Number(item.dataset.index), true);
  });
  listDom?.addEventListener('keydown', e => {
    if (e.target.closest('button, input, label')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.player-track');
    if (!item) return;
    e.preventDefault();
    closeTrackMenu();
    void loadTrack(Number(item.dataset.index), true);
  });
  listDom?.addEventListener('scroll', closeTrackMenu);
  document.addEventListener('click', e => {
    if (e.target.closest('#player-track-context-menu') || e.target.closest('.player-track-more')) return;
    if (e.target.closest('#player-playlist-menu') || e.target.closest('#player-playlist-btn')) return;
    closeTrackMenu();
    closePlaylistMenu();
  });
  window.addEventListener('resize', () => {
    closeTrackMenu();
    closePlaylistMenu();
  });
  el('player-search')?.addEventListener('input', e => {
    state.searchQuery = String(e.target.value || '');
    closeTrackMenu();
    renderList();
  });

  render();
}


export function createPlayer(dependencies = {}) {
  Settings = dependencies.Settings;
  Neutralino = dependencies.Neutralino;
  Toast = dependencies.Toast || Toast;

  ({
    joinPath,
    fileTime,
    fileName,
    trackTitle,
    directoryName,
    normalizeRenameFileName,
    validateFileName,
    pathExists,
    formatBytes,
    sortTracks,
    rebuildQueue,
    mergeKnownTrackData,
    currentTrack,
    queueIndexByTrackId,
    scanAudioFiles
  } = createTrackList({ state, Neutralino, playlistSourceTracks, displayDuration }));

  ({
    getMp3StreamInfo,
    findFrameOffsetNear,
    ensureTrackMetadata,
    metadataLine,
    metadataPairs,
    ensureTrackDuration
  } = createMetadata({ state, Neutralino, Settings, savePlayerSettings, fileTime, displayDuration }));

  ({ clearAudioSource, loadTrackSource } = createAudioStream({
    state,
    Neutralino,
    setText,
    fileName,
    fileTime,
    getMp3StreamInfo,
    findFrameOffsetNear
  }));

  configurePlaylist({
    Toast,
    Settings,
    Neutralino,
    savePlayerSettings,
    sortTracks,
    clearAudioSource,
    currentTrack,
    hydrateTrackDurations,
    joinPath,
    directoryName,
    fileName,
    pathExists,
    validateFileName,
    Dialog
  });

  configurePlayerUi({
    currentTrack,
    displayDuration,
    displayCurrentTime,
    formatTime,
    formatBytes,
    metadataLine,
    metadataPairs,
    ensureTrackMetadata,
    savePlayerSettings,
    rebuildQueue,
    activePlaylist,
    activePlaylistName,
    playlistSourceTracks,
    renderPlaylistDropdown,
    sortLabel,
    sortDirectionLabel
  });

  return { init, loadLibrary, invalidate, playlistOptions, addFilesToPlaylist };
}
