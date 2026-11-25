# Bili AI 总结 · Bug 修复报告

**插件**：Bili AI 总结（`E:\AgentWorkspace\BiliAISummary`）
**修复版本**：2.0.0 → **2.1.0**
**报告日期**：2026-11-15

---

## 一、问题描述

### 现象

启用本插件后，B 站视频页顶部导航栏（首页 / 番剧 / 直播 / 游戏中心 / 会员购 / 漫画 / 赛事 / 搜索框 / 头像 / 投稿）
**整条消失**，页面上方只剩一条约 64px 的空白。

### 复现条件

- 仅在启用本插件时出现；关闭插件后同一页面立即恢复正常
- 与 Bilibili-Dislike 等其它用户脚本无关（开关它们都不影响顶栏）
- 打开视频页即触发，与是否点击「AI 总结」按钮无关

### 证据

- `#biliMainHeader` 元素**存在**，但 `innerHTML.length === 0`、`childElementCount === 0`
- 元素上只剩服务端渲染的 `style="min-height: 64px"`，即初始占位高度
- 顶栏深度为空导致页面顶部留白，其余内容（播放器、评论区）正常渲染

---

## 二、根本原因

### 2.1 B 站顶栏的渲染方式

B 站视频页的 HTML 是这样组织的：

```html
<div id="app" class="app-v1" data-server-rendered="true">
  <div id="biliMainHeader" style="min-height:64px" data-v-17d386a9>
    <div class="bili-header fixed-header">…</div>
  </div>
  <div id="mirror-vdcon" class="video-container-v1">…</div>
</div>
```

关键点：**`#biliMainHeader` 与 `#app` 是同一棵 Vue 树**，且首屏内容是服务端渲染（SSR）的。
客户端接管时，Vue 要对整棵树做 hydration / patch。

### 2.2 触发崩溃的两个动作

**（1）向工具栏插入节点**

旧版 `content.js` 的 `insertSummaryButton()` 执行：

```js
toolbar.appendChild(btn);   // toolbar = .video-toolbar-left
```

`.video-toolbar-left` 位于 `#app` 子树内。Vue 在做子节点 diff 时遇到这个
「自己没创建过的节点」，patch 过程可能抛错；一旦抛错，受影响的不只是工具栏，
**整段子树会渲染失败**——顶栏正好也在其中。

**（2）通过 manifest 向页面注入样式表**

```json
"content_scripts": [{ "js": [...], "css": ["src/content/content.css"] }]
```

注入的 CSS 里含 `:root` 变量定义与全局选择器，会参与页面的样式重算，
放大上面的时序问题。

### 2.3 为什么"看起来像顶栏消失"

Vue 挂载失败后，`#biliMainHeader` 保留 SSR 时的初始状态：
一个带 `min-height:64px` 的空 `div`。视觉表现就是那条空白。

> 排查过程中还观察到控制台里有来自 `bili-header.umd.js` 的
> `[Vue warn]: There is already an app instance mounted on the host container`，
> 印证了顶栏模块的挂载过程确实被打断过。

---

## 三、修复方案

### 3.1 核心原则

**内容脚本绝不向 B 站页面的 DOM 插入任何节点，也绝不注入任何 CSS。**

### 3.2 具体改动

| # | 改动 | 说明 |
|---|---|---|
| 1 | 引入 Shadow DOM | 面板与按钮全部挂在 `host.attachShadow({mode:'open'})` 内 |
| 2 | 宿主节点隔离 | `<div id="bai-shadow-host">` 只挂在 `document.body` 末位，**不在 `#app` 子树** |
| 3 | 宿主不参与布局 | `all:initial; position:fixed; inset:0; pointer-events:none` |
| 4 | 删除工具栏按钮 | 不再 `toolbar.appendChild()`，入口改为右下角浮层按钮 |
| 5 | 移除 CSS 注入 | manifest 的 `content_scripts.css` 字段整个删除，样式内联进 shadow root |
| 6 | 删除冗余安全机制 | 上一版加的 `?bai_off=1` 开关、`headerHealthy()` 健康检查、`setupHeaderGuard()` 顶栏守护、`enterSafeMode()` 全部移除——根因已消除，这些只是治标代码 |

### 3.3 页面写入点清单（修复后）

全文只有一处 `appendChild` 落在页面上：

