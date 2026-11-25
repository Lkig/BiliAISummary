// 内容脚本：AI 总结面板
// ---------------------------------------------------------------------------
// 本脚本不向 B 站页面的 DOM 插入任何节点。
//
// B 站视频页的顶栏 #biliMainHeader 与服务端渲染的 #app 是同一棵 Vue 树，
// 播放器工具栏也在其中。外部节点被 append 进去会让 Vue 的子节点 diff 出错，
// 导致整段子树渲染失败（顶栏变成一条 64px 的空白）。
//
// 因此面板与入口按钮全部放在 Shadow DOM 里：
//   * 宿主节点只作为 document.body 的末位子节点，不进入 #app 子树；
//   * 宿主是 pointer-events:none 的浮层，不参与页面布局，不改变任何尺寸；
//   * 样式全部写在 shadow root 内，与页面样式双向隔离。
// ---------------------------------------------------------------------------
(function () {
  if (window.__BILI_AI_SUMMARY__) return;
  window.__BILI_AI_SUMMARY__ = true;

  const send = (msg) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('扩展无响应'));
      res.ok ? resolve(res.data) : reject(new Error(res.error));
    });
  });

  const STYLE = [
    ":host {",
    "  all: initial;",
    "  position: fixed;",
    "  inset: 0;",
    "  z-index: 2147483000;",
    "  pointer-events: none;",
    "  color: #18191c;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;",
    "  --bai-bg: #ffffff;",
    "  --bai-fg: #18191c;",
    "  --bai-border: #e3e5e7;",
    "  --bai-accent: #00aeec;",
    "}",
    "* { box-sizing: border-box; }",
    ".bai-panel {",
    "  position: absolute;",
    "  right: 24px;",
    "  bottom: 24px;",
    "  width: 520px;",
    "  height: 560px;",
    "  min-width: 320px;",
    "  min-height: 220px;",
    "  max-height: 90vh;",
    "  display: flex;",
    "  flex-direction: column;",
    "  background: var(--bai-bg);",
    "  color: var(--bai-fg);",
    "  border: 1px solid var(--bai-border);",
    "  border-radius: 12px;",
    "  box-shadow: 0 8px 32px rgba(0, 0, 0, .16);",
    "  z-index: 10;",
    "  pointer-events: auto;",
    "  font-size: 14.5px;",
    "  overflow: hidden;",
    "}",
    ".bai-panel.bai-hidden { display: none !important; }",
    ".bai-panel.bai-dragging, .bai-panel.bai-resizing { box-shadow: 0 12px 44px rgba(0, 0, 0, .28); }",
    ".bai-panel.bai-fullscreen-hidden { display: none !important; }",
    ".bai-fab.bai-fullscreen-hidden { display: none !important; }",
    ".bai-fab.bai-fab-opened { display: none !important; }",
    ".bai-resize-grip {",
    "  position: absolute;",
    "  right: 0; bottom: 0;",
    "  width: 18px; height: 18px;",
    "  cursor: nwse-resize;",
    "  background: linear-gradient(135deg, transparent 50%, #c9ccd1 50%, #c9ccd1 60%, transparent 60%, transparent 70%, #c9ccd1 70%, #c9ccd1 80%, transparent 80%);",
    "  border-bottom-right-radius: 12px;",
    "}",
    ".bai-resize-grip:hover { background-color: #00aeec22; }",
    ".bai-head {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  padding: 11px 14px;",
    "  border-bottom: 1px solid var(--bai-border);",
    "  background: linear-gradient(90deg, #00aeec14, transparent);",
    "  cursor: move;",
    "  user-select: none;",
    "  flex: 0 0 auto;",
    "}",
    ".bai-title { font-weight: 600; font-size: 13px; }",
    ".bai-actions { display: flex; gap: 6px; align-items: center; }",
    ".bai-depth {",
    "  font-size: 12px;",
    "  border: 1px solid var(--bai-border);",
    "  border-radius: 6px;",
    "  padding: 2px 4px;",
    "  background: #fff;",
    "  color: inherit;",
    "}",
    ".bai-btn {",
    "  border: none;",
    "  background: var(--bai-accent);",
    "  color: #fff;",
    "  border-radius: 6px;",
    "  padding: 4px 10px;",
    "  cursor: pointer;",
    "  font-size: 12px;",
    "  font-family: inherit;",
    "}",
    ".bai-btn:disabled { opacity: .55; cursor: not-allowed; }",
    ".bai-btn.bai-vision { background: #6b7280; }",
    ".bai-close { background: transparent; color: #9499a0; font-size: 16px; padding: 0 4px; }",
    ".bai-body {",
    "  padding: 12px 16px;",
    "  overflow-y: auto;",
    "  line-height: 1.75;",
    "  flex: 1;",
    "  font-size: 14.5px;",
    "}",
    ".bai-body h3 { font-size: 15.5px; margin: 14px 0 6px; color: #18191c; font-weight: 600; }",
    ".bai-body h4 { font-size: 14px; margin: 10px 0 4px; color: #61666d; }",
    ".bai-body ul { margin: 4px 0 4px 16px; padding: 0; }",
    ".bai-body li { margin-bottom: 3px; }",
    ".bai-body p { margin: 4px 0; }",
    ".bai-placeholder, .bai-loading { color: #9499a0; text-align: center; padding: 28px 0; }",
    ".bai-error { color: #f85a54; white-space: pre-wrap; }",
    ".bai-meta { color: #9499a0; font-size: 11.5px; margin-bottom: 6px; }",
    ".bai-pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; font-size: 12.5px; line-height: 1.6; }",
    ".bai-foot {",
    "  padding: 6px 12px;",
    "  border-top: 1px solid var(--bai-border);",
    "  color: #9499a0;",
    "  font-size: 11px;",
    "}",
    ".bai-fab {",
    "  position: absolute;",
    "  right: 24px;",
    "  bottom: 90px;",
    "  display: inline-flex;",
    "  align-items: center;",
    "  gap: 6px;",
    "  height: 34px;",
    "  padding: 0 12px;",
    "  border: 1px solid var(--bai-border);",
    "  border-radius: 17px;",
    "  background: #fff;",
    "  color: #61666d;",
    "  box-shadow: 0 4px 14px rgba(0, 0, 0, .12);",
    "  font-size: 13px;",
    "  font-family: inherit;",
    "  cursor: pointer;",
    "  user-select: none;",
    "  pointer-events: auto;",
    "  transition: box-shadow .15s ease, transform .08s ease, color .15s ease;",
    "}",
    ".bai-fab:hover { color: #00aeec; box-shadow: 0 6px 20px rgba(0, 174, 236, .28); }",
    ".bai-fab:active { transform: scale(.95); }",
    ".bai-fab .bai-ico { display: inline-flex; align-items: center; }",
    ".bai-fab .bai-fab-txt { white-space: nowrap; }",
    "@media (prefers-color-scheme: dark) {",
    "  :host { --bai-bg: #18181c; --bai-fg: #e3e5e7; --bai-border: #2f3134; }",
    "  .bai-body h3 { color: #e3e5e7; }",
    "  .bai-body h4 { color: #aeb3b9; }",
    "  .bai-depth { background: #232326; color: #e3e5e7; }",
    "  .bai-fab { background: #232326; }",
    "}"
  ].join('\n');

  let settings = null;
  let currentBvid = null;
  let hostEl = null;
  let shadow = null;
  let panel = null;
  let fab = null;

  function getBvid() {
    const m = location.href.match(/\/video\/(BV[0-9A-Za-z]{10})/);
    return m ? m[1] : null;
  }

  function getPage() {
    const p = new URL(location.href).searchParams.get('p');
    return p ? parseInt(p, 10) : 1;
  }

  /* ---------------- 隔离宿主 ---------------- */
  function ensureHost() {
    if (hostEl && hostEl.isConnected) return hostEl;
    if (!document.body) return null;
    hostEl = document.getElementById('bai-shadow-host');
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = 'bai-shadow-host';
      // z-index 只挡页面普通内容，不压全屏播放器；否则全屏时仍会盖在最上层
      hostEl.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 10000; pointer-events: none;');
      document.body.appendChild(hostEl);
    }
    shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
    if (!shadow.getElementById('bai-style')) {
      const st = document.createElement('style');
      st.id = 'bai-style';
      st.textContent = STYLE;
      shadow.appendChild(st);
    }
    return hostEl;
  }

  /* ---------------- 抽帧（无字幕时的视觉兜底，只读页面 video） ---------------- */
  async function grabFrames({ count = 8, maxWidth = 768, quality = 0.72 } = {}) {
    const video = document.querySelector('video');
    if (!video) throw new Error('找不到 <video> 元素，请等播放器加载完成');
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长未知，请先点播放让播放器加载');

    const wasPlaying = !video.paused;
    const origin = video.currentTime;
    if (wasPlaying) video.pause();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];
    const times = [];

    const seekTo = (t) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('跳转超时')); }, 8000);
      const onSeeked = () => { cleanup(); resolve(); };
      function cleanup() { clearTimeout(timer); video.removeEventListener('seeked', onSeeked); }
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = t;
    });

    try {
      for (let i = 0; i < count; i++) {
        const t = duration * (0.06 + 0.88 * (i / Math.max(count - 1, 1)));
        await seekTo(t);
        await new Promise(r => setTimeout(r, 180));
        const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', quality));
        times.push(fmtSec(t));
      }
    } finally {
      video.currentTime = origin;
      if (wasPlaying) video.play().catch(() => {});
    }
    return { frames, times, duration };
  }

  /* ---------------- 浮层入口按钮 ---------------- */
  function ensureFab() {
    if (!ensureHost()) return;
    if (fab && fab.isConnected) return;
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'bai-fab';
    fab.title = '用 AI 总结这个视频';
    fab.innerHTML = '<span class="bai-ico" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="18" height="18">' +
        '<path fill="currentColor" d="M12 2.6l2.05 5.75 5.75 2.05-5.75 2.05L12 18.2l-2.05-5.75L4.2 10.4l5.75-2.05z"/>' +
        '<path fill="currentColor" d="M18.6 14.4l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85z"/>' +
      '</svg></span><span class="bai-fab-txt">AI 总结</span>';
    fab.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openPanel(); });
    shadow.appendChild(fab);

    // 若创建时已经处于全屏，立即套用隐藏状态，避免先闪一下再消失
    if (isPlayerFullscreen()) {
      fab.classList.add('bai-fullscreen-hidden');
    }
  }

  /** 当前是否处于全屏 / 网页全屏 */
  function isPlayerFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    const b = document.body.classList;
    if (b.contains('webscreen-fix')
      || b.contains('bilibili-player-webscreen')
      || b.contains('player-fullscreen')
      || b.contains('bpx-player-container-webscreen')) return true;
    return !!document.querySelector('.bpx-player-container[data-screen="web"], .bpx-player-container[data-screen="full"]');
  }

  /* ---------------- 面板 ---------------- */
  function buildPanel() {
    if (!ensureHost()) return null;
    if (panel && panel.isConnected) return panel;
    const el = document.createElement('div');
    el.className = 'bai-panel bai-hidden';
    el.innerHTML =
      '<div class="bai-head">' +
        '<span class="bai-title">AI 视频总结</span>' +
        '<div class="bai-actions">' +
          '<select class="bai-depth" title="总结深度">' +
            '<option value="quick">快速</option>' +
            '<option value="standard">标准</option>' +
            '<option value="deep">深度</option>' +
          '</select>' +
          '<button class="bai-btn bai-run">总结</button>' +
          '<button class="bai-btn bai-vision" title="无字幕时用画面理解">看图</button>' +
          '<button class="bai-btn bai-close" title="关闭">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="bai-body">' +
        '<div class="bai-placeholder">点击「总结」分析本视频内容</div>' +
      '</div>' +
      '<div class="bai-foot"></div>';
    shadow.appendChild(el);

    el.querySelector('.bai-close').onclick = () => {
      el.classList.add('bai-hidden');
      fab?.classList.remove('bai-fab-opened');
    };
    el.querySelector('.bai-run').onclick = () => runSummarize(el);
    el.querySelector('.bai-vision').onclick = () => runVision(el);

    makeDraggable(el);
    makeResizable(el);
    panel = el;
    return el;
  }

  /* ---------------- 拖动与缩放 ---------------- */
  function makeDraggable(el) {
    const head = el.querySelector('.bai-head');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, select, .bai-btn')) return;
      const rect = el.getBoundingClientRect();
      dragging = true;
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY;
      ox = rect.left; oy = rect.top;
      el.classList.add('bai-dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, Math.min(ox + (e.clientX - sx), window.innerWidth - 120)) + 'px';
      el.style.top = Math.max(0, Math.min(oy + (e.clientY - sy), window.innerHeight - 60)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('bai-dragging');
    });
  }

  function makeResizable(el) {
    const grip = document.createElement('div');
    grip.className = 'bai-resize-grip';
    grip.title = '拖动调整大小';
    el.appendChild(grip);

    let sx = 0, sy = 0, ow = 0, oh = 0, resizing = false;

    grip.addEventListener('mousedown', (e) => {
      const rect = el.getBoundingClientRect();
      resizing = true;
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY;
      ow = rect.width; oh = rect.height;
      el.classList.add('bai-resizing');
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      el.style.width = Math.max(320, Math.min(ow + (e.clientX - sx), window.innerWidth - 40)) + 'px';
      el.style.height = Math.max(220, Math.min(oh + (e.clientY - sy), window.innerHeight - 40)) + 'px';
      el.style.maxHeight = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      el.classList.remove('bai-resizing');
    });
  }

  function setBody(html) { const b = panel && panel.querySelector('.bai-body'); if (b) b.innerHTML = html; }
  function setFoot(t) { const f = panel && panel.querySelector('.bai-foot'); if (f) f.textContent = t || ''; }

  function syncDepthSelect() {
    const sel = panel && panel.querySelector('.bai-depth');
    if (sel && settings && settings.depth) sel.value = settings.depth;
  }

  /* ---------------- 渲染 ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtSec(s) {
    return Math.floor(s / 60) + ' 分 ' + Math.floor(s % 60) + ' 秒';
  }

  function renderMarkdown(md) {
    const esc = escapeHtml;
    let html = '', inList = false;
    for (const raw of String(md).split('\n')) {
      const line = raw.trimEnd();
      if (/^###?\s+/.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h4>' + esc(line.replace(/^###?\s+/, '')) + '</h4>';
      } else if (/^##\s+/.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3>' + esc(line.replace(/^##\s+/, '')) + '</h3>';
      } else if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + esc(line.replace(/^\s*[-*]\s+/, '')) + '</li>';
      } else if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + esc(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function renderResult(data) {
    const cost = data.usage
      ? ' · 约 ' + ((data.usage.prompt + data.usage.completion) / 1000).toFixed(1) + 'k tokens'
      : '';
    setBody('<div class="bai-meta">' + (data.cached ? '（来自缓存）' : '') +
      '字幕 ' + data.lineCount + ' 行' + cost + '</div>' + renderMarkdown(data.markdown));
    setFoot(new Date(data.at).toLocaleString() + (data.chunks > 1 ? ' · ' + data.chunks + ' 段' : ''));
  }

  async function runSummarize(el) {
    const btn = el.querySelector('.bai-run');
    const depth = el.querySelector('.bai-depth').value;
    btn.disabled = true;
    setBody('<div class="bai-loading">正在获取字幕…</div>');
    try {
      const data = await send({ type: 'SUMMARIZE', bvid: currentBvid, page: getPage(), depth });
      renderResult(data);
    } catch (e) {
      setBody('<div class="bai-error">' + escapeHtml(String(e.message || e)) + '</div>');
    } finally {
      btn.disabled = false;
    }
  }

  async function runVision(el) {
    const btn = el.querySelector('.bai-vision');
    btn.disabled = true;
    setBody('<div class="bai-loading">正在从播放器抽取画面帧…</div>');
    try {
      const info = await send({ type: 'GET_INFO', bvid: currentBvid });
      const { frames, times, duration } = await grabFrames({ count: 8 });
      if (!frames.length) throw new Error('没有抽到画面帧');
      setBody('<div class="bai-loading">已抽取 ' + frames.length + ' 帧，正在让模型看图…</div>');
      const data = await send({ type: 'VISION', bvid: currentBvid, title: info.title, images: frames, times });
      setBody('<div class="bai-meta">视觉分析 · ' + frames.length + ' 帧 · 全片 ' + fmtSec(duration) + '</div>'
        + '<pre class="bai-pre">' + escapeHtml(data.markdown) + '</pre>');
      setFoot('画面理解结果可直接用于判断视频类型与是否值得看');
    } catch (e) {
      setBody('<div class="bai-error">' + escapeHtml(String(e.message || e)) + '</div>');
    } finally {
      btn.disabled = false;
    }
  }

  function openPanel() {
    const el = buildPanel();
    if (!el) return;
    el.classList.remove('bai-hidden');
    // 用 class 而非内联 display，避免覆盖全屏隐藏逻辑
    fab?.classList.add('bai-fab-opened');
    syncDepthSelect();
  }

  /* ---------------- 全屏 / 网页全屏时隐藏面板 ---------------- */
  function setupFullscreenGuard() {
    // 面板和浮动按钮都要隐藏，否则全屏时按钮会一直浮在视频上遮挡
    const applyHidden = (hidden) => {
      panel?.classList.toggle('bai-fullscreen-hidden', hidden);
      fab?.classList.toggle('bai-fullscreen-hidden', hidden);
    };
    const checkBiliMode = () => {
      const b = document.body.classList;
      const isWide = b.contains('webscreen-fix')
        || b.contains('bilibili-player-webscreen')
        || b.contains('player-fullscreen')
        || b.contains('bpx-player-container-webscreen')
        || !!document.querySelector('.bpx-player-container[data-screen="web"]')
        || !!document.querySelector('.bpx-player-container[data-screen="full"]');
      applyHidden(isWide || !!(document.fullscreenElement || document.webkitFullscreenElement));
    };

    // 原生全屏事件 + body class 变化 + 播放器 data-screen，三种信号统一处理
    document.addEventListener('fullscreenchange', checkBiliMode);
    document.addEventListener('webkitfullscreenchange', checkBiliMode);
    new MutationObserver(checkBiliMode).observe(document.body, {
      attributes: true, attributeFilter: ['class']
    });

    const attachPlayer = () => {
      const pl = document.querySelector('.bpx-player-container, #bilibili-player');
      if (!pl) return false;
      new MutationObserver(checkBiliMode).observe(pl, {
        attributes: true, attributeFilter: ['data-screen', 'class']
      });
      return true;
    };
    if (!attachPlayer()) {
      // 播放器可能晚于此刻渲染，轮询几次
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (attachPlayer() || n > 20) clearInterval(t);
      }, 500);
    }

    // 兜底：周期检查，覆盖 fab 晚于全屏事件创建的情况
    const tick = setInterval(checkBiliMode, 1000);
    setTimeout(() => clearInterval(tick), 60000);
    setTimeout(checkBiliMode, 800);
  }

  /* ---------------- 生命周期 ---------------- */
  async function init() {
    settings = await send({ type: 'GET_SETTINGS' }).catch(() => null);
    currentBvid = getBvid();

    if (!ensureHost()) return;
    if (!currentBvid) { ensureFab(); return; }

    buildPanel();
    ensureFab();
    syncDepthSelect();
    setupFullscreenGuard();

    if (settings && settings.autoSummarize) {
      panel.classList.remove('bai-hidden');
      runSummarize(panel);
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const next = changes.settings.newValue || {};
      settings = Object.assign({}, settings || {}, next);
      if (next.depth) syncDepthSelect();
    });
  } catch { /* 忽略 */ }

  // SPA 路由切换：只读判断，不修改页面 DOM
  let last = location.href;
  const routeObserver = new MutationObserver(() => {
    if (location.href === last) return;
    last = location.href;
    const bv = getBvid();
    if (!bv || bv === currentBvid) return;
    currentBvid = bv;
    setBody('<div class="bai-placeholder">点击「总结」分析本视频内容</div>');
    setFoot('');
    syncDepthSelect();
  });

  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    init().then(() => {
      routeObserver.observe(document.body, { childList: true, subtree: true });
    }).catch((e) => console.warn('[bai] init 失败', e));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    setTimeout(boot, 600);
  }
})();
