const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res, rej) => {
  chrome.runtime.sendMessage(msg, (r) => {
    if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
    r?.ok ? res(r.data) : rej(new Error(r?.error || '扩展无响应'));
  });
});

let tab = null;

(async function init() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = t;
  const bv = (t?.url || '').match(/\/video\/(BV[0-9A-Za-z]{10})/);
  const state = $('state');

  if (!bv) {
    state.textContent = '当前页不是 B 站视频页';
    $('run').disabled = true;
    $('tip').textContent = '打开任意 bilibili.com/video/BV... 页面后重试。';
    return;
  }

  $('state').textContent = '视频 ' + bv[1];
  try {
    const info = await send({ type: 'GET_INFO', bvid: bv[1] });
    $('state').textContent = info.title.slice(0, 40);
    $('tip').textContent = 'UP：' + info.owner;
  } catch (e) {
    $('tip').textContent = '读取视频信息失败：' + e.message;
  }

  $('run').onclick = async () => {
    $('run').disabled = true;
    $('tip').textContent = '正在总结…（面板会在视频页右下角显示结果）';
    try {
      await send({ type: 'SUMMARIZE', bvid: bv[1] });
      $('tip').textContent = '完成，请看视频页右下角面板';
    } catch (e) {
      $('tip').textContent = '失败：' + e.message;
    } finally { $('run').disabled = false; }
  };
})();

$('opts').onclick = () => chrome.runtime.openOptionsPage();
