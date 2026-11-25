import { signWbi, resetWbiCache } from './wbi.js';

const HDR = { 'Referer': 'https://www.bilibili.com/' };

async function biliGet(url, { signed = false, params = {} } = {}) {
  const target = signed
    ? url + '?' + await signWbi(params)
    : url + (Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '');
  let res = await fetch(target, { credentials: 'include', headers: HDR });
  if (!res.ok) throw new Error('B 站接口 HTTP ' + res.status);
  const json = await res.json();
  if (json.code === -403 || json.code === -352) {
    resetWbiCache();
    const retry = await fetch(signed ? url + '?' + await signWbi(params) : target,
      { credentials: 'include', headers: HDR });
    return retry.json();
  }
  return json;
}

/** 视频基础信息 + 分P 列表 */
export async function fetchVideoInfo(bvid) {
  const json = await biliGet('https://api.bilibili.com/x/web-interface/view', { params: { bvid } });
  if (json.code !== 0) throw new Error('获取视频信息失败: ' + (json.message || json.code));
  const d = json.data;
  return {
    bvid,
    aid: d.aid,
    title: d.title,
    desc: d.desc,
    duration: d.duration,
    owner: d.owner?.name,
    cover: d.pic,
    view: d.stat?.view,
    like: d.stat?.like,
    pubdate: d.pubdate,
    cid: d.cid,
    pages: (d.pages || []).map(pg => ({ cid: pg.cid, page: pg.page, part: pg.part, duration: pg.duration }))
  };
}

function pickSubtitle(subs) {
  if (!Array.isArray(subs) || !subs.length) return null;
  const pref = ['zh-Hans', 'zh-CN', 'zh', 'ai-zh', 'zh-Hant', 'zh-TW', 'ai-en', 'en'];
  for (const lan of pref) {
    const hit = subs.find(s => s.lan === lan || s.lan_doc === lan);
    if (hit) return hit;
  }
  return subs[0];
}

/** 获取字幕（优先 AI 字幕 / 中文 CC），返回 { lan, lines:[{from,to,text}] } */
export async function fetchSubtitle(bvid, cid) {
  const json = await biliGet('https://api.bilibili.com/x/player/wbi/v2', {
    signed: true,
    params: { bvid, cid }
  });
  if (json.code !== 0) throw new Error('获取播放器信息失败: ' + (json.message || json.code));
  const sub = pickSubtitle(json.data?.subtitle?.subtitles);
  if (!sub) return { ok: false, reason: 'no-subtitle', lan: null, lines: [] };

  let url = sub.subtitle_url || sub.subtitle_url_v2;
  if (!url) return { ok: false, reason: 'no-subtitle', lan: sub.lan, lines: [] };
  if (url.startsWith('//')) url = 'https:' + url;

  const res = await fetch(url, { headers: HDR });
  const data = await res.json();
  const lines = (data.body || []).map(b => ({
    from: b.from,
    to: b.to,
    text: (b.content || '').trim()
  })).filter(b => b.text);
  return { ok: lines.length > 0, lan: sub.lan, lanDoc: sub.lan_doc, lines };
}

/** 完整取字幕（自动处理分P） */
export async function getTranscript(info, page = 1) {
  const target = info.pages?.find(pg => pg.page === page) || { cid: info.cid };
  return fetchSubtitle(info.bvid, target.cid);
}

/** 合并字幕为带时间戳的纯文本，超长时按窗口抽样 */
export function transcriptToText(lines, { maxChars = 60000 } = {}) {
  const fmt = s => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return ('0' + m).slice(-2) + ':' + ('0' + sec).slice(-2);
  };
  const rows = lines.map(l => '[' + fmt(l.from) + '] ' + l.text);
  let text = rows.join('\n');
  if (text.length > maxChars) {
    const keepHead = rows.slice(0, 40);
    const keepTail = rows.slice(-20);
    const mid = rows.slice(40, -20);
    const need = maxChars - (keepHead.concat(keepTail).join('\n').length);
    const step = Math.max(1, Math.ceil(mid.join('\n').length / Math.max(need, 1)));
    const sampled = mid.filter((_, i) => i % step === 0);
    text = keepHead.concat(sampled, keepTail).join('\n');
  }
  return text;
}
