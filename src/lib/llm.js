// 模型客户端：DeepSeek 官方 API / OFM 免费额度（OpenAI 兼容）
import { getSettings } from './store.js';

function normBase(u) {
  return (u || 'https://api.deepseek.com').replace(/\/+$/, '');
}

async function postChat({ baseUrl, apiKey, model, messages, temperature = 0.3, maxTokens, thinking }) {
  const res = await fetch(normBase(baseUrl) + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      // DeepSeek-V4 默认开思考模式，token 会先耗在 reasoning 上，正文可能为空
      ...(thinking ? { thinking: { type: thinking } } : {})
    })
  });

  const text = await res.text();
  if (!res.ok) throw new Error('LLM 请求失败 ' + res.status + ': ' + text.slice(0, 300));

  let json;
  try { json = JSON.parse(text); } catch { throw new Error('LLM 返回非 JSON: ' + text.slice(0, 200)); }

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空（可能 token 不足）');
  return { content, usage: json.usage || null };
}

/** 解析当前通道 */
export async function resolveChannel() {
  const s = await getSettings();
  if (s.provider === 'ofm') {
    if (!s.ofmUrl) throw new Error('已选 OFM 通道，但没填反代地址');
    return {
      name: 'OFM 免费额度',
      baseUrl: s.ofmUrl,
      apiKey: s.ofmKey || '',
      model: s.summarizerModel || 'openrouter/free'
    };
  }
  if (!s.apiKey) throw new Error('未配置 DeepSeek API Key');
  return {
    name: 'DeepSeek 官方',
    baseUrl: s.baseUrl || 'https://api.deepseek.com',
    apiKey: s.apiKey,
    model: s.summarizerModel || 'deepseek-flash'
  };
}

export async function chat(opts) {
  const ch = await resolveChannel();
  return postChat({
    baseUrl: ch.baseUrl,
    apiKey: ch.apiKey,
    thinking: 'disabled',
    ...opts,
    model: opts.model || ch.model
  });
}

/** 拉取模型列表，供设置页下拉选择 */
export async function listModels({ provider, baseUrl, apiKey, ofmUrl, ofmKey } = {}) {
  let url, key;
  if (provider === 'ofm') {
    if (!ofmUrl) throw new Error('未填 OFM 反代地址');
    url = normBase(ofmUrl) + '/models';
    key = ofmKey || '';
  } else {
    url = normBase(baseUrl) + '/models';
    key = apiKey || '';
  }

  const res = await fetch(url, {
    headers: key ? { Authorization: 'Bearer ' + key } : {},
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 200));

  const j = JSON.parse(text);
  return (j.data || j.models || [])
    .map(m => ({ id: m.id || m.name, owner: m.owned_by || '' }))
    .filter(m => m.id);
}