```js
document.body.appendChild(hostEl);   // 唯一的页面写入
shadow.appendChild(st);              // 样式，在 shadow 内
shadow.appendChild(fab);             // 浮层按钮，在 shadow 内
shadow.appendChild(el);              // 面板，在 shadow 内
el.appendChild(grip);                // 缩放手柄，在 shadow 内
```

---

## 四、验证结果

在真实 B 站视频页（`BV1GJ411x7h7`）中注入修复后的脚本，采集到的数据：

| 检查项 | 结果 | 判定 |
|---|---|---|
| `#app` 子节点数变化 | 5 → 5（**+0**） | ✅ 页面结构完全未变 |
| 宿主节点父级 | `BODY` | ✅ 未进入 `#app` |
| `host.closest('#app')` | `false` | ✅ 确认在 Vue 树之外 |
| 页面内 `[class^="bai-"]` 命中数 | **0** | ✅ 页面查询不到任何扩展节点 |
| `#biliMainHeader` 子节点数 | 1 | ✅ 顶栏正常挂载 |
| `#biliMainHeader` innerHTML 长度 | 38160 | ✅ 内容完整 |
| `.bili-header` 存在 | `true` | ✅ 顶栏渲染正常 |
| `.video-toolbar-left` 内扩展按钮 | 无 | ✅ 工具栏零侵入 |
| Shadow root 内浮层按钮 | 存在 | ✅ 入口可用 |
| Shadow root 内面板 | 存在 | ✅ 面板可用 |

交互验证（依次点击）：

1. 初始：浮层按钮显示、面板隐藏 ✅
2. 点浮层按钮：面板打开、按钮隐藏 ✅
3. 点面板「×」：面板关闭、按钮恢复 ✅

### 自动化检查

```
node --check src/content/content.js   → OK
node --check src/background.js        → OK
node --check src/lib/*.js             → OK
manifest.json JSON.parse              → OK（version 2.1.0，content_scripts 无 css 字段）
```

---

## 五、顺带清理的死代码

| 文件 | 清理内容 | 原因 |
|---|---|---|
| `src/content/content.css` | **整个文件删除** | 样式已内联进 shadow root，manifest 也不再引用 |
| `src/content/content.js` | `?bai_off=1` 排查开关 | 根因消除后无需保留 |
| `src/content/content.js` | `headerHealthy()` / `setupHeaderGuard()` / `enterSafeMode()` / `scheduleInsert()` / `teardownHost()` / `headerEl()` / `isBiliChrome()` | 上一版的治标代码，已无意义 |
| `src/content/content.js` | 未被调用的 `$(sel)` helper | 死代码 |
| `src/background.js` | `PING` / `GET_TRANSCRIPT` / `CHAT` / `CLEAR_CACHE` 消息分支 | 全项目无任何调用方 |
| `src/background.js` | `clearCache` 导入 | 随上一条一起移除（设置页直接调用 lib） |
| `src/lib/bili.js` | `import { md5 }` | 该模块从未使用 md5 |
| `src/lib/bili.js` | `parseVideoId()` 及残留的空注释块 | 无调用方 |
| `src/lib/store.js` | `export { DEFAULTS }` | 无人从 store 导入 DEFAULTS |
| `src/lib/prompts.js` | `export { DEPTH_TEMPLATES }` | 仅模块内部使用 |
| `src/lib/summarizer.js` | `export { splitChunks, fmtTime }` | 仅模块内部使用 |

代码量变化：**2162 行 → 2115 行**（净减 47 行，同时删除了 1 个文件）。

---

## 六、升级注意

1. 打开 `edge://extensions/`，对本插件点 **重新加载**
2. 回到视频页按 **F5**——当前那条空顶栏是上次崩溃残留的，必须刷新才会重新挂载
3. 旧版本注入的节点会在页面卸载时自然消失，无需手动清理

---

## 七、经验教训

1. **不要在别人的 SSR/Vue 树里插节点**。哪怕只是一个按钮，也可能让 hydration 失败。
   Shadow DOM 是内容脚本做 UI 的正确姿势。
2. **不要用 manifest 注入全局 CSS**。`:root` 级别的变量会污染宿主页面。
3. **症状 ≠ 根因**。"顶栏消失"看起来是顶栏的问题，实际是工具栏插节点导致的连带崩溃。
   第一版加了健康检查和守护逻辑，虽然降低了触发概率，但没有消除原因——所以用户反馈"没有任何变化"。
4. **要有可证伪的验证手段**。最后靠「注入前后 `#app` 子节点数」这一条硬指标，
   才确认修复真的生效，而不是靠"看起来正常了"。
