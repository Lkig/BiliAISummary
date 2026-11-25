// Service Worker：消息路由、缓存、字幕/总结编排
import { getSettings, getCached, setCached } from './lib/store.js';
import { fetchVideoInfo, getTranscript } from './lib/bili.js';
import { transcribeVideo } from './lib/asr.js';
import { summarizeVideo } from './lib/summarizer.js';

import { chat } from './lib/llm.js';
import { SYSTEM_VISION, buildVisionPrompt } from './lib/prompts.js';

const inflight = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const data = await handle(msg, sender);
      sendResponse({ ok: true, data });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // 异步响应
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'GET_SETTINGS': return await getSettings();
    case 'GET_INFO': return await fetchVideoInfo(msg.bvid);
    case 'SUMMARIZE': return await doSummarize(msg);
    case 'VISION': return await doVision(msg);
    default: throw new Error('未知消息类型: ' + msg?.type);
  }
}

async function doSummarize({ bvid, page = 1, depth, force = false }) {
  const key = 'sum:' + bvid + ':' + page + ':' + (depth || 'default');
  if (!force) {
    const hit = await getCached(key);
    if (hit) return { ...hit, cached: true };
  }
  if (inflight.has(key)) return await inflight.get(key);

  const task = (async () => {
    const info = await fetchVideoInfo(bvid);
    const s = await getSettings();

    let sub = await getTranscript(info, page);
    let usedAsr = false;

    // 无字幕：若开启了 ASR 兜底，则走 DeepSeek 语音识别（0.39 元/小时）
    if (!sub.ok && s.asrEnabled && s.apiKey) {
      const target = info.pages?.find(pg => pg.page === page) || { cid: info.cid };
      sub = await transcribeVideo(bvid, target.cid);
      usedAsr = sub.ok;
    }

    if (!sub.ok) {
      const err = new Error('该视频没有可用字幕（UP 未上传 CC，也未生成 AI 字幕）。可在设置中开启「语音识别兜底」（DeepSeek ASR，约 0.39 元/小时）。');
      err.code = 'NO_SUBTITLE';
      throw err;
    }

    const result = await summarizeVideo({
      info, lines: sub.lines, depth: depth || s.depth, model: s.summarizerModel
    });
    const payload = {
      bvid, page,
      title: info.title,
      owner: info.owner,
      duration: info.duration,
      cover: info.cover,
      markdown: result.markdown,
      chunks: result.chunks,
      usage: result.usage,
      lan: sub.lan,
      usedAsr,
      lineCount: sub.lines.length,
      at: Date.now()
    };
    await setCached(key, payload);
    return payload;
  })();

  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

async function doVision({ bvid, images, times, title }) {
  const s = await getSettings();
  const content = [{ type: 'text', text: buildVisionPrompt({ title, times }) }];
  for (const dataUrl of images) {
    content.push({ type: 'image_url', image_url: { url: dataUrl } });
  }
  const res = await chat({
    model: s.visionModel,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_VISION },
      { role: 'user', content }
    ]
  });
  return { markdown: res.content, usage: res.usage };
}

// 首次安装打开设置页
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

