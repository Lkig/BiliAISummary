// 提示词覆盖存储：用户可在设置页查看/编辑三档模板
import { DEFAULTS } from './promptDefaults.js';

const KEY = 'promptOverrides';

/** 读取用户覆盖（缺省回落默认） */
export async function getPromptOverrides() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || {};
}

/** 取某档的最终模板（用户覆盖优先） */
export async function getPrompt(depth) {
  const ov = await getPromptOverrides();
  return ov[depth]?.trim() ? ov[depth] : DEFAULTS[depth];
}

/** 保存某档模板 */
export async function setPrompt(depth, text) {
  const ov = await getPromptOverrides();
  if (!text || text.trim() === DEFAULTS[depth]) {
    delete ov[depth];               // 与默认一致则不存，跟随默认更新
  } else {
    ov[depth] = text;
  }
  await chrome.storage.local.set({ [KEY]: ov });
  return ov;
}

/** 恢复某档为默认 */
export async function resetPrompt(depth) {
  const ov = await getPromptOverrides();
  delete ov[depth];
  await chrome.storage.local.set({ [KEY]: ov });
}

/** 取全部（含默认），供编辑界面展示 */
export async function getAllPrompts() {
  const ov = await getPromptOverrides();
  const out = {};
  for (const d of Object.keys(DEFAULTS)) {
    out[d] = { text: ov[d]?.trim() ? ov[d] : DEFAULTS[d], customized: !!ov[d]?.trim() };
  }
  return out;
}
