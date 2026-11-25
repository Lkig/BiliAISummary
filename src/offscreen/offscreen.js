// Offscreen 文档：解码音频 -> 16kHz 单声道 -> 切片 -> 16-bit PCM WAV(base64)
const TARGET_RATE = 16000;
const CHUNK_SECONDS = 100;   // DeepSeek ASR 上限 120s，留余量
const MAX_BYTES = 7.5 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'DECODE_AUDIO') {
        const out = await decodeAndChunk(msg.buffer, msg.mime);
        sendResponse({ ok: true, data: out });
      } else {
        sendResponse({ ok: false, error: '未知操作' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});

async function decodeAndChunk(arrayBuffer, mime) {
  const ctx = new OfflineAudioContext(1, TARGET_RATE, TARGET_RATE);
  const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const src = audio.getChannelData(0);
  // 线性重采样到 16k
  const ratio = audio.sampleRate / TARGET_RATE;
  const len = Math.floor(src.length / ratio);
  const pcm = new Float32Array(len);

  if (audio.numberOfChannels > 0 && ratio !== 1) {
    for (let i = 0; i < len; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, src.length - 1);
      const frac = pos - i0;
      pcm[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
  } else {
    pcm.set(src.subarray(0, len));
  }

  const perChunk = Math.max(1, Math.floor(TARGET_RATE * CHUNK_SECONDS));
  const chunks = [];
  for (let start = 0; start < len; start += perChunk) {
    const end = Math.min(start + perChunk, len);
    const slice = pcm.subarray(start, end);
    let wav = encodeWav(slice);
    if (wav.length > MAX_BYTES) {
      // 超限则对半再切
      const mid = Math.floor(slice.length / 2);
      chunks.push(toB64(encodeWav(slice.subarray(0, mid))));
      chunks.push(toB64(encodeWav(slice.subarray(mid))));
    } else {
      chunks.push(toB64(wav));
    }
  }
  return { chunks, seconds: Math.round(len / TARGET_RATE), sampleRate: audio.sampleRate };
}

function encodeWav(float32) {
  const buf = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + float32.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, float32.length * 2, true);
  let o = 44;
  for (let i = 0; i < float32.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function toB64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
