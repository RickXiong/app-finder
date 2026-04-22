# App Finder Web — 细节打磨 Tips

> 本清单记录一些零碎但有价值的小优化点。做完的标 ✅，待办的标 ⏳，不做的标 ❌。
> 有新的细节打磨灵感，直接往下加条目即可。

---

## 状态汇总

| # | 条目 | 状态 |
|---|---|---|
| 1 | 包名前缀 `om./co./cm.` → `com.` 自动修正 | ✅ |
| 2 | 名称修饰词容忍（免费/极速/HD/Pro/Lite/专业/青春/国际 等） | ✅ |
| 3 | 跨填源（cross-fill）固定用 `DEFAULT_ANDROID_STORES`，避免统计排序随机性 | ✅ |
| 4 | HTML `Cache-Control: no-store`，避免刷新不到新代码 | ✅ |
| 5 | 同设备跨浏览器设置 + 历史完全同步（仅本机 127 访问，`/api/settings`） | ✅ |
| 6 | 历史去重按"包名一致"替代"5 秒窗口"，多浏览器/多次搜索不留残影 | ✅ |
| 7 | iOS bundle 反查命中子品牌（如淘宝反查到 `com.taobao.litetao` 而非主 app） | ⚠️ |
| 8 | 包名中间/末尾字母缺漏修正 | ❌ |
| 9 | 结果页 Tips bar 长文案被截断，充分利用工具栏右侧空白 | ✅ |
| 10 | 历史回放时"补"/"已修正" 等 badge 字段被服务端白名单过滤掉 | ✅ |
| 11 | Tips 支持点击切下一条 + 切换动画改成上下滚动 | ✅ |
| 12 | Cmd/Ctrl+Enter 多行查询后，结果页搜索框不折叠成单行 | ✅ |
| 13 | 表头 `<thead>` 跑到数据行下面（sticky top 过期） | ✅ |
| 14 | 高级设置（sha256 / 精确匹配 / 跨端补全 等）刷新后丢失 | ✅ |
| 15 | 跨浏览器设置"自动推"—— 一个浏览器改 → 其它浏览器实时刷 | ✅ |
| 16 | 移动端 UI 一批修复（placeholder 截断 / 工具栏挤爆 / top-actions 挡文字 / 卡片留白） | ✅ |
| 17 | V4 把 `platform_filter` 发成 `"iOS"/"Android"` 大小写，后端比较小写 → 筛选形同虚设 | ✅ |
| 18 | 跨端补全被 `platform_filter == "all"` 这道门反向拦截（筛单平台时不给补） | ✅ |
| 19 | `.v4-searchbox { overflow: hidden }` 把 absolute 定位的高级面板裁掉 | ✅ |
| 20 | Homebrew python@3.12 默认不带 `_tkinter` → PyInstaller .app 启动时静默 import 失败、Flask 不起 | ✅ |
| 21 | Werkzeug 3.x 启动反向 DNS 查询能慢 15-20s，smoke-test 必须用 poll-until-up 而非固定 sleep | ✅ |
| 22 | Tip 独占行（#16 P0 的修法）用户不买账：要求恢复同行 + 省略号。#16 P0 已回滚 | ✅ |
| 23 | `:not(:focus)` + JS scrollHeight 展开多行时序 bug：pointerdown 里读到的 scrollHeight 仍被 `!important` 压扁成 22px。改成 `.is-collapsed` 显式 class 门 | ✅ |

---

## 条目详情

### 1. ✅ 包名前缀 `om./co./cm.` → `com.` 自动修正

**场景**：用户复制 `com.ss.iphone.ugc.Aweme` 时手滑少了字母，变成 `om.ss.iphone.ugc.Aweme` / `co.ss.iphone.ugc.Aweme` / `cm.ss.iphone.ugc.Aweme`，原来会直接返回空（或被搜索引擎猜成"安卓软件最全"这种站名）。

**解决（方案 A）**：
- `app.py` `_suggest_pkg_prefix_fix(pkg)`：只对 `<om|co|cm>.xxx` 返回 `[com.xxx]`。
- `query_single()` 入口并发启动修正版查询（`_disable_prefix_fix=True` 防递归）。
- 原查询"等同没查到"（`app_name == 未找到` 或 `source ∈ {search_engine_ref, qimai_hint}`）时，用修正版结果替换。
- 修正行打 `_corrected: true` + `_orig_value`（原输入）。
- 跨端补全继承 `_corrected` 标记，避免"iOS 行有 badge、Android 行没有"的不一致。
- 前端 `v4-corr-badge`（暖黄色）在 `package_name` 列挂"已修正"提示，hover 显示原输入。

**代码位置**：
- `app.py`: `_suggest_pkg_prefix_fix()` 附近 + `query_single()` 入口和结尾 + `_extended_cross_fill()` 两处继承点。
- `static/main-v4.js`: `renderCell` 的 `package_name` 分支。
- `static/style-v4.css`: `.v4-corr-badge`。

**验证**（curl 测试结果）：
```
om.ss.iphone.ugc.Aweme → iOS/Android 双端抖音, _corr=True
co.tencent.mm          → Android 微信 + iOS 跨端补全, _corr=True
cm.tencent.mm          → Android 微信 + iOS 跨端补全, _corr=True
com.tencent.mm         → 正常查询, _corr=None（未被误标）
```

