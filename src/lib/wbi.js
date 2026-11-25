import { md5 } from './md5.js';

// B 站 WBI 签名（2023.3 起 Web 端部分接口使用）
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

let cache = { key: null, at: 0 };

/** 从 nav 接口获取 img_key / sub_key，缓存 30 分钟 */
async function getWbiKeys() {
  const now = Date.now();
  if (cache.key && now - cache.at < 30 * 60 * 1000) return cache.key;

  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    credentials: 'include',
    headers: { 'Referer': 'https://www.bilibili.com/' }
  });
  const json = await res.json();
  const wbi = json?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) {
    throw new Error('无法获取 WBI 密钥（nav 接口返回异常），可能是风控或未登录');
  }
  const imgKey = wbi.img_url.split('/').pop().split('.')[0];
  const subKey = wbi.sub_url.split('/').pop().split('.')[0];
  cache = { key: { imgKey, subKey }, at: now };
  return cache.key;
}

/** 对参数做 WBI 签名，返回完整 query string */
export async function signWbi(params) {
  const { imgKey, subKey } = await getWbiKeys();
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const full = { ...params, wts };
  const query = Object.keys(full)
    .sort()
    .map(k => {
      const v = String(full[k]).replace(/[!'()*]/g, '');
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    })
    .join('&');
  const w_rid = md5(query + mixinKey);
  return query + '&w_rid=' + w_rid;
}

export function resetWbiCache() { cache = { key: null, at: 0 }; }
