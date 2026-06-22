/**
 * resources/js/player/audio-stream.js
 * Audio source loading and progressive MP3 streaming.
 */

export function createAudioStream({ state, Neutralino, setText, fileName, fileTime, getMp3StreamInfo, findFrameOffsetNear }) {
  const mediaStreamInitialBytes = 512 * 1024;
  const mediaStreamChunkBytes = 1024 * 1024;
  const mediaStreamMaxBufferAhead = 120;
  const mediaStreamKeepBehind = 45;

  function mimeType(path) {
    const ext = fileName(path).split('.').pop()?.toLowerCase() || '';
    return ({
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      aac: 'audio/aac',
      flac: 'audio/flac'
    })[ext] || 'audio/mpeg';
  }

  function clearAudioSource(audio) {
    if (state.streamSession) {
      state.streamSession.cancelled = true;
      state.streamSession = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    state.sourceTrackId = '';
  }

  async function loadTrackAsBlob(audio, track, shouldPlay, options = {}) {
    if (!options.suppressStatus) setText('player-status-pill', '파일 준비 중');
    const bytes = await Neutralino.filesystem.readBinaryFile(track.path);

    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
    state.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType(track.path) }));
    audio.src = state.objectUrl;
    audio.load();
    state.sourceTrackId = track.id;
    if (shouldPlay) await audio.play();
  }

  function waitForSourceOpen(mediaSource) {
    if (mediaSource.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        mediaSource.removeEventListener('sourceopen', onOpen);
        mediaSource.removeEventListener('sourceended', onError);
        mediaSource.removeEventListener('sourceclose', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('media source closed'));
      };
      mediaSource.addEventListener('sourceopen', onOpen, { once: true });
      mediaSource.addEventListener('sourceended', onError, { once: true });
      mediaSource.addEventListener('sourceclose', onError, { once: true });
    });
  }

  function appendSourceBuffer(sourceBuffer, bytes, session) {
    if (session.cancelled) return Promise.reject(new Error('stream cancelled'));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        sourceBuffer.removeEventListener('updateend', onDone);
        sourceBuffer.removeEventListener('error', onError);
        sourceBuffer.removeEventListener('abort', onError);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('source buffer append failed'));
      };

      sourceBuffer.addEventListener('updateend', onDone, { once: true });
      sourceBuffer.addEventListener('error', onError, { once: true });
      sourceBuffer.addEventListener('abort', onError, { once: true });
      sourceBuffer.appendBuffer(bytes);
    });
  }

  function removeSourceBuffer(sourceBuffer, start, end, session) {
    if (session.cancelled || end <= start || sourceBuffer.updating) return Promise.resolve();

    return new Promise(resolve => {
      const cleanup = () => {
        sourceBuffer.removeEventListener('updateend', onDone);
        sourceBuffer.removeEventListener('error', onDone);
        sourceBuffer.removeEventListener('abort', onDone);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };

      sourceBuffer.addEventListener('updateend', onDone, { once: true });
      sourceBuffer.addEventListener('error', onDone, { once: true });
      sourceBuffer.addEventListener('abort', onDone, { once: true });
      try {
        sourceBuffer.remove(start, end);
      } catch {
        cleanup();
        resolve();
      }
    });
  }

  function bufferedAhead(audio) {
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    for (let i = 0; i < audio.buffered.length; i += 1) {
      const start = audio.buffered.start(i);
      const end = audio.buffered.end(i);
      if (current >= start && current <= end) return end - current;
      if (current < start) return end - start;
    }
    return 0;
  }

  async function waitForBufferRoom(audio, session) {
    while (!session.cancelled && bufferedAhead(audio) > mediaStreamMaxBufferAhead) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async function pruneOldBuffer(audio, sourceBuffer, session) {
    if (!audio.buffered.length || sourceBuffer.updating) return;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const removeBefore = current - mediaStreamKeepBehind;
    if (removeBefore <= 0) return;

    for (let i = 0; i < audio.buffered.length; i += 1) {
      const start = audio.buffered.start(i);
      const end = Math.min(audio.buffered.end(i), removeBefore);
      if (end > start) {
        await removeSourceBuffer(sourceBuffer, start, end, session);
        return;
      }
    }
  }

  async function loadTrackAsMediaStream(audio, track, shouldPlay, startTime = 0, options = {}) {
    if (!window.MediaSource || !MediaSource.isTypeSupported('audio/mpeg') || !/\.mp3$/i.test(track.path)) {
      throw new Error('progressive mp3 streaming is not supported');
    }

    const totalSize = Number(track.size) || 0;
    if (!totalSize) throw new Error('unknown file size');
    const streamInfo = await getMp3StreamInfo(track);
    if (!streamInfo.duration) throw new Error('unknown stream duration');
    const safeStartTime = Math.max(0, Math.min(Number(startTime) || 0, Math.max(0, streamInfo.duration - 1)));
    const approxOffset = streamInfo.audioStart + ((safeStartTime / streamInfo.duration) * (totalSize - streamInfo.audioStart));
    const startOffset = safeStartTime > 0 ? await findFrameOffsetNear(track, approxOffset) : streamInfo.audioStart;

    const session = { cancelled: false };
    state.streamSession = session;

    const mediaSource = new MediaSource();
    state.objectUrl = URL.createObjectURL(mediaSource);
    audio.src = state.objectUrl;
    audio.load();
    state.sourceTrackId = track.id;
    if (!options.suppressStatus) setText('player-status-pill', '스트리밍 준비 중');

    await waitForSourceOpen(mediaSource);
    if (session.cancelled) return;
    mediaSource.duration = streamInfo.duration;

    const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    sourceBuffer.mode = 'sequence';
    sourceBuffer.timestampOffset = safeStartTime;

    const firstSize = Math.min(mediaStreamInitialBytes, totalSize - startOffset);
    const firstBytes = await Neutralino.filesystem.readBinaryFile(track.path, { pos: startOffset, size: firstSize });
    await appendSourceBuffer(sourceBuffer, firstBytes, session);

    if (session.cancelled) return;
    if (safeStartTime > 0) audio.currentTime = safeStartTime;
    if (!options.suppressStatus) setText('player-status-pill', shouldPlay ? '지금 재생 중' : '재생 준비 완료');
    if (shouldPlay) await audio.play();

    void (async () => {
      for (let pos = startOffset + firstSize; pos < totalSize && !session.cancelled; pos += mediaStreamChunkBytes) {
        await waitForBufferRoom(audio, session);
        await pruneOldBuffer(audio, sourceBuffer, session);
        const size = Math.min(mediaStreamChunkBytes, totalSize - pos);
        const bytes = await Neutralino.filesystem.readBinaryFile(track.path, { pos, size });
        await appendSourceBuffer(sourceBuffer, bytes, session);
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (!session.cancelled && mediaSource.readyState === 'open' && !sourceBuffer.updating) {
        try { mediaSource.endOfStream(); } catch {}
      }
    })().catch(() => {});
  }

  async function loadTrackSource(audio, track, shouldPlay, options = {}) {
    if (!track.size) {
      try {
        const stats = await Neutralino.filesystem.getStats(track.path);
        track.size = Number(stats.size) || 0;
        track.modifiedAt = fileTime(stats.modifiedAt) || track.modifiedAt;
      } catch {}
    }

    if (/\.mp3$/i.test(track.path)) {
      try {
        await loadTrackAsMediaStream(audio, track, shouldPlay, options.startTime || 0, options);
        return;
      } catch {
        clearAudioSource(audio);
        if (Number(track.size) > 512 * 1024 * 1024) {
          throw new Error('스트리밍 재생을 시작할 수 없습니다.');
        }
      }
    }

    await loadTrackAsBlob(audio, track, shouldPlay, options);
  }

  return { clearAudioSource, loadTrackSource };
}