**不做**：中间/末尾字母缺漏（候选数量按位置×26 爆炸、准确率低，靠名称反查兜底更合理）。

---

### 2. ✅ 名称修饰词容忍

**问题**：`is_name_relevant('七猫小说', '七猫免费小说')` 严格子串比对失败 → Android 结果被过滤掉。

**解决**：`_strip_app_name_modifiers()` 正则剥离 `免费版/免费/极速版/极速/精简版/精简/青春版/国际版/专业版/企业版/标准版/完整版/官方版/公测版/测试版/内测版/HD/Lite/Pro/Plus` 等修饰后再比对。

**代码位置**：`app.py` `_APP_NAME_MODIFIERS_RE` + `_strip_app_name_modifiers()` + `is_name_relevant()` 末尾兜底。

---

### 3. ✅ 跨填源默认用 `DEFAULT_ANDROID_STORES`

**问题**：`get_ranked_store_order()` 按累计查询数重新排序，同一个包名每次跨填的来源不稳定（有时 `appchina`、有时 `小米应用商店`）。

**解决**：`_run_pkg_query_for_crossfill(pkg)` 改用 `list(DEFAULT_ANDROID_STORES)` 固定顺序，小米永远第一。

---

### 4. ✅ HTML 禁缓存

**问题**：浏览器启发式缓存 HTML → `?v=mtime` 参数值被冻结 → 新 JS 永远加载不到。

**解决**：`_html_no_store()` 给 `/` 和 `/legacy` 的响应加 `Cache-Control: no-store, must-revalidate` + `Pragma: no-cache` + `Expires: 0`。

---

### 5. ✅ 同设备跨浏览器同步

**需求**：同一台 Mac，Chrome / Safari / Firefox 访问 127 必须看到完全一致的历史 + 设置；刷新后设置不恢复默认。局域网其他设备（手机）走原有共享开关。

**解决**：
- 新增 `_SETTINGS` 共享状态（`.settings.json` 落地）。
- `/api/access_mode`、`/api/settings` GET/PUT。
- 前端 `_sync` 模块：127 模式下所有设置/历史写都推服务端；LAN 模式保持 localStorage。
- CSS：`html[data-access-mode="local"] #sharedHistoryBar { display: none; }`。

---

### 6. ✅ 历史去重按 lines

**问题**：多次搜索同一个 `com.yueyou.cyreader` 产生 3 条历史；或不同浏览器各一条，同步后还是两条。

**根因**：原先 5 秒时间窗口去重，5 秒外的被当成新记录。

**解决**：`_server_side_save_history()` 去重条件改成 `h.get("lines") == lines`（包名列表完全一致就替换最旧的），彻底杜绝重复。

---

### 7. ⚠️ iOS bundle 反查子品牌

**场景**：iOS bundle 查 `com.taobao.taobao4iphone` 命中后，反过来用名称 `淘宝` 查 Android 时，如果商店里有多个含"淘宝"字样的 app（淘宝特价版、淘宝直播 等），可能返回 `com.taobao.litetao` 而不是主 app `com.taobao.taobao`。

**思路**：
- 维护一份"品牌名 → 主 app 包名"映射表（淘宝、微信、QQ 等高频）。
- 或者：排序时"包名最短且与名称精确匹配"优先。

**待办**：先攒几个实际失败用例再决定做不做。

---

### 8. ❌ 包名中间/末尾字母修正

**不做理由**：
- 每个位置 26 种候选 × 包名长度 = 候选爆炸。
- 命中概率低，假阳性多。
- 已有的名称反查（bundle → 名称 → Android）足够兜底。

---

### 9. ✅ 结果页 Tips bar 充分利用工具栏空白

**问题**：结果页工具栏的 USAGE_TIPS 文案最长 ~60 汉字，但 CSS 里 `.v4-toolbar-tip` 写死 `max-width: 380px` + `white-space: nowrap` + `text-overflow: ellipsis`，导致一半以上的 tip 被截成 `想要最快出结果：单条查询 Auto（0s）最快；批量查询建议 1-2...`；工具栏左右两组按钮之间还有大量空白没用。

**解决**：`static/style-v4.css` `.v4-toolbar-tip` 改为
- `flex: 1 1 auto; min-width: 0;` —— 让 tip 自动吃掉工具栏左侧剩余空间。
- `max-width: 780px` —— 超宽屏封顶，避免 tip 拉得太夸张。
- `white-space: normal` —— 允许换行，真撑不下的极长文案多一行显示。
- 去掉 `text-overflow: ellipsis`。

**副作用**：窄屏时 tip 可能会占第二行（因为 `.v4-tb-left` 本身是 `flex-wrap: wrap`），可接受——工具栏高度本来就会因窄屏换行而变。

**补丁 (9.1)**：长 tip 把右侧按钮 icon 挤占到下一行（`.v4-tb` 有 `flex-wrap: wrap`，`.v4-tb-left` 默认 `flex: 0 1 auto` → 按 max-content 撑开 → 超宽 → 父 wrap）。

**解决**：`.v4-tb-left` 加 `flex: 1 1 0; min-width: 0;` —— 左组只占右侧按钮外的剩余空间，tip 再长也是在左组内部换行，不再顶开右侧。移动端（≤720px）已经在 `@media` 里改成 `flex-direction: column + width: 100%`，此改动对移动端无影响。

---

### 10. ✅ 历史回放丢字段（"补"/"已修正" 消失）

