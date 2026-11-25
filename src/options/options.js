import { getSettings, saveSettings, clearCache } from '../lib/store.js';
import { listModels } from '../lib/llm.js';
import { getAllPrompts, setPrompt, resetPrompt } from '../lib/promptStore.js';
import { DEFAULTS } from '../lib/promptDefaults.js';

const FIELDS = [
  'provider', 'baseUrl', 'apiKey', 'ofmUrl', 'ofmKey',
  'summarizerModel', 'visionModel', 'depth', 'cacheDays', 'autoSummarize'
];
const $ = (id) => document.getElementById(id);

function syncChannelVisibility() {
  const p = $('provider').value;
  $('groupDeepseek').style.display = p === 'deepseek' ? '' : 'none';
  $('groupOfm').style.display = p === 'ofm' ? '' : 'none';
}

function fill(s) {
  for (const f of FIELDS) {
    const el = $(f);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!s[f];
    else el.value = s[f] ?? '';
  }
}

function collect() {
  const out = {};
  for (const f of FIELDS) {
    const el = $(f);
    if (!el) continue;
    if (el.type === 'checkbox') out[f] = el.checked;
    else if (f === 'cacheDays') out[f] = parseInt(el.value, 10) || 14;
    else out[f] = el.value.trim();
  }
  return out;
}

function fillModelSelect(ids, cur) {
  for (const [sel, keep] of [['summarizerModel', cur.summarizerModel],
                             ['visionModel', cur.visionModel]]) {
    const el = $(sel);
    el.innerHTML = '';
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id; o.textContent = id;
      el.appendChild(o);
    }
    if (keep && !ids.includes(keep)) {
      const o = document.createElement('option');
      o.value = keep; o.textContent = keep + '（当前）';
      el.insertBefore(o, el.firstChild);
    }
    if (keep) el.value = keep;
  }
}

const OFM_FALLBACK = ['openrouter/free', 'nvidia/nemotron-3.5-super-vl:free', 'kilo-auto/free'];

(async function init() {
  const s = await getSettings();
  fill(s);
  syncChannelVisibility();

  const preset = [...new Set([s.summarizerModel, s.visionModel].filter(Boolean))];
  fillModelSelect(preset.length ? preset : ['deepseek-flash'], {
    summarizerModel: s.summarizerModel, visionModel: s.visionModel
  });

  $('provider').onchange = () => {
    syncChannelVisibility();
    $('fetchStatus').textContent = '已切换通道，请重新拉取模型';
    $('fetchStatus').className = '';
  };

  $('fetchModels').onclick = async () => {
    const st = $('fetchStatus'), btn = $('fetchModels');
    btn.disabled = true; st.className = ''; st.textContent = '拉取中…';
    try {
      const c = collect();
      const models = await listModels({
        provider: c.provider,
        baseUrl: c.baseUrl, apiKey: c.apiKey,
        ofmUrl: c.ofmUrl, ofmKey: c.ofmKey
      });

      if (!models.length) {
        if (c.provider === 'ofm') {
          fillModelSelect(OFM_FALLBACK, c);
          st.textContent = '该通道不返回列表，已填入内置候选';
          st.className = 'ok';
          return;
        }
        throw new Error('返回了 0 个模型');
      }
      const ids = models.map(m => m.id);
      fillModelSelect(ids, c);
      st.textContent = '已拉取 ' + ids.length + ' 个模型';
      st.className = 'ok';
    } catch (e) {
      st.textContent = '失败：' + e.message;
      st.className = 'err';
    } finally {
      btn.disabled = false;
    }
  };

  $('testLlm').onclick = async () => {
    const st = $('testLlmStatus'), btn = $('testLlm');
    btn.disabled = true; st.textContent = '测试中…'; st.className = '';
    try {
      const c = collect();
      const base = c.provider === 'ofm' ? c.ofmUrl : c.baseUrl;
      const key = c.provider === 'ofm' ? c.ofmKey : c.apiKey;
      const res = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: 'Bearer ' + key } : {})
        },
        body: JSON.stringify({
          model: c.summarizerModel || 'deepseek-flash',
          messages: [{ role: 'user', content: '只回复：ok' }],
          max_tokens: 30,
          thinking: { type: 'disabled' }
        })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(res.status + ' ' + text.slice(0, 160));
      st.textContent = '连通正常'; st.className = 'ok';
    } catch (e) {
      st.textContent = '失败：' + e.message; st.className = 'err';
    } finally {
      btn.disabled = false;
    }
  };

  $('save').onclick = async () => {
    await saveSettings(collect());
    const st = $('saveStatus');
    st.textContent = '已保存'; st.className = 'ok';
    setTimeout(() => st.textContent = '', 2000);
  };

  $('clearCache').onclick = async () => {
    const n = await clearCache();
    const st = $('cacheStatus');
    st.textContent = '已清除 ' + n + ' 条'; st.className = 'ok';
  };

  /* 提示词编辑 */
  let promptCache = {};
  async function loadPrompt() {
    promptCache = await getAllPrompts();
    const d = $('promptDepth').value;
    const item = promptCache[d];
    $('promptText').value = item ? item.text : (DEFAULTS[d] || '');
    $('promptStatus').textContent = item?.customized ? '（已自定义）' : '（默认模板）';
    $('promptStatus').className = item?.customized ? 'ok' : '';
  }
  $('promptDepth').onchange = loadPrompt;
  $('savePrompt').onclick = async () => {
    await setPrompt($('promptDepth').value, $('promptText').value);
    await loadPrompt();
    $('promptStatus').textContent = '已保存'; $('promptStatus').className = 'ok';
  };
  $('resetPrompt').onclick = async () => {
    await resetPrompt($('promptDepth').value);
    await loadPrompt();
    $('promptStatus').textContent = '已恢复默认'; $('promptStatus').className = 'ok';
  };
  await loadPrompt();
})();
