import { chat } from './llm.js';
import { transcriptToText } from './bili.js';
import { SYSTEM_SUMMARY, buildChunkPrompt, buildFinalPrompt } from './prompts.js';
import { getPrompt } from './promptStore.js';

const CHUNK_CHARS = 12000;      // 单段字幕字符数
const CONCURRENCY = 3;

function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return ('0' + m).slice(-2) + ':' + ('0' + sec).slice(-2);
}

/** 把字幕按时间窗口切成若干段 */
function splitChunks(lines, chunkChars = CHUNK_CHARS) {
  const chunks = [];
  let cur = [], curLen = 0;
  for (const line of lines) {
    cur.push(line);
    curLen += line.text.length + 8;
    if (curLen >= chunkChars) { chunks.push(cur); cur = []; curLen = 0; }
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((cs, i) => ({
    index: i,
    lines: cs,
    from: cs[0].from,
    to: cs[cs.length - 1].to,
    text: transcriptToText(cs, { maxChars: chunkChars + 2000 })
  }));
}

async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length);
  let cursor = 0, done = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 生成视频总结
 * @param {object} p
 * @param {object} p.info 视频信息
 * @param {Array} p.lines 字幕行
 * @param {string} p.depth quick|standard|deep
 * @param {(stage:string, done:number, total:number)=>void} [p.onProgress]
 */
/**
 * 各深度的参数差异：
 * - quick    ：分段更大（少调用）、输出短，只要结论
 * - standard ：中等分段，标准结构
 * - deep     ：分段更细（保留更多细节）、输出长，含论证与争议
 */
const DEPTH_CONFIG = {
  quick:    { chunkChars: 20000, chunkMaxTokens: 600,  finalMaxTokens: 700 },
  standard: { chunkChars: 12000, chunkMaxTokens: 1200, finalMaxTokens: 3000 },
  deep:     { chunkChars: 8000,  chunkMaxTokens: 1600, finalMaxTokens: 6000 }
};

export async function summarizeVideo({ info, lines, depth = 'standard', model, onProgress }) {
  const cfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;
  // 取用户自定义模板（未自定义则用默认）
  const template = await getPrompt(depth);
  const chunks = splitChunks(lines, cfg.chunkChars);
  const digestParts = [];

  if (chunks.length === 1 && depth === 'quick') {
    // 短视频快速模式：直接单次总结
    const res = await chat({
      model,
      messages: [
        { role: 'system', content: SYSTEM_SUMMARY },
        { role: 'user', content: buildFinalPrompt({
            title: info.title, upName: info.owner,
            duration: fmtTime(info.duration), depth, template,
            digest: '【全片字幕】\n' + chunks[0].text
          }) }
      ]
    });
    return { markdown: res.content, chunks: 1, depth, usage: res.usage };
  }

  onProgress?.('分段理解中', 0, chunks.length);
  const partials = await mapLimit(chunks, CONCURRENCY, async (chunk) => {
    const res = await chat({
      model,
      messages: [
        { role: 'system', content: SYSTEM_SUMMARY },
        { role: 'user', content: buildChunkPrompt({
            title: info.title, upName: info.owner,
            part: '第 ' + (chunk.index + 1) + '/' + chunks.length + ' 段',
            timeRange: fmtTime(chunk.from) + ' - ' + fmtTime(chunk.to),
            text: chunk.text
          }) }
      ],
      maxTokens: cfg.chunkMaxTokens
    });
    return { from: chunk.from, text: res.content, usage: res.usage };
  }, (d, t) => onProgress?.('分段理解中', d, t));

  partials.forEach((p, i) => {
    digestParts.push('### 片段 ' + (i + 1) + ' [' + fmtTime(p.from) + ']\n' + p.text);
  });

  onProgress?.('汇总成文', chunks.length, chunks.length);
  const final = await chat({
    model,
    messages: [
      { role: 'system', content: SYSTEM_SUMMARY },
      { role: 'user', content: buildFinalPrompt({
          title: info.title, upName: info.owner,
          duration: fmtTime(info.duration), depth, template,
          digest: digestParts.join('\n\n')
        }) }
    ],
    maxTokens: cfg.finalMaxTokens
  });

  const usage = partials.reduce((acc, p) => ({
    prompt: (acc.prompt || 0) + (p.usage?.prompt_tokens || 0),
    completion: (acc.completion || 0) + (p.usage?.completion_tokens || 0)
  }), { prompt: final.usage?.prompt_tokens || 0, completion: final.usage?.completion_tokens || 0 });

  return { markdown: final.content, chunks: chunks.length, depth, usage };
}