**问题**：从历史记录点"显示"回放结果时，`v4-ext-badge`（补）和 `v4-corr-badge`（已修正）都不显示。

**根因**：服务端 `_server_side_save_history()` 保存 `entry.results` 时做了 **7 字段白名单**（`package_name / app_name / platform / icon_url / download_url / category / source`），`extended_fill / _corrected / _orig_value / apk_direct_urls / sha1 / sha256 / incomplete` 全部被过滤掉，回放时前端根本看不到这些字段。

**解决**：`app.py _server_side_save_history()` slim 循环里加一段"非空才保留"的字段透传：

```python
for k in ("extended_fill", "_corrected", "_orig_value",
          "_orig_task_type", "_notFound", "incomplete",
          "apk_direct_urls", "sha1", "sha256"):
    if k in r and r[k] not in (None, "", False, []):
        _slim[k] = r[k]
```

**历史数据不可救**：修复前已保存的历史条目里根本没这些字段，回放仍不带 badge。补救：把那几条重新查一次（按 lines 去重会原地替换）。

---

### 11. ✅ Tips 支持点击 + 上下滚动切换

**需求**：
- tip 自动轮播间隔太长，用户想看下一条要等 9 秒 → 支持点击立刻切换。
- 切换动画从 fade in/out 改成上下滚动（像老虎机滚动）。

**解决**：

**CSS** (`style-v4.css`)：
- 加三个切换阶段 class：`.tip-leave`（向上滑出 -10px + 淡出）、`.tip-enter-init`（起点 +10px，`transition:none`）、`.tip-enter-active`（回到 0）。
- `.v4-toolbar-tip` 加 `cursor: pointer` + hover 色彩加深。

**JS** (`main-v4.js`)：
- 抽公共 helper：`_swapTip()`（leave → swap 文本 → enter 双段 150ms 动画）、`_resetTipsTimer()`、`_bindTipClickOnce()`。
- 模块级变量 `_tipsSource` / `_tipsInterval` 记录当前节奏（6s 查询中 / 9s 结果页）。
- `startLoading` 和 `_startResultsTips` 原地的 fade 逻辑被替换，统一走新 helper。
- 点击 tip → 立刻跑一次切换 + `_resetTipsTimer`（避免点完马上被自动翻掉）。
- `_tipSwapping` 防重入，一次动画过程中点击不会叠加。

**方向**：默认"新 tip 从下滑入、旧 tip 向上滑出"。

---

### 12. ✅ Cmd/Ctrl+Enter 多行查询后结果页不折叠

**场景**：用户在首页 textarea 里输入 3 行（微信 / 支付宝 / 抖音），按 Cmd+Enter 触发查询 → 结果页顶部的搜索框**依然呈现 3 行**，占满大量垂直空间，不符合 "Google 式折叠输入"（提交后多行折叠成单行"微信 支付宝 抖音"）的设计。

**根因**：`_collapseInputForResults()` 里有一道护栏：
```js
if (document.activeElement === input) return;
```
这道护栏本意是**避免用户在结果页点击输入框想编辑时，被流式 progress 触发的 `showResults` 又把刚展开的多行压回单行**。但它有个副作用：Cmd/Ctrl+Enter 触发查询时，textarea 还带着 focus，首次折叠也被跳过 → 结果页看到 3 行 textarea。

鼠标点 `#btnQuery` 时没这个问题，因为点击行为会把 focus 挪到按钮上。

**解决**：`triggerQuery()` 开头（验证 lines 存在后）显式 `input.blur()`，让 activeElement 挪走，首次折叠正常发生。改一处覆盖 Cmd+Enter 和点按钮两条入口（`triggerQuery` 是唯一入口）。

**代码位置**：
- `static/main-v4.js` `triggerQuery()` 入口处：`input.blur()` + 详细反回归注释。
- `static/main-v4.js` `_collapseInputForResults()` 护栏旁：反向引用注释（"动这个之前先读 triggerQuery"）。
- `static/main-v4.js` keydown 处理器：顺手加 `e.isComposing` 判断，IME 选字时 Enter 不误触发查询。

**回归测试清单**（修这块前必过）：
1. 3 行 + Cmd+Enter → 结果页折叠成单行 ✅
2. 1 行 + Cmd+Enter → 结果页单行（老路径不受影响）✅
3. 3 行 + 点搜索按钮 → 结果页单行（老路径不受影响）✅
4. 点结果页折叠后的输入框 → 重新展开成 3 行（编辑态还能恢复）✅
5. 结果页流式 progress 进行中，用户点击输入框展开为多行 → 不应该被压回单行（老 bug，不能回归）✅

**血泪教训**：这一块"折叠/展开 + 流式 progress + 焦点"三者的时序被改过好多次。下次有人（也就是未来的我）又想动 `_collapseInputForResults` 里的 `activeElement` 护栏或者 `triggerQuery` 里的 `input.blur()`，**请先把上面 5 个用例全过一遍再改**。代码里两边都留了 ⚠️ 反向引用注释，互相指认，不要单边改。

---

### 13. ✅ 表头 `<thead>` 跑到数据行下面（sticky top 过期）

**现象**：查询完成后，结果页的表头行（APP 名 / 包名 / BUNDLE ID / 平台 / 分类 / 商店）出现在第一条数据行（比如"微信"那行）的**下面**而不是上面。用户视角：toolbar → 微信数据 → header，顺序完全反了。

