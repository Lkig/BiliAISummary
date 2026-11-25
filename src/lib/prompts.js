// 提示词模板 —— 三档深度各有独立的结构与要求
import { DEFAULTS } from './promptDefaults.js';

const DEPTH_TEMPLATES = DEFAULTS;

export const SYSTEM_SUMMARY =
  '你是一位专业的中文视频内容分析师。你的任务是把视频字幕整理成结构清晰、信息密度高的中文总结。' +
  '只基于给定材料，不要编造未出现的信息。';

/** 分段提炼用（与深度无关，保持稳定） */
export function buildChunkPrompt({ title, upName, part, timeRange, text }) {
  return '【视频标题】' + title + '\n【UP主】' + upName + '\n【片段】' + part +
    (timeRange ? '（' + timeRange + '）' : '') +
    '\n\n以下是该片段的字幕原文：\n"""\n' + text + '\n"""\n\n' +
    '请提炼这一片段的：\n' +
    '1) 主要讲了什么（3-6 条要点，保留关键细节与具体数字）\n' +
    '2) 出现的专有名词/人物/产品/数据\n' +
    '3) 本段给出的结论或观点\n' +
    '用紧凑的中文要点输出，不要客套话。';
}

/* ---------------- 三档深度的独立模板 ---------------- */
// 默认模板移到 promptDefaults.js，便于设置页展示与编辑

export function buildFinalPrompt({ title, upName, duration, depth, digest, template }) {
  const tpl = template || DEPTH_TEMPLATES[depth] || DEPTH_TEMPLATES.standard;
  return '【视频标题】' + title + '\n【UP主】' + upName + '\n【时长】' + duration +
    '\n\n下面是该视频按时间顺序分段提炼的要点：\n"""\n' + digest + '\n"""\n\n' + tpl;
}

export const SYSTEM_VISION =
  '你是一位视频画面分析助手。用户会给你同一个视频按时间顺序抽取的若干帧截图，' +
  '请如实描述画面里实际发生的事。不要编造画面中没有的内容。';

export function buildVisionPrompt({ title, times }) {
  return '这是一段哔哩哔哩视频《' + title + '》按时间顺序抽取的 ' + times.length +
    ' 帧画面，对应时间点分别为：' + times.join('、') + '。\n\n' +
    '请输出：\n' +
    '1) 逐帧简要描述（每帧一句话：画面主体、是否有字幕/文字/图表、是否为人脸出镜）\n' +
    '2) 整体判断：这是什么类型的视频（真人出镜口播/游戏实况/PPT 讲解/影视剪辑/纯画面演示）\n' +
    '3) 画面中出现的、字幕里可能没有的关键文字信息（标题卡片、图表数字、产品名等）\n' +
    '注意：只描述你真实看到的内容。';
}
