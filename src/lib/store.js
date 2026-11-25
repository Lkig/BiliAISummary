// 设置与缓存
const DEFAULTS = {
  provider: 'deepseek',          // deepseek | ofm
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  ofmUrl: 'http://127.0.0.1:18902/v1',
  ofmKey: '',
  summarizerModel: 'deepseek-flash',
  visionModel: 'deepseek-flash',
  depth: 'standard',             // quick | standard | deep
  autoSummarize: false,
  asrEnabled: true,
  cacheDays: 14
};

export async function getSettings() {
  const got = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(got.settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

const CACHE_PREFIX = 'sum:';

export async function getCached(key) {
  const k = CACHE_PREFIX + key;
  const got = await chrome.storage.local.get(k);
  const hit = got[k];
  if (!hit) return null;
  const { cacheDays } = await getSettings();
  if (Date.now() - hit.at > cacheDays * 86400000) {
    await chrome.storage.local.remove(k);
    return null;
  }
  return hit.value;
}

export async function setCached(key, value) {
  await chrome.storage.local.set({ [CACHE_PREFIX + key]: { at: Date.now(), value } });
}

export async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