**这块之前反复犯错过好几次**。

**根因**：`_measureStickyHeights()` 根据 `.v4-tb` 的 `offsetHeight` 算出 `--sticky-top-2` 赋给 `thead th { top: var(--sticky-top-2) }`。但这个测量**不是自动的**，只在少数显式调用点跑一次。

'complete' 事件流（`main-v4.js` 第 1230-1237 行）长这样：
```js
case 'complete':
    showResults();      // 此时 inlineProgress 还开着 → toolbar 高 (~80px) → --sticky-top-2 = 80
    exitLoading();      // inlineProgress.hidden = true → toolbar 缩回 ~48px
    // 原来这里没有 _measureStickyHeights，--sticky-top-2 卡在 80px
```
→ thead 粘在 80px，但 toolbar 实际只占 48px → 中间 32px 是空档 → 数据行从空档里滚上去盖过 header → 视觉上 header 跑到数据下面。

**所有让 toolbar 变高变矮的事件**都会踩这个坑：`inlineProgress` 显隐、`retryBadge` 显隐、tip 长度变化换行、工具栏按钮 `visibility` 切换… 之前每次修都是打地鼠——某个点漏掉调用就回归。

**解决（双保险）**：

**A. 止血**：`exitLoading()` 末尾显式调 `_measureStickyHeights()`：
```js
function exitLoading() {
    $('#inlineProgress').hidden = true;
    ...
    if (window._measureStickyHeights) window._measureStickyHeights();  // 新增
}
```

**B. 根治（彻底不用打地鼠）**：给 `.v4-tb` 也挂 ResizeObserver：
```js
const _ro = new ResizeObserver(() => window._measureStickyHeights());
_ro.observe(document.querySelector('.v4-search-zone'));
const _tbEl = document.querySelector('.v4-tb');
if (_tbEl) _ro.observe(_tbEl);      // 新增：toolbar 任何尺寸变化都自动重测
```
以后 toolbar 高度任何时候变动（进度条、tip、按钮…），sticky 自动跟上，**不再需要每处手动调 `_measureStickyHeights`**。

**代码位置**：
- `static/main-v4.js` `exitLoading()` 末尾：补调用 + 详细反回归注释。
- `static/main-v4.js` `_ro.observe()` 附近：给 `.v4-tb` 挂观察者 + 反回归注释。

**回归测试清单**（改这块之前必过）：
1. 首查 → 查询中 toolbar 有进度条高 → 查询完成缩回 → **thead 在 toolbar 正下方、数据行之上** ✅
2. 有 incomplete → 重查不完整按钮/retryBadge 显示 → toolbar 变高 → thead 同步下移，无空档 ✅
3. tip 长文案换行 → toolbar 高度变 → thead 自动跟随 ✅
4. 结果页窗口 resize → thead 始终紧贴 toolbar 底部 ✅
5. 历史回放（点历史记录里的"显示"）→ thead 位置正确 ✅

**不变量**（下次修这块前读一遍）：
> **只要 toolbar 高度改变，`--sticky-top-2` 必须同步更新**，不然 thead 会悬在一个错位的高度。ResizeObserver 是自动化这条不变量的正解；手动调用是脆弱备份。如果未来要重构掉 RO，**必须手动覆盖所有会改 toolbar 高度的路径**，不要只补一个点。

---

### 14. ✅ 高级设置（sha256 / 精确匹配 / 跨端补全 等）刷新后丢失

**现象**：用户在"高级设置"面板勾选 `SHA256`（或 `SHA1`、`APK 直链`、`精确匹配`、关掉`跨端补全`…），刷新页面 → 设置回到默认 → 用户以为没勾对 → 又勾一遍 → 再刷新又丢。

**"又双叒叕犯同样的错"**——这类是"UI 改了状态但没落盘"的经典 bug。之前 theme / interval 踩过，这次换成了 filters。

**根因（四步不变量只走了两步）**：
| 四步 | 状态 |
|---|---|
| 1. 生成（chip click 改 `filters`） | ✅ |
| 2. 存（localStorage / 推服务端） | ❌ **完全缺失** |
| 3. 读（启动时 hydrate + 反映 UI） | ❌ **完全缺失** |
| 4. 用（查询参数 / 表格列 requires） | ✅ |

`filters` 是 IIFE 里一个内存 Set：
```js
const filters = { platform: 'all', match: 'fuzzy', ext: new Set(), opts: new Set(['extended','keep']) };
```
chip click 改的是这个 Set。刷新 → IIFE 重跑 → filters 重置为初始值 → chip 全回默认。

**这不是 sha256 一个问题**：`platform`（iOS/Android 筛选）、`match`（精确匹配）、`ext`（apk/sha1/sha256）、`opts`（跨端补全 / 保留输入）全都不持久化。报 sha256 只是冰山一角。

**解决（按"字段特性四步"闭环）**：

**客户端**（`static/main-v4.js`）：
- localStorage key：`app_finder_v4_filters`，值形如 `{platform:"all", match:"fuzzy", ext:["sha256"], opts:["extended","keep"]}`（Set 必须序列化成 array）
- 新增 4 个 helper：
  - `_filtersSnapshot()` → Set 转 array 出快照
  - `_applyFilterSnapshot(raw)` → 反向把 snapshot 套回 filters（类型校验每字段）
  - `_reflectFiltersToChips()` → 按 filters 当前状态刷 chip 的 `.on` class + updateExtDisabled + updateAdvBadge
  - `_persistFilters()` → localStorage 写 + `_pushSettings({filters})` 推服务端
