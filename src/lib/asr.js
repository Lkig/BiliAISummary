// 无字幕兜底：拉取音频流 -> offscreen 解码切片 -> DeepSeek ASR 逐段转写
import { signWbi } from './wbi.js';
import { getSettings } from './store.js';

const HDR = { 'Referer': 'https://www.bilibili.com/' };

let offscreenReady = null;
async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const has = await chrome.offscreen.hasDocument?.().catch(() => false);
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '解码 B 站视频音轨并转成 16kHz WAV 以便调用语音识别'
      });
    }
  })();
  return offscreenReady;
}

async function askOffscreen(buffer, mime) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'DECODE_AUDIO',
    buffer,
    mime
  });
  if (!res?.ok) throw new Error('音频解码失败: ' + (res?.error || '未知'));
  return res.data;
}

/** 取音频流地址（DASH 音频，优先最低码率以省流量） */
export async function fetchAudioUrl(bvid, cid) {
  const q = await signWbi({ bvid, cid, fnval: 16, fnver: 0, fourk: 0 });
  const res = await fetch('https://api.bilibili.com/x/player/wbi/playurl?' + q, {
    credentials: 'include', headers: HDR
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error('获取音频流失败: ' + (json.message || json.code));
  const audios = json.data?.dash?.audio || [];
  if (!audios.length) throw new Error('该视频没有可用音轨（可能是付费/番剧/需登录）');
  // 按码率升序，取最小的
  audios.sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
  const url = audios[0].baseUrl || audios[0].base_url;
  return url.startsWith('//') ? 'https:' + url : url;
}

async function transcribeChunk(base64Wav, apiKey, baseUrl) {
  const bin = atob(base64Wav);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'chunk.wav');

  const res = await fetch((baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/v1/tools/asr', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    body: form
  });
  const text = await res.text();
  if (!res.ok) throw new Error('ASR 失败 ' + res.status + ': ' + text.slice(0, 200));
  const json = JSON.parse(text);
  return json.text || '';
}

/**
 * 用语音识别生成字幕行
 * @returns {{ok:boolean, lines:Array<{from:number,to:number,text:string}>, lan:string, seconds:number}}
 */
export async function transcribeVideo(bvid, cid, onProgress) {
  const s = await getSettings();
  if (!s.apiKey) throw new Error('未配置 DeepSeek API Key，无法使用语音识别兜底');

  onProgress?.('下载音轨', 0, 1);
  const audioUrl = await fetchAudioUrl(bvid, cid);
  const audioRes = await fetch(audioUrl, { headers: HDR });
  if (!audioRes.ok) throw new Error('音轨下载失败 HTTP ' + audioRes.status);
  const buffer = await audioRes.arrayBuffer();

  onProgress?.('解码音频', 0, 1);
  const { chunks, seconds } = await askOffscreen(buffer, 'audio/mp4');

  const lines = [];
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.('语音识别中', i, chunks.length);
    const text = await transcribeChunk(chunks[i], s.apiKey, s.baseUrl);
    // ASR 不返回逐句时间戳，按段均分近似
    const segSeconds = Math.min(100, seconds - offset);
    const sentences = text.split(/[。！？!?\n]/).map(t => t.trim()).filter(Boolean);
    const per = sentences.length ? segSeconds / sentences.length : segSeconds;
    sentences.forEach((sn, idx) => {
      lines.push({
        from: offset + idx * per,
        to: offset + (idx + 1) * per,
        text: sn + '。'
      });
    });
    offset += segSeconds;
  }
  onProgress?.('语音识别中', chunks.length, chunks.length);
  return { ok: lines.length > 0, lines, lan: 'asr', seconds };
}
