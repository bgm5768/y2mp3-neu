/**
 * resources/js/player/player-state.js
 * Shared player state. Playlist code imports this object instead of owning state.
 */

export const playerState = {
  initialized: false,
  loadedPath: '',
  tracks: [],
  queue: [],
  queuePosition: -1,
  searchQuery: '',
  sortKey: 'title',
  sortDirection: 'asc',
  activePlaylistId: 'all',
  playlists: [],
  sortMetricLoading: false,
  durationHydrationToken: 0,
  orderMode: 'normal',
  repeatMode: 'stop-current',
  objectUrl: '',
  coverObjectUrl: '',
  coverTrackId: '',
  sourceTrackId: '',
  streamSession: null,
  streamInfoPromises: new Map(),
  isLoadingTrack: false,
  isSeeking: false,
  isStreamSeeking: false,
  seekPreviewTime: null,
  restoredPreviewTime: null,
  metadataPromises: new Map(),
  lastSavedPositionAt: 0,
  saveTimer: null,
  pendingSave: {},
  restoredLastTrack: false,
  restoringPosition: null,
  openMenuTrackId: '',
  trackLoadToken: 0
};