- **启动时**：从 localStorage 读 → `_applyFilterSnapshot` → `_reflectFiltersToChips`
- **chip click / 重置按钮**：末尾各加一行 `_persistFilters()`
- **`_gatherLocalSettings()`**：把 localStorage 的 filters 一起塞进迁移包（老用户首次进 127 模式时推到服务端）
- **`_applyServerSettings(s)`**：收到 `s.filters` 时 hydrate + 回写 localStorage + 刷 chip UI

**服务端**（`app.py`）：
- `api_settings_put` 的 `ALLOWED` 白名单加 `"filters"`（否则会被静默过滤掉——和 TIPS #10 同款坑）

**代码位置**：
- `static/main-v4.js` 第 268-368 行：4 个 helper + startup hydrate + 两处 `_persistFilters()` 调用。
- `static/main-v4.js` `_gatherLocalSettings` / `_applyServerSettings` 内：扩展 `filters` 字段处理。
- `app.py` `api_settings_put` ALLOWED 白名单：加 `"filters"`。

**回归测试清单**（修这块之前必过）：
1. 勾 `SHA256` → 刷新 → 仍勾选 ✅
2. 每个 chip 都试（`APK 直链`、`SHA1`、`精确匹配`、关 `跨端补全`、关 `保留输入`、切 `iOS`、切 `Android`）→ 各自刷新后保持 ✅
3. 点"重置"→ 刷新 → 保持重置态（不让服务端 push 复活老值）✅
4. 切到 `iOS` → `SHA1 / SHA256 / APK` 被自动清 → 刷新 → 仍然是清掉的状态 ✅
5. **127 跨浏览器**：Chrome 勾 SHA256 → Safari 刷新 → Safari 也看到勾选 ✅
6. **LAN mode**：手机访问不走 `/api/settings`，各设备独立（按 TIPS #5 约定）✅
7. `_applyServerSettings` 和 `_reflectFiltersToChips` 是否存在 hoisting / 引用顺序坑：`_bootstrapSync` 在 IIFE 底部调用 `_applyServerSettings`，那时所有 `function` 声明都已 hoist，引用合法 ✅

**不变量（下次任何人加新 UI 开关都走这 5 步）**：
> 加一个新的 toggle/chip/slider 时，**从用户视角问"刷新后还在吗？"**。如果应该在，就必须闭环这 5 步：
> 1. UI 改 → 写入内存状态（已有 click handler）
> 2. 调 `_persistFilters()`（或等价的 localStorage write + `_pushSettings`）
> 3. 启动时从 localStorage hydrate + 反映到 UI
> 4. `_applyServerSettings` 里处理服务端同步回来的值
> 5. 服务端 `api_settings_put` 的 `ALLOWED` 白名单里加字段名
>
> **漏任何一步都会出现"又双叒叕"的同类 bug**。建议新设置的 PR 里直接用这 5 条 checklist 自查。

**血泪教训**：theme / interval 已经走通这条路了，但加 advanced chips 时**完全没复用**这套链路。这种"同项目内类似功能走不同持久化方案"是 V4 早期特别容易踩的坑。以后任何"用户看起来该记住"的状态，默认都用 `_sync` 这套基建。

---

---

### 15. ✅ 跨浏览器设置实时广播（SSE）

**场景**：用户在 Chrome 勾了 SHA256、切到 Safari 得手动刷新才同步——虽然 TIPS #14 搞了 `/api/settings` 让刷新时能拉到，但"不刷新就看到"的体验还差一步。用户："这个同步可以自动化吗？"

**解决**：服务端广播池 + 客户端 SSE 订阅
- `app.py`：
  - 模块级 `_SETTINGS_SUBSCRIBERS = []` + `_SETTINGS_SUBSCRIBERS_LOCK`
  - `_broadcast_settings(snapshot, sender_id)` 把 snapshot 塞进每个订阅者的 `queue.Queue`，跳过自己（`sender_id == sub["client_id"]`）
  - `api_settings_put` 在 `_save_settings` 后调 `_broadcast_settings(new_snapshot, sender_id=req.headers.get("X-Client-Id", ""))`
  - `/api/settings_stream` 新 endpoint：`text/event-stream` + `stream_with_context(generate())`，20 秒一个 `: ping` 防代理断连，finally 里从订阅池移除
- `static/main-v4.js`：
  - `_clientId`：sessionStorage per-tab（`crypto.randomUUID()`）
  - `_pushSettings` 加 `X-Client-Id` header
  - `_subscribeSettingsStream()`：`new EventSource(`/api/settings_stream?client_id=${_clientId}`)` + `es.addEventListener('settings', e => _applyServerSettings(JSON.parse(e.data)))`；`es.onerror` 时浏览器自动重连

**成本预估（用户问的 4 问）**：
- CPU/内存：订阅者池是列表，写 queue 是 O(1)；每条 PUT 广播一次，开销与浏览器数成线性，预期 ≤ 10 个浏览器 → 忽略
- 查询速度：完全不影响——settings 广播是独立通道
- 打包大小：0（纯 stdlib `queue` + `threading`）
- 用户感知性能：唯一可能感知是"多浏览器时多一个 SSE 长连接"，但 Chrome/Safari 都是复用 HTTP/1.1 keep-alive，不占 TCP slot

