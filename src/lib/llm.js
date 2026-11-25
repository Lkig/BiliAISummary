// 模型客户端
//
// 两条通道，都是 OpenAI 兼容协议：
//   api  —— 直连服务商（DeepSeek 官方、或任意兼容 API）
//   dsh  —— 走本机 DSH 中转（dsh-connect-* 系列插件提供的反代），
//           例如 dsh-connect-workbuddy / dsh-connect-trae 等，
//           地址形如 http://127.0.0.1:<port>/v1
//
import { getSettings } from './store.js';

function normBase(u, fallback = 'https://api.deepseek.com') {
  return (u || fallback).replace(/\/+$/, '');
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
      // DeepSeek 系模型默认开思考模式，token 会先耗在 reasoning 上导致正文为空
      ...(thinking ? { thinking: { type: thinking } } : {})
    })
  });

  const text = await res.text();
  if (!res.ok) throw new Error('LLM 请求失败 ' + res.status + ': ' + text.slice(0, 300));

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('LLM 返回非 JSON: ' + text.slice(0, 200));
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空（可能 token 不足）');
  return { content, usage: json.usage || null };
}

/** 解析当前通道，返回统一的 { name, baseUrl, apiKey, model } */
export async function resolveChannel() {
  const s = await getSettings();

  if (s.provider === 'dsh') {
    if (!s.dshUrl) {
      throw new Error('已选 DSH 通道，但没填中转地址（例如 http://127.0.0.1:18902/v1）');
    }
    return {
      name: 'DSH 中转',
      baseUrl: s.dshUrl,
      apiKey: s.dshKey || '',
      model: s.summarizerModel || ''
    };
  }

  // API 通道
  if (!s.apiKey && !s.baseUrl) throw new Error('未配置 API 地址与 Key');
  return {
    name: 'API 直连',
    baseUrl: s.baseUrl || 'https://api.deepseek.com',
    apiKey: s.apiKey,
    model: s.summarizerModel || 'deepseek-flash'
  };
}

export async function chat(opts) {
  const ch = await resolveChannel();
  const model = opts.model || ch.model;
  if (!model) {
    throw new Error('未选择模型，请到设置页点「拉取可用模型」后选择');
  }
  return postChat({
    baseUrl: ch.baseUrl,
    apiKey: ch.apiKey,
    thinking: 'disabled',
    ...opts,
    model
  });
}

/**
 * 拉取模型列表，供设置页下拉选择。
 * DSH 中转通常也实现 /v1/models；若返回空则交给调用方处理。
 */
export async function listModels({ provider, baseUrl, apiKey, dshUrl, dshKey } = {}) {
  let url, key;

  if (provider === 'dsh') {
    if (!dshUrl) throw new Error('未填 DSH 中转地址');
    url = normBase(dshUrl) + '/models';
    key = dshKey || '';
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
