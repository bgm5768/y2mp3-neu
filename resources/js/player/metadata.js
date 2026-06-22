/**
 * resources/js/player/metadata.js
 * Audio metadata and duration extraction.
 */

export function createMetadata({ state, Neutralino, Settings, savePlayerSettings, fileTime, displayDuration }) {
  const mp3Bitrates = {
    V1L1: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
    V1L2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
    V1L3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
    V2L1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
    V2L2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
    V2L3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
  };

  function parseMp3FrameHeader(bytes, offset) {
    if (offset + 4 > bytes.length) return null;
    const b1 = bytes[offset];
    const b2 = bytes[offset + 1];
    const b3 = bytes[offset + 2];
    const b4 = bytes[offset + 3];
    if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;

    const versionBits = (b2 >> 3) & 0x03;
    const layerBits = (b2 >> 1) & 0x03;
    const bitrateIndex = (b3 >> 4) & 0x0f;
    const sampleRateIndex = (b3 >> 2) & 0x03;
    const padding = (b3 >> 1) & 0x01;
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

    const version = versionBits === 3 ? 1 : 2;
    const layer = 4 - layerBits;
    const bitrateKey = `${version === 1 ? 'V1' : 'V2'}L${layer}`;
    const bitrate = (mp3Bitrates[bitrateKey]?.[bitrateIndex] || 0) * 1000;
    const sampleRateBase = [44100, 48000, 32000][sampleRateIndex];
    const sampleRate = version === 1 ? sampleRateBase : sampleRateBase / (versionBits === 2 ? 2 : 4);
    if (!bitrate || !sampleRate) return null;

    const frameLength = layer === 1
      ? Math.floor(((12 * bitrate / sampleRate) + padding) * 4)
      : Math.floor(((version === 1 && layer === 3 ? 144 : 72) * bitrate / sampleRate) + padding);

    return {
      bitrate,
      sampleRate,
      frameLength,
      offset,
      version,
      layer,
      channelMode: (b4 >> 6) & 0x03,
      samplesPerFrame: layer === 1 ? 384 : (layer === 3 && version !== 1 ? 576 : 1152)
    };
  }

  function findMp3FrameInBytes(bytes, start = 0) {
    for (let i = Math.max(0, start); i + 4 < bytes.length; i += 1) {
      const frame = parseMp3FrameHeader(bytes, i);
      if (!frame || frame.frameLength <= 4 || i + frame.frameLength + 4 >= bytes.length) continue;
      const next = parseMp3FrameHeader(bytes, i + frame.frameLength);
      if (next) return frame;
    }
    return null;
  }

  async function getMp3StreamInfo(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo;
    if (state.streamInfoPromises.has(track.id)) return state.streamInfoPromises.get(track.id);

    const promise = (async () => {
      const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
      let audioStart = 0;
      const id3Header = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: Math.min(10, totalSize) }));
      if (decodeLatin1(id3Header.slice(0, 3)) === 'ID3' && id3Header.length >= 10) {
        audioStart = Math.min(syncSafeToInt(id3Header, 6) + 10, Math.max(0, totalSize - 4));
      }

      const scanSize = Math.min(512 * 1024, totalSize - audioStart);
      if (scanSize <= 0) throw new Error('MP3 오디오 데이터를 찾을 수 없습니다.');
      const scan = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: audioStart, size: scanSize }));
      const firstFrame = findMp3FrameInBytes(scan, 0);
      if (!firstFrame) throw new Error('MP3 프레임 정보를 찾을 수 없습니다.');

      audioStart += firstFrame.offset;
      const audioBytes = Math.max(0, totalSize - audioStart);
      const vbrDuration = mp3VbrDuration(scan, firstFrame);
      const duration = vbrDuration || (audioBytes > 0 ? (audioBytes * 8) / firstFrame.bitrate : 0);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('MP3 재생시간을 계산할 수 없습니다.');
      track.streamInfo = {
        audioStart,
        bitrate: firstFrame.bitrate,
        duration,
        totalSize
      };
      const settings = Settings.get();
      const isLastTrack = track.id === String(settings.playerLastTrackId || '').toLowerCase()
        || track.path.toLowerCase() === String(settings.playerLastTrackPath || '').toLowerCase();
      if (isLastTrack) {
        savePlayerSettings({ playerLastDuration: duration }, { immediate: true });
      }
      return track.streamInfo;
    })().finally(() => {
      state.streamInfoPromises.delete(track.id);
    });

    state.streamInfoPromises.set(track.id, promise);
    return promise;
  }

  async function findFrameOffsetNear(track, approxOffset) {
    const info = await getMp3StreamInfo(track);
    const totalSize = info.totalSize || Number(track.size) || 0;
    const windowStart = Math.max(info.audioStart, Math.floor(approxOffset) - 4096);
    const size = Math.min(256 * 1024, totalSize - windowStart);
    if (size <= 0) return info.audioStart;

    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: windowStart, size }));
    const frame = findMp3FrameInBytes(bytes, windowStart === info.audioStart ? 0 : 4096);
    return frame ? windowStart + frame.offset : Math.max(info.audioStart, Math.floor(approxOffset));
  }

  function syncSafeToInt(bytes, offset = 0) {
    return ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f);
  }

  function uint32be(bytes, offset = 0) {
    return ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
  }

  function uint32le(bytes, offset = 0) {
    return (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>> 0;
  }

  function uint64beNumber(bytes, offset = 0) {
    return uint32be(bytes, offset) * 4294967296 + uint32be(bytes, offset + 4);
  }

  function decodeLatin1(bytes) {
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
  }

  function decodeUtf16(bytes, littleEndian) {
    const chars = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) continue;
      chars.push(String.fromCharCode(code));
    }
    return chars.join('');
  }

  function cleanMetadataText(value) {
    return String(value || '')
      .replace(/\u0000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeId3Text(payload) {
    if (!payload || payload.length === 0) return '';
    const encoding = payload[0];
    let bytes = payload.slice(1);

    if (encoding === 1) {
      let littleEndian = false;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        littleEndian = true;
        bytes = bytes.slice(2);
      } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        bytes = bytes.slice(2);
      }
      return cleanMetadataText(decodeUtf16(bytes, littleEndian));
    }

    if (encoding === 2) return cleanMetadataText(decodeUtf16(bytes, false));

    try {
      const decoder = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1');
      return cleanMetadataText(decoder.decode(bytes));
    } catch {
      return cleanMetadataText(decodeLatin1(bytes));
    }
  }

  function findTerminator(bytes, start, encoding) {
    if (encoding === 1 || encoding === 2) {
      for (let i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
      }
      return -1;
    }

    for (let i = start; i < bytes.length; i += 1) {
      if (bytes[i] === 0) return i;
    }
    return -1;
  }

  function parseCommentFrame(payload) {
    if (!payload || payload.length < 5) return '';
    const encoding = payload[0];
    let cursor = 4;
    const descEnd = findTerminator(payload, cursor, encoding);
    if (descEnd >= 0) cursor = descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1);
    return decodeId3Text(Uint8Array.from([encoding, ...payload.slice(cursor)]));
  }

  function parseApicFrame(payload) {
    if (!payload || payload.length < 5) return null;
    const encoding = payload[0];
    let cursor = 1;
    const mimeEnd = findTerminator(payload, cursor, 0);
    if (mimeEnd < 0) return null;
    const mime = cleanMetadataText(decodeLatin1(payload.slice(cursor, mimeEnd))) || 'image/jpeg';
    cursor = mimeEnd + 1;
    cursor += 1; // picture type
    const descEnd = findTerminator(payload, cursor, encoding);
    cursor = descEnd >= 0 ? descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1) : cursor;
    const data = payload.slice(cursor);
    return data.length ? { mime, data } : null;
  }

  async function readId3Metadata(path, size) {
    const empty = {
      title: '',
      artist: '',
      album: '',
      year: '',
      genre: '',
      track: '',
      comment: '',
      cover: null
    };

    if (!/\.mp3$/i.test(path)) return empty;

    let header;
    try {
      header = new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos: 0, size: 10 }));
    } catch {
      return empty;
    }

    if (header.length < 10 || decodeLatin1(header.slice(0, 3)) !== 'ID3') return empty;

    const version = header[3];
    const tagSize = syncSafeToInt(header, 6) + 10;
    const maxRead = Math.min(Math.max(tagSize, 10), Math.min(Number(size) || tagSize, 6 * 1024 * 1024));
    let data;
    try {
      data = new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos: 0, size: maxRead }));
    } catch {
      return empty;
    }

    const metadata = { ...empty };
    const frameMap = {
      TIT2: 'title',
      TPE1: 'artist',
      TALB: 'album',
      TDRC: 'year',
      TYER: 'year',
      TCON: 'genre',
      TRCK: 'track'
    };

    let offset = 10;
    const end = Math.min(data.length, tagSize);
    while (offset + 10 <= end) {
      const id = decodeLatin1(data.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;

      const frameSize = version === 4 ? syncSafeToInt(data, offset + 4) : uint32be(data, offset + 4);
      if (!frameSize || offset + 10 + frameSize > data.length) break;

      const payload = data.slice(offset + 10, offset + 10 + frameSize);
      if (frameMap[id]) {
        metadata[frameMap[id]] = decodeId3Text(payload);
      } else if (id === 'COMM') {
        metadata.comment = parseCommentFrame(payload);
      } else if (id === 'APIC') {
        metadata.cover = parseApicFrame(payload);
      }

      offset += 10 + frameSize;
    }

    return metadata;
  }

  function applyTrackMetadata(track, metadata) {
    if (!track || !metadata) return;

    track.title = metadata.title || track.title;
    track.artist = metadata.artist || track.artist;
    track.album = metadata.album || track.album;
    track.year = metadata.year || track.year;
    track.genre = metadata.genre || track.genre;
    track.track = metadata.track || track.track;
    track.comment = metadata.comment || track.comment;
    track.cover = metadata.cover || track.cover;
    track.metadataLoaded = true;
  }

  async function ensureTrackMetadata(track) {
    if (!track || track.metadataLoaded) return track;
    if (state.metadataPromises.has(track.id)) return state.metadataPromises.get(track.id);

    const promise = (async () => {
      try {
        if (!track.size) {
          const stats = await Neutralino.filesystem.getStats(track.path);
          track.size = Number(stats.size) || 0;
          track.modifiedAt = fileTime(stats.modifiedAt) || track.modifiedAt;
        }

        applyTrackMetadata(track, await readId3Metadata(track.path, track.size));
      } catch {
        track.metadataLoaded = true;
      } finally {
        state.metadataPromises.delete(track.id);
      }

      return track;
    })();

    state.metadataPromises.set(track.id, promise);
    return promise;
  }

  function metadataLine(track) {
    return [track.album].filter(Boolean).join(' · ');
  }

  function metadataPairs(track) {
    return [
      ['앨범', track.album],
      ['트랙', track.track],
      ['코멘트', track.comment]
    ].filter(([, value]) => !!value);
  }

  function mp3VbrDuration(scan, frame) {
    const sideInfoSize = frame.layer === 3
      ? (frame.version === 1 ? (frame.channelMode === 3 ? 17 : 32) : (frame.channelMode === 3 ? 9 : 17))
      : 0;
    const xingOffset = frame.offset + 4 + sideInfoSize;
    const id = decodeLatin1(scan.slice(xingOffset, xingOffset + 4));
    if (id === 'Xing' || id === 'Info') {
      const flags = uint32be(scan, xingOffset + 4);
      if (flags & 0x01) {
        const frames = uint32be(scan, xingOffset + 8);
        if (frames > 0) return (frames * frame.samplesPerFrame) / frame.sampleRate;
      }
    }

    const vbriOffset = frame.offset + 36;
    if (decodeLatin1(scan.slice(vbriOffset, vbriOffset + 4)) === 'VBRI') {
      const frames = uint32be(scan, vbriOffset + 14);
      if (frames > 0) return (frames * frame.samplesPerFrame) / frame.sampleRate;
    }
    return 0;
  }

  function mp4DurationFromBytes(bytes) {
    for (let i = 4; i + 32 < bytes.length; i += 1) {
      if (decodeLatin1(bytes.slice(i, i + 4)) !== 'mvhd') continue;
      const version = bytes[i + 4];
      const timescale = version === 1 ? uint32be(bytes, i + 24) : uint32be(bytes, i + 16);
      const duration = version === 1 ? uint64beNumber(bytes, i + 28) : uint32be(bytes, i + 20);
      if (timescale > 0 && duration > 0) return duration / timescale;
    }
    return 0;
  }

  async function getMp4Duration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const readSize = Math.min(totalSize, 8 * 1024 * 1024);
    const chunks = [];
    if (readSize > 0) {
      chunks.push(new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: readSize })));
    }
    if (totalSize > readSize) {
      chunks.push(new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: Math.max(0, totalSize - readSize), size: readSize })));
    }

    for (const chunk of chunks) {
      const duration = mp4DurationFromBytes(chunk);
      if (duration > 0) {
        track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
        return duration;
      }
    }
    return 0;
  }

  async function getWavDuration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const readSize = Math.min(totalSize, 256 * 1024);
    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: readSize }));
    if (decodeLatin1(bytes.slice(0, 4)) !== 'RIFF' || decodeLatin1(bytes.slice(8, 12)) !== 'WAVE') return 0;

    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= bytes.length) {
      const id = decodeLatin1(bytes.slice(offset, offset + 4));
      const size = uint32le(bytes, offset + 4);
      const dataOffset = offset + 8;
      if (id === 'fmt ' && dataOffset + 16 <= bytes.length) {
        byteRate = uint32le(bytes, dataOffset + 8);
      } else if (id === 'data') {
        dataSize = size || Math.max(0, totalSize - dataOffset);
        break;
      }
      offset = dataOffset + size + (size % 2);
    }
    const duration = byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
    if (duration > 0) track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
    return duration;
  }

  async function getFlacDuration(track) {
    if (track.streamInfo && !track.streamInfo.estimated) return track.streamInfo.duration || 0;
    const totalSize = Number(track.size) || Number((await Neutralino.filesystem.getStats(track.path)).size) || 0;
    const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(track.path, { pos: 0, size: Math.min(totalSize, 128 * 1024) }));
    if (decodeLatin1(bytes.slice(0, 4)) !== 'fLaC') return 0;
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const type = bytes[offset] & 0x7f;
      const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      const dataOffset = offset + 4;
      if (type === 0 && length >= 34 && dataOffset + 18 <= bytes.length) {
        const sampleRate = (bytes[dataOffset + 10] << 12) | (bytes[dataOffset + 11] << 4) | (bytes[dataOffset + 12] >> 4);
        const highSamples = bytes[dataOffset + 13] & 0x0f;
        const lowSamples = uint32be(bytes, dataOffset + 14);
        const totalSamples = highSamples * 4294967296 + lowSamples;
        const duration = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
        if (duration > 0) track.streamInfo = { ...(track.streamInfo || {}), duration, totalSize };
        return duration;
      }
      offset = dataOffset + length;
    }
    return 0;
  }

  async function ensureTrackDuration(track) {
    if (!track || displayDuration(track)) return displayDuration(track);
    try {
      if (/\.mp3$/i.test(track.path)) {
        const info = await getMp3StreamInfo(track);
        return Number(info.duration) || 0;
      }
      if (/\.(m4a|mp4|aac)$/i.test(track.path)) {
        return await getMp4Duration(track);
      }
      if (/\.wav$/i.test(track.path)) {
        return await getWavDuration(track);
      }
      if (/\.flac$/i.test(track.path)) {
        return await getFlacDuration(track);
      }
    } catch {}
    return 0;
  }

  return {
    getMp3StreamInfo,
    findFrameOffsetNear,
    ensureTrackMetadata,
    metadataLine,
    metadataPairs,
    ensureTrackDuration
  };
}