**护栏**：`_is_local_request_ip` 门禁——非 127/LAN 请求返回 403，不会把设置广播到公网代理访客。

**代码位置**：
- `app.py`: `_broadcast_settings()`、`api_settings_put` 尾部、`/api/settings_stream`
- `static/main-v4.js`: `_clientId` 生成、`_pushSettings` 加 header、`_subscribeSettingsStream`、`_bootstrapSync` 末尾挂订阅

---

### 16. ✅ 移动端 UI 一批修复

一次性解决的 4 个子问题（根因各异，同步修完省得来回返工）：

**P0 - 窄屏 placeholder 截断**：textarea 单行时长文案被 Safari/iOS 硬裁。修法：按 viewport 宽度动态换短版文案（`PH_DESKTOP` / `PH_MOBILE`），`_applyPlaceholder()` 在 DOMContentLoaded + resize 时跑。

**P0 - 结果页工具栏右侧按钮被 tip 挤到第二行**：`.v4-toolbar-tip { flex:1 1 auto; max-width:780px }` 原来想吃满剩余空白，但父 `.v4-tb-left { flex-wrap:wrap }` + `.v4-tb-right` 没 shrink-0 → tip 一长就挤垮右组。~~修法：`.v4-toolbar-tip { flex:0 0 100%; order:99 }` 让 tip 在左组内强制独占最后一行。~~ **⚠ 2026-04-22 回滚**：用户觉得 tip 独占一行"太占空间"，要求回到同行显示、太长就省略。正解见 #22。`.v4-tb-right { flex-shrink:0 }` 护栏保留。

**P0 - 移动端右上角 icon pill 挡结果**：`.v4-top-actions` 移动端默认 `position:absolute`，向下滑时不跟着消失，视觉上"盖"在结果上。修法：移动端默认改 `position:relative + align-self:flex-end + margin-left:auto` 流内靠右——滑动时跟随离场。

**P1 - 移动端高级面板 chip 排版乱**：4 row（平台/匹配/扩展/行为）label 宽度不一 → chip 起点对不齐。修法：`.v4-adv-row { display:grid; grid-template-columns: 44px 1fr }` + `.v4-adv-label { width:44px }` 统一左缘；row 之间加细分隔线；面板 `max-height: 420px` + `overflow-y:auto` 防 chip 多行溢出。

**P1 - 移动端卡片右侧大段留白**：原 `.v4-card` 内只有左对齐文本、右侧空着。修法：JS 加 `.v4-card-title-row` 用 `justify-content:space-between` 让 app 名左、platform/category 小 chip 右；CSS 加 `.v4-card-chip / -ios / -android / -cat` 三色小标签样式。

**代码位置**：`static/style-v4.css` 的 `@media (max-width:720px)` 块（1463-1700 行附近）、`static/main-v4.js` `_applyPlaceholder()`、`#resultCards` 渲染模板。

---

### 17. ✅ V4 `platform_filter` 大小写问题（违反 `feedback_ui_only.md`）

**现象**：用户勾"Android"筛选器 → 结果还是出 iOS（或出双端）。

**根因**：`static/main-v4.js:1280` 把 `filters.platform`（小写 `"all"/"ios"/"android"`）ternary 转成 `"iOS"/"Android"` 才发给后端。但后端 `app.py:817/819/911/913/4685/4687` 一律 `if platform_filter == "ios"` 这种**小写比较**——匹配失败 → 三条分支全不命中 → 筛选形同虚设 + 跨端补全也被跳（cross-fill 老规则要 `== "all"`，大写 `"All"` 也不等于）。

**修法**：照抄 legacy 直接透传 `filters.platform`（本来就是小写），移除 ternary 转换。

**教训**：这是 `feedback_ui_only.md`（"V4 改造只动 UI，数据逻辑/API 参数照抄老版"）被违反的典型案例。V4 作者当时觉得"大写好看"就多手转了一下——结果踩坑。后面任何 API 参数都先 grep legacy 看原始值是什么再传。

**代码位置**：`static/main-v4.js:1280` 的 `startJob()` body 构造处（现在带详细注释防止再犯）。

---

### 18. ✅ 跨端补全被 `platform_filter == "all"` 门反向拦截

**现象**：用户输 iOS bundle `com.ss.iphone.ugc.aweme.lite`、筛 Android → 0 结果。按"all"筛却能出双端结果（包括 Android 版抖音极速版）。

**根因**：`app.py:799` 和 `app.py:4675` 原本写着 `if extended_search and platform_filter == "all":`——老注释理由是"筛 iOS-only / Android-only 时强加对面结果会让用户困惑"。但这反了用户心理模型：

> 用户筛 Android = 用户要 Android 的答案，不管输入是什么平台的包名。如果他输的是 iOS 包但想看 Android 版，正好需要跨端补。

**修法**：移除 `platform_filter == "all"` 门，改成 `if extended_search:`。补出来的行自带 `_corrected` / `extended_fill` badge，前端（`main-v4.js:1623, 1632`）照现有逻辑画"跨端补全"徽章——用户清楚看到"我们纠正并反查了"，符合"永远给正确答案 + 明示纠正"的产品原则。

**验证**：
```
com.ss.iphone.ugc.aweme.lite + filter=android + extended=on
→ com.ss.android.ugc.aweme.lite / platform=Android / app_name=抖音极速版 / extended_fill=true ✅

com.ss.android.ugc.aweme.lite + filter=ios + extended=on
→ com.ss.iphone.ugc.aweme.lite / platform=iOS / extended_fill=true ✅

com.ss.iphone.ugc.aweme.lite + filter=android + extended=off
→ 0 结果（尊重用户关开关的意图，留后路）✅
```

**代码位置**：`app.py:799`（批量 streamed）+ `app.py:4675`（`/api/query` generator）。

---

### 19. ✅ `.v4-searchbox { overflow: hidden }` 把高级面板裁成 0 高

**现象**：桌面窗口缩到半屏（≤720px）点"高级设置"漏斗图标→点了没反应。扩大窗口才发现面板其实展开了。

**根因**：`.v4-advanced-popover` 是 `.v4-searchbox` 内 `position: absolute; top: calc(100% - 1px)` 向下伸出的子元素。移动端规则 `@media (max-width:720px) .v4-searchbox { overflow:hidden }`（原本是为了防 query 按钮被挤出边界）把 popover 的可见区裁成 0——**面板在，但完全不可见**。

**修法**：`overflow:hidden` 从 `.v4-searchbox` 移到 `.v4-search-top`（只管输入行），popover 保持可见。

**教训**：`position:absolute` 子元素受 **最近有 `overflow:visible` 以外值的定位祖先** 裁切。在父级加 overflow 前务必看有没有 absolute 子元素要溢出。

**代码位置**：`static/style-v4.css` line ≈1044 的 `@media (max-width:720px)` 块。

---

## #20 Homebrew python@3.12 默认不带 `_tkinter` → PyInstaller .app 启动时静默 import 失败 ✅

**场景**：用 `.venv-dev`（homebrew python@3.12 建的）打出 mac arm64 .app 后，双击/命令行启动，Flask 打印 "Serving Flask app 'app' / Debug mode: off" 就再没后续，`netstat` 看端口 9528 始终不 LISTEN。用 `sample <pid>` 抓栈看到卡在 `setipaddr` / `socket_gethostbyaddr`——但真正的根因在更早：主线程 `import tkinter as tk` 抛 `ModuleNotFoundError: No module named '_tkinter'`，整个进程立即崩；只是 Flask 的 daemon 线程已经起了一半日志。

**根因**：
1. macOS 上 `brew install python@3.12` **不包含 `_tkinter` C 扩展**（和 3.14 不同；也和 Apple `/usr/bin/python3` 不同）。需要额外装 `brew install python-tk@3.12` 才能 `import tkinter`。
2. spec 里写了 `hiddenimports = ['tkinter']`，但 PyInstaller 只能打进"构建机器上已装"的东西——源头没 `_tkinter.so`，spec 写再漂亮也没用。
3. app.py 的 Mac 分支依赖 tkinter 跑主循环（注册 NSApplication / 给 Dock 图标用），tkinter import 炸 = 整个 .app 失效。

**验法**：
```bash
.venv-dev/bin/python3 -c "import tkinter; print(tkinter.__file__)"
# 能输出路径 = OK；ModuleNotFoundError _tkinter = 需要 brew install python-tk@3.12
```

**修法**：
```bash
brew install python-tk@3.12    # 装进 python@3.12 的 framework，不用重建 venv
# 然后重新 pyinstaller ...
```

**教训**：每次换打包机器 / 升级 python 小版本后，**在 PyInstaller 之前先 smoke-test `import tkinter`**。这是 macOS .app 不启动的 #1 静默杀手——所有看起来像"Flask 启动慢"、"端口不 listen"的症状都可能是这货。

---

## #21 Werkzeug 3.x 启动反向 DNS 查询慢 15-20s，smoke-test 需 poll-until-up ✅

**场景**：.app 已修好 tkinter 问题，跑起来 Flask 日志到 "Debug mode: off" 就停，5-10s curl 打过去依然 000。差点以为又坏了，结果多等到 19s 突然打印 "Running on all addresses (0.0.0.0)" + 响应 200。

**根因**：Werkzeug 3.1.x 的 `run_simple` 启动末尾要列出 bind 到的所有接口 URL，对每个非 loopback IP 调 `socket.gethostbyaddr()` 做反查。macOS 上有 Warp/Tailscale/多网卡时这步能卡 15-20s，但**不阻塞已经 bind 好的 TCP listener**——所以进程确实在监听，只是还没打印那条日志。

**影响**：
- 用户双击 .app，`webbrowser.open` 在 1.5s 后打开浏览器，看到 "Connection refused" / "无法连接"，会误以为程序坏了。
- 测试脚本用固定 `sleep 5; curl ...` 会得到 000，冤枉程序没起。

**修法（测试侧）**：smoke-test 一律用 poll-until-up 循环，至少给 30s 上限：
```bash
for i in $(seq 1 30); do
  CODE=$(curl -s --max-time 1 --noproxy "*" -o /dev/null -w "%{http_code}" http://127.0.0.1:9528/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "UP at ${i}s"; break; fi
  sleep 1
done
```

**修法（产品侧）**：暂不处理。用户首次遇到 "连接失败" 页面，F5 刷新一次就能正常进。正经修要 monkey-patch werkzeug 或迁到 waitress/gunicorn，成本大收益小，先留坑。

**教训**："日志停在某一行" ≠ "进程挂了"。拿 `sample <pid>` 抓栈 5 秒，看是不是卡在某个具体的 syscall（gethostbyaddr / bind / accept），比瞎猜省时。

---

## #22 Tip 独占行（#16 P0 的修法）用户不买账：改回同行 + 省略号 ✅

**场景**：v1.2.0 发出去给用户装，用户反馈"tips 不要单独一行，恢复到之前的样子，太长的部分不要显示就好"。#16 P0 把 tip 做成独占工具栏最底下一行（`flex:0 0 100%; order:99`），用户觉得"太占结果页空间 / 视觉分量太重"。

**根因**：#16 P0 原本是为了修"tip 长文案挤垮右组按钮"，上一版修法选择把 tip 挤出去（独占一行、让开按钮）。但这改变了用户对"工具栏是一行"的期待，而且挤按钮的根因其实是右组 `.v4-tb-right` 没加 `flex-shrink:0`。只要右组不可挤 + tip 自己会省略号，就能既不挤按钮又保持一行。

**修法**：
```css
.v4-toolbar-tip {
  flex: 0 1 auto;      /* 允许被压缩（#16 P0 是 0 0 100% 独占一行） */
  min-width: 0;
  max-width: 780px;
  white-space: nowrap; /* #16 P0 原来改成 normal；现在必须 nowrap 才能跟 ellipsis 配 */
  overflow: hidden;
  text-overflow: ellipsis;
  /* order:99 也删掉，回到默认视觉顺序 */
}
.v4-tb-right { flex-shrink: 0; }  /* 护栏保留：tip 被压到 0 宽也不会挤按钮 */
```

**教训**：处理"A 挤 B"时有两种修法——让 A 独占一行（换行避让） or 让 A 可被压缩 + ellipsis（就地缩小）。前者破坏视觉层次，后者保持一行但"信息看不全"。正确选择要看用户对"完整展示 tip"和"保持一行"哪个优先。**这次选错了默认，下次 tip 这种次要信息优先就地压缩。**

**代码位置**：`static/style-v4.css:607` 附近 `.v4-toolbar-tip`。

---

## #23 `:not(:focus)` + JS scrollHeight 展开多行时序 bug：readScrollHeight 被 `!important` 压扁 ✅

**场景**：用户在结果页点搜索框想继续编辑，发现输入框依然是单行——多行内容 `dataset.raw` 还在，但 `input.value` 被改回多行后视觉上仍是 22px 高。

**根因（深坑）**：原实现 CSS 用 `:not(:focus)` 做折叠门：
```css
.v4-root.has-results .v4-search-input:not(:focus) {
  height: 22px !important; white-space: nowrap; ...
}
```
JS 在 `pointerdown`（focus **之前**就触发）里做展开：
```js
input.value = raw;                          // 写回多行值
input.style.height = 'auto';                 // 想让 scrollHeight 重测
input.style.height = Math.min(scrollHeight, 160) + 'px';
```
**问题**：pointerdown 那一刻 `:focus` 还没激活，CSS `height:22px !important` 还在强制压制 textarea。`input.style.height = 'auto'` 是 inline style，**斗不过 `!important`**——browser 计算高度仍是 22px，`scrollHeight` 读出来也是 22px 左右（textarea 里的真实多行内容被 overflow:hidden 截没了）。于是 inline 设回 `22px`，focus 事件后 CSS `:not(:focus)` 虽然失效，但 inline `22px` 已经固化 → 输入框死活不展开。

**修法**：放弃 `:not(:focus)` 这道 CSS 门，改用 JS 显式加/减 `.is-collapsed` class：
```css
.v4-root.has-results .v4-search-input.is-collapsed {
  height: 22px !important; white-space: nowrap; ...
}
```
```js
function _expandInputToMultilineIfAny() {
  input.classList.remove('is-collapsed');   // ⚠ 必须第一步：解开 !important 束缚
  if (input.value.includes('\n')) { /* 重测高度 */ return; }
  if (input.value.trim() === _toDisplayForm(raw)) input.value = raw;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
```
时序完全由 JS 控制：先摘帽、再读 scrollHeight。collapse 函数收尾统一 `classList.add('is-collapsed')` 把帽重新戴上。

**教训**：**用 `:not(:focus)` / `:focus` 做 CSS 门 + JS 依赖 scrollHeight 的组合是个坑**——`:focus` 是浏览器事件链里的"后半节"，JS 在 pointerdown/mousedown 已经要读测量，`!important` 和 inline style 谁赢取决于"此刻 :focus 是否激活"这种飘忽的状态。改成 JS 控制的显式 class，时序可读可控。

遇到类似 pattern（CSS 伪类门 + JS 测量/写入）先问一句：**"读测量的那一刻，伪类是否已经切到期望状态？"** 答案是"不一定/有时"就换 class 门。

**代码位置**：`static/style-v4.css:525` `.v4-root.has-results .v4-search-input.is-collapsed` + `static/main-v4.js:2208, 2258` 的 collapse/expand 函数。

---

## 维护约定

- 新增条目：在"状态汇总"表 + "条目详情"各加一条，保持编号连续。
- 完成条目：状态标 ✅，详情保留原文 + 加一段"解决"的简述和代码位置。
- 废弃条目：状态标 ❌ 并写明"不做理由"。
