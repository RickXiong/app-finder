/* ============================================================
   AppLookup V4 — UI + Slice 2（搜索 / SSE / 表格 / 工具栏 / 重试 / 后台恢复）
   ============================================================ */
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    /* 复制兼容：HTTP(非安全上下文) 或旧浏览器下 navigator.clipboard 不可用，
       回退到 execCommand + textarea。手机通过 LAN IP 访问大部分是 http://，
       必须有 fallback，否则所有"点击复制"在手机上都静默失败。 */
    function copyToClipboard(text) {
        text = String(text == null ? '' : text);
        // 优先 async API（https / localhost / localhost-like 下可用）
        try {
            if (navigator.clipboard && window.isSecureContext) {
                return navigator.clipboard.writeText(text);
            }
        } catch (_) {}
        // 回退：临时 textarea + execCommand('copy')
        return new Promise((resolve, reject) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.left = '0';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                ta.setSelectionRange(0, text.length);
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                ok ? resolve() : reject(new Error('execCommand copy failed'));
            } catch (e) { reject(e); }
        });
    }
    // 统一的读取剪贴板（粘贴），用于 btnPaste
    async function readClipboard() {
        if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }
        throw new Error('clipboard read not available in insecure context');
    }

    /* ---------- 常量 ---------- */
    const PENDING_JOB_KEY = 'app_finder_pending_job';
    const BATCH_WARN_THRESHOLD = 50;
    const BATCH_HARD_THRESHOLD = 100;
    const BG_BANNER_DELAY = 5000;
    const ICON_RETRY_MAX = 2;
    // tips.js 暴露 getRandomTip()；未加载时兜底
    const _fallbackTips = [
        '多个 App 可以粘贴成多行一次性查询',
        '支持中文名 / 包名 / Bundle ID 混合输入',
        '关闭页面后查询在后台继续，返回可续看',
    ];
    const nextTip = () => (typeof getRandomTip === 'function') ? getRandomTip()
        : _fallbackTips[Math.floor(Math.random() * _fallbackTips.length)];
    // 结果页专用 —— 使用类 tips（提醒用户"改延迟""跨端补全"等），
    // tips.js 没加载或老版本时回退到 nextTip()
    const nextUsageTip = () => (typeof getRandomUsageTip === 'function') ? getRandomUsageTip()
        : nextTip();

    /* ---------- 访问模式 + 跨浏览器设置同步 ----------
       同一台电脑上 Chrome / Safari / Firefox 的 localStorage 是沙箱隔离的，
       想让它们看到"同一套设置和历史"，只能走服务端存一份共享。但这件事只能
       对"本机访问"做——手机等 LAN 访客的设置仍然走它各自的 localStorage，
       否则手机改主题会把电脑的也改掉，体验反而变差。
       "是不是本机"必须问服务端（根据请求源 IP），前端靠 window.location.hostname
       判不准：用户可能敲 127.0.0.1 / localhost / 本机 LAN IP 三种入口打开，
       它们 hostname 不一样但其实都是同一台机器。
       启动策略：先用本地 localStorage 值秒级渲染（不白屏），再异步拉服务端
       设置"补差覆盖"——这是"渐进增强"的标准姿势。 */
    const _sync = {
        isLocal: null,  // null=未知 / true=本机 / false=LAN
        ready:   false, // bootstrap 完成了没（完成前的 _pushSettings 会被丢弃，避免和首次迁移打架）
    };
    /* TIPS #15：每个 tab/浏览器一个 client_id。PUT 带 X-Client-Id header，SSE 订阅带 client_id
       query 参数。服务端广播时跳过 sender 的那个连接——避免自己改完被服务端 echo 回来重复应用
       （用户选了方案"不收"）。用 sessionStorage 而非 localStorage：同一浏览器开 2 个 tab 算两个
       独立"客户端"，各自 SSE，互相也会同步。 */
    const _clientId = (() => {
        try {
            let id = sessionStorage.getItem('app_finder_client_id');
            if (!id) {
                id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
                sessionStorage.setItem('app_finder_client_id', id);
            }
            return id;
        } catch { return 'c_' + Math.random().toString(36).slice(2); }
    })();
    function _gatherLocalSettings() {
        const s = {};
        try { const t = localStorage.getItem('applookup_v4_theme'); if (t) s.theme = t; } catch {}
        try {
            const iv = localStorage.getItem('app_finder_query_interval_ms');
            if (iv !== null) {
                const v = parseInt(iv, 10);
                if (Number.isFinite(v) && v >= 0) s.interval_ms = v;
            }
        } catch {}
        // TIPS #14: 高级设置 chip 状态（platform/match/ext/opts）一起塞进迁移包，
        // 老用户首次用 127 模式时，本地 localStorage 里的 filters 能被推到服务端共享。
        try {
            const raw = localStorage.getItem('app_finder_v4_filters');
            if (raw) {
                const v = JSON.parse(raw);
                if (v && typeof v === 'object') s.filters = v;
            }
        } catch {}
        return s;
    }
    function _applyServerSettings(s) {
        // 主题：以服务端为准
        if (s.theme && typeof applyTheme === 'function') {
            try { localStorage.setItem('applookup_v4_theme', s.theme); } catch {}
            applyTheme(s.theme);
        }
        // 间隔：以服务端为准（同步 slider + label 显示）
        if (typeof s.interval_ms === 'number' && s.interval_ms >= 0) {
            try { localStorage.setItem('app_finder_query_interval_ms', String(s.interval_ms)); } catch {}
            const sl  = document.getElementById('intervalSlider');
            const lbl = document.getElementById('intervalValText');
            if (sl) sl.value = s.interval_ms;
            if (lbl && typeof formatIntervalLabel === 'function') {
                lbl.textContent = formatIntervalLabel(s.interval_ms);
            }
        }
        // TIPS #14: filters——服务端覆盖 + 回写 localStorage + 刷 chip UI。
        // 调用点在 IIFE 底部的 _bootstrapSync，那时 _applyFilterSnapshot /
        // _reflectFiltersToChips 都已定义（它们在 btnResetAdv 下方）。
        if (s.filters && typeof s.filters === 'object' && typeof _applyFilterSnapshot === 'function') {
            if (_applyFilterSnapshot(s.filters)) {
                try { localStorage.setItem('app_finder_v4_filters', JSON.stringify(s.filters)); } catch {}
                _reflectFiltersToChips();
            }
        }
    }
    async function _pushSettingsNow(delta) {
        if (!_sync.isLocal || !_sync.ready) return;
        if (!delta || !Object.keys(delta).length) return;
        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Id':  _clientId,   // TIPS #15: 服务端广播时跳过自己
                },
                body: JSON.stringify(delta),
            });
        } catch {}
    }
    // 暴露给 IIFE 里其它"改设置"的地方调用（主题按钮、间隔 slider ...）
    window._pushSettings = _pushSettingsNow;

    /* TIPS #15: 订阅 /api/settings_stream —— 其它浏览器 PUT /api/settings 时服务端把
       最新 snapshot 推给这里，实时同步 theme / interval_ms / filters 等全部白名单字段。
       EventSource 自带自动重连（默认 3s），断网回来无需手动处理。只在 _sync.isLocal=true
       时挂；LAN 访客 is_local=false，服务端也会 403 挡掉，连不上。 */
    let _settingsES = null;
    function _subscribeSettingsStream() {
        if (_settingsES) return;
        try {
            _settingsES = new EventSource('/api/settings_stream?client_id=' + encodeURIComponent(_clientId));
            _settingsES.addEventListener('settings', (e) => {
                try {
                    const s = JSON.parse(e.data);
                    if (s && typeof s === 'object') _applyServerSettings(s);
                } catch {}
            });
            // error 事件只记不处理——浏览器已在自动重连
            _settingsES.addEventListener('error', () => { /* noop, 交给浏览器重连 */ });
        } catch {
            _settingsES = null;
        }
    }

    async function _bootstrapSync() {
        try {
            const r = await fetch('/api/access_mode');
            if (r.ok) {
                const d = await r.json();
                _sync.isLocal = !!d.is_local;
            } else _sync.isLocal = false;
        } catch {
            _sync.isLocal = false;
        }
        document.documentElement.setAttribute('data-access-mode', _sync.isLocal ? 'local' : 'lan');

        if (_sync.isLocal) {
            // 本机模式：拉一次 settings
            try {
                const r = await fetch('/api/settings');
                if (r.ok) {
                    const d  = await r.json();
                    const s  = d.settings || {};
                    const real = Object.keys(s).filter(k => k !== 'updated_at');
                    if (real.length === 0) {
                        // 服务端空：把本地现有设置一次性推上去（首次启动 / 老用户迁移）
                        const local = _gatherLocalSettings();
                        if (Object.keys(local).length) {
                            try {
                                await fetch('/api/settings', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(local),
                                });
                            } catch {}
                        }
                    } else {
                        // 服务端有值：覆盖本地（last-write-wins）
                        _applyServerSettings(s);
                    }
                }
            } catch {}
            // 本机模式历史永远共享——强制打开开关、刷新服务端缓存、重绘一次抽屉
            try {
                if (typeof sharedHistoryEnabled !== 'undefined') sharedHistoryEnabled = true;
                localStorage.setItem('app_finder_shared_history_enabled', '1');
            } catch {}
            if (typeof refreshServerHistory === 'function') {
                try {
                    await refreshServerHistory();
                    if (typeof renderHistory === 'function') renderHistory();
                } catch {}
            }
            // TIPS #15: 本机模式 bootstrap 结束前挂 SSE 订阅，实时接收其它浏览器的设置改动
            _subscribeSettingsStream();
        }
        _sync.ready = true;
    }

    /* ---------- 主题 ---------- */
    const THEME_KEY = 'applookup_v4_theme';
    const applyTheme = (mode) => {
        let actual = mode;
        if (mode === 'system' || !mode) {
            actual = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', actual);
        document.documentElement.setAttribute('data-theme-mode', mode || 'system');
    };
    const loadThemeMode = () => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } };
    const saveThemeMode = (m) => { try { localStorage.setItem(THEME_KEY, m); } catch {} };
    applyTheme(loadThemeMode());
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (loadThemeMode() === 'system') applyTheme('system');
        });
    }

    /* ---------- 输入框 ---------- */
    const input = $('#searchInput');
    const btnClear = $('#btnClear');
    const parseLines = (txt) => txt.split('\n').map(s => s.trim()).filter(Boolean);
    // TIPS #16 P2 延伸：窄屏下长 placeholder 会被 Safari/iOS 单行截断（"支持批量粘贴"看不全），
    // 按 viewport 宽度动态换短版文案；用 dataset 保存原版供离开窄屏时还原。
    const PH_DESKTOP = '输入 App 名或包名，每行一个 · 支持批量粘贴';
    const PH_MOBILE  = 'App 名 / 包名（可多行粘贴）';
    const _applyPlaceholder = () => {
        // 不覆盖"备注编辑态"—— main-v4.js:716 会临时改 placeholder，dataset.phInertia 标记保护
        if (input.dataset.phInertia) return;
        input.placeholder = window.matchMedia('(max-width: 720px)').matches ? PH_MOBILE : PH_DESKTOP;
    };
    _applyPlaceholder();
    window.addEventListener('resize', _applyPlaceholder);
    const autoGrow = () => {
        input.style.height = 'auto';
        const sh = input.scrollHeight;
        // TIPS #16 P2: 窄屏 placeholder 目前是单行短版（见上方 PH_MOBILE），
        // 不再需要把 min-height 撑到两行。为保持视觉稳定，
        // 空值时 min 提到 44px 保证可点击区不塌陷。
        const min = (!input.value && window.matchMedia('(max-width: 720px)').matches) ? 44 : 0;
        input.style.height = Math.max(min, Math.min(sh, 160)) + 'px';
    };
    const updateInputUI = () => { btnClear.hidden = !input.value; autoGrow(); };
    input.addEventListener('input', updateInputUI);
    btnClear.addEventListener('click', () => { input.value = ''; updateInputUI(); input.focus(); });

    $('#btnPaste').addEventListener('click', async () => {
        try {
            const t = await readClipboard();
            if (!t) return;
            input.value = input.value ? input.value + '\n' + t : t;
            updateInputUI();
            input.focus();
        } catch (e) {
            // HTTP/非安全上下文下读剪贴板被浏览器拒绝，提示用户手动粘贴
            toast('请长按输入框手动粘贴（浏览器安全限制）');
        }
    });

    input.addEventListener('keydown', (e) => {
        // isComposing: 中文输入法正在选字时，Enter 属于确认候选，不应该触发查询。
        if (e.isComposing) return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); triggerQuery(); }
    });
    $('#btnQuery').addEventListener('click', triggerQuery);

    /* ---------- 高级设置（popover，不挤动布局） ---------- */
    const panel = $('#advancedPanel');
    const btnAdv = $('#btnAdvanced');
    const advBadge = $('#advBadge');
    const searchbox = panel.closest('.v4-searchbox');
    panel.hidden = false;
    function setAdvOpen(open) {
        panel.classList.toggle('open', open);
        btnAdv.classList.toggle('on', open);
        btnAdv.setAttribute('aria-expanded', String(open));
        if (searchbox) searchbox.classList.toggle('adv-open', open);
    }
    btnAdv.addEventListener('click', (e) => {
        e.stopPropagation();
        setAdvOpen(!panel.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
        if (!panel.classList.contains('open')) return;
        if (e.target.closest('#advancedPanel') || e.target.closest('#btnAdvanced')) return;
        setAdvOpen(false);
    });

    // opts: 行为开关（默认都开）。extended = 跨端补全；keep = 保留输入
    const filters = { platform: 'all', match: 'fuzzy', ext: new Set(), opts: new Set(['extended', 'keep']) };
    const OPT_DEFAULTS = new Set(['extended', 'keep']);
    const updateAdvBadge = () => {
        // opts 与默认值不同才算"脏"：默认都开，只有关掉某个才算用户修改
        const optsDirty = filters.opts.size !== OPT_DEFAULTS.size
            || [...OPT_DEFAULTS].some(k => !filters.opts.has(k));
        const dirty = filters.platform !== 'all' || filters.match !== 'fuzzy' || filters.ext.size > 0 || optsDirty;
        advBadge.hidden = !dirty;
    };
    const updateExtDisabled = () => {
        const disable = filters.platform === 'ios';
        document.querySelectorAll('[data-group="ext"] .v4-chip').forEach(btn => {
            btn.classList.toggle('disabled', disable);
            if (disable) {
                const v = btn.dataset.value;
                if (filters.ext.has(v)) { filters.ext.delete(v); btn.classList.remove('on'); }
            }
        });
    };
    document.querySelectorAll('.v4-adv-chips').forEach(group => {
        const name = group.dataset.group;
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('.v4-chip');
            if (!btn || btn.classList.contains('disabled')) return;
            const v = btn.dataset.value;
            if (name === 'ext' || name === 'opts') {
                const set = filters[name];
                if (set.has(v)) { set.delete(v); btn.classList.remove('on'); }
                else { set.add(v); btn.classList.add('on'); }
            } else {
                filters[name] = v;
                group.querySelectorAll('.v4-chip').forEach(b => b.classList.toggle('on', b.dataset.value === v));
                if (name === 'platform') updateExtDisabled();
            }
            updateAdvBadge();
            _persistFilters();   // TIPS #14: chip 改 → 立刻落盘 + 推服务端
        });
    });
    $('#btnResetAdv').addEventListener('click', () => {
        filters.platform = 'all'; filters.match = 'fuzzy'; filters.ext.clear();
        filters.opts = new Set(OPT_DEFAULTS);
        document.querySelectorAll('[data-group="platform"] .v4-chip').forEach(b => b.classList.toggle('on', b.dataset.value === 'all'));
        document.querySelectorAll('[data-group="match"] .v4-chip').forEach(b => b.classList.toggle('on', b.dataset.value === 'fuzzy'));
        document.querySelectorAll('[data-group="ext"] .v4-chip').forEach(b => b.classList.remove('on'));
        document.querySelectorAll('[data-group="opts"] .v4-chip').forEach(b => b.classList.toggle('on', OPT_DEFAULTS.has(b.dataset.value)));
        updateExtDisabled(); updateAdvBadge();
        _persistFilters();   // 重置也要同步掉线上旧值，别让刷新后服务端 push 复活老设置
    });

    /* ---------- 高级设置持久化（TIPS #14） ----------
       高级设置 chip 的状态（platform / match / ext / opts）必须跨刷新保留。
       走"四步不变量"：
         1) 用户改 chip → filters Set 改 → _persistFilters()       ← 生成 + 存
         2) IIFE 启动 → 从 localStorage hydrate → _reflectFiltersToChips()  ← 读 + 反映 UI
         3) 本机 127 模式 → _bootstrapSync 拉服务端 → _applyServerSettings() 内处理 filters ← 跨浏览器同步
         4) 下面任何 UI 开关新加时，只要调 _persistFilters() 即可，四步自动闭环
       localStorage key: app_finder_v4_filters
       序列化形式：{platform: 'all'|..., match: 'fuzzy'|..., ext: ['sha256',...], opts: [...] }
       —— Set 必须转 array 才能 JSON；hydrate 时再 new Set()。 */
    const FILTERS_LS_KEY = 'app_finder_v4_filters';
    function _filtersSnapshot() {
        return {
            platform: filters.platform,
            match:    filters.match,
            ext:      [...filters.ext],
            opts:     [...filters.opts],
        };
    }
    function _applyFilterSnapshot(raw) {
        // 防御：任何字段形状不对就跳过该字段而不是整体崩
        if (!raw || typeof raw !== 'object') return false;
        let touched = false;
        if (typeof raw.platform === 'string') { filters.platform = raw.platform; touched = true; }
        if (typeof raw.match    === 'string') { filters.match    = raw.match;    touched = true; }
        if (Array.isArray(raw.ext))  { filters.ext  = new Set(raw.ext.filter(x => typeof x === 'string'));  touched = true; }
        if (Array.isArray(raw.opts)) { filters.opts = new Set(raw.opts.filter(x => typeof x === 'string')); touched = true; }
        return touched;
    }
    function _reflectFiltersToChips() {
        document.querySelectorAll('[data-group="platform"] .v4-chip')
            .forEach(b => b.classList.toggle('on', b.dataset.value === filters.platform));
        document.querySelectorAll('[data-group="match"] .v4-chip')
            .forEach(b => b.classList.toggle('on', b.dataset.value === filters.match));
        document.querySelectorAll('[data-group="ext"] .v4-chip')
            .forEach(b => b.classList.toggle('on', filters.ext.has(b.dataset.value)));
        document.querySelectorAll('[data-group="opts"] .v4-chip')
            .forEach(b => b.classList.toggle('on', filters.opts.has(b.dataset.value)));
        updateExtDisabled();    // iOS 时 ext 里某些条目要禁用 + 清掉
        updateAdvBadge();
    }
    function _persistFilters() {
        const snapshot = _filtersSnapshot();
        try { localStorage.setItem(FILTERS_LS_KEY, JSON.stringify(snapshot)); } catch {}
        // 127 模式下推服务端（LAN 模式 _pushSettingsNow 里 isLocal=false 会直接 return）
        if (window._pushSettings) window._pushSettings({ filters: snapshot });
    }
    // 启动：从 localStorage hydrate 一次，反映到 chip UI。
    // 之后 _bootstrapSync 可能异步拉到服务端值 → _applyServerSettings 再 override 一次。
    try {
        const raw = JSON.parse(localStorage.getItem(FILTERS_LS_KEY) || 'null');
        if (_applyFilterSnapshot(raw)) _reflectFiltersToChips();
    } catch {}

    /* ---------- 主题切换按钮（浅色 → 深色 → 跟随系统 循环） ---------- */
    $('#btnTheme').addEventListener('click', () => {
        const cur = loadThemeMode();
        const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
        saveThemeMode(next); applyTheme(next);
        // 本机模式下把新主题同步到服务端，Safari / Firefox 等其它浏览器下次打开就一致
        if (typeof window._pushSettings === 'function') window._pushSettings({ theme: next });
        const label = next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统';
        toast('主题：' + label);
    });

    /* ---------- 查询间隔持久化 ---------- */
    const INTERVAL_KEY = 'app_finder_query_interval_ms';
    // 区分"用户从没改过"和"用户改过并且选了0"——前者在批量(>2行)时自动加 1s
    // 节流保护商店；后者尊重用户意愿。
    const _readUserInterval = () => {
        try { return localStorage.getItem(INTERVAL_KEY); } catch { return null; }
    };
    const getIntervalMs = (lineCount = 1) => {
        const stored = _readUserInterval();
        if (stored !== null) {
            const v = parseInt(stored, 10);
            return Number.isFinite(v) && v >= 0 ? v : 0;
        }
        // 用户从未设置：>2 条自动间隔 1s，单条/两条保持 Auto (0)
        return lineCount > 2 ? 1000 : 0;
    };
    const formatIntervalLabel = (ms) => ms === 0 ? 'Auto' : (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's';
    (function initIntervalSlider() {
        const sl = $('#intervalSlider');
        const lbl = $('#intervalValText');
        if (!sl || !lbl) return;
        const cur = getIntervalMs();
        sl.value = cur;
        lbl.textContent = formatIntervalLabel(cur);
        sl.addEventListener('input', () => {
            lbl.textContent = formatIntervalLabel(parseInt(sl.value, 10) || 0);
        });
        sl.addEventListener('change', () => {
            const v = parseInt(sl.value, 10) || 0;
            try { localStorage.setItem(INTERVAL_KEY, String(v)); } catch {}
            // 本机模式下把新间隔同步到服务端，其它浏览器下次打开一致
            if (typeof window._pushSettings === 'function') window._pushSettings({ interval_ms: v });
            toast('查询间隔已设为 ' + formatIntervalLabel(v));
        });
    })();

    /* ---------- Popover 通用开关 ---------- */
    function togglePopover(popId, anchorBtn) {
        const pop = $(popId);
        if (!pop) return;
        const wasHidden = pop.hidden;
        document.querySelectorAll('.v4-popover, .v4-interval-drop').forEach(p => { p.hidden = true; });
        document.querySelectorAll('.v4-icon-btn.drop-open').forEach(b => b.classList.remove('drop-open'));
        if (!wasHidden) return;
        pop.hidden = false;
        anchorBtn.classList.add('drop-open');
        const rect = anchorBtn.getBoundingClientRect();
        const popW = pop.offsetWidth || rect.width;
        const left = rect.left + window.scrollX + (rect.width - popW) / 2;
        pop.style.left = Math.max(4, left) + 'px';
        pop.style.right = 'auto';
        // 从 icon 底边紧贴着往下延伸（盖住 1px 接缝）
        pop.style.top = (rect.bottom + window.scrollY - 1) + 'px';
        const onDoc = (ev) => {
            if (pop.contains(ev.target) || anchorBtn.contains(ev.target)) return;
            pop.hidden = true;
            anchorBtn.classList.remove('drop-open');
            document.removeEventListener('click', onDoc, true);
        };
        setTimeout(() => document.addEventListener('click', onDoc, true), 0);
    }
    $('#btnInterval').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover('#popoverInterval', e.currentTarget);
    });

    /* ---------- 开机自启（点击切换，toast 提示） ---------- */
    let _startupEnabled = null;
    function reflectStartupBtn() {
        const btn = $('#btnAutostart');
        if (!btn) return;
        btn.classList.toggle('on', !!_startupEnabled);
        btn.title = _startupEnabled ? '开机启动：已开启（点击取消）' : '开机启动：未开启（点击开启）';
    }
    async function fetchStartupStatus() {
        try {
            const r = await fetch('/api/startup/status');
            if (!r.ok) return;
            const d = await r.json();
            _startupEnabled = !!d.enabled;
            reflectStartupBtn();
        } catch {}
    }
    fetchStartupStatus();

    /* 非本机（局域网其它设备访问）不应看到 LAN / 开机启动 等管理入口 */
    (async () => {
        try {
            const r = await fetch('/api/lan_info');
            if (!r.ok) return;
            const d = await r.json();
            if (!d.is_admin) {
                const lanBtn = $('#btnLan'); if (lanBtn) lanBtn.hidden = true;
                const autoBtn = $('#btnAutostart'); if (autoBtn) autoBtn.hidden = true;
            }
        } catch {}
    })();
    $('#btnAutostart').addEventListener('click', async () => {
        const next = !_startupEnabled;
        try {
            const r = await fetch('/api/startup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enable: next }),
            });
            const d = await r.json();
            _startupEnabled = !!d.enabled;
            reflectStartupBtn();
            toast('开机启动：' + (_startupEnabled ? '已开启' : '已取消'));
        } catch (e) { toast('操作失败：' + e.message); }
    });

    /* ---------- LAN 分享 Modal ---------- */
    let _lanStatsTimer = null;
    function _lanAgo(sec) {
        if (sec < 5) return '刚刚';
        if (sec < 60) return sec + ' 秒前';
        if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
        if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前';
        return '很久前';
    }
    function renderLanStats(data) {
        const wrap = $('#lanStatsWrap');
        if (!wrap) return;
        if (!data || !data.enabled) { wrap.innerHTML = ''; return; }
        if (!data.device_count) {
            wrap.innerHTML = `
                <div class="v4-lan-stats-head">📡 连接设备 <span class="v4-lan-stats-sum">暂无其他设备</span></div>
                <div class="v4-lan-stats-empty">开启后，同 Wi-Fi 的其他设备访问过的会出现在这里</div>`;
            return;
        }
        const rows = data.devices.map(d => {
            const primary = d.note || d.hostname || d.ua_short || '未知设备';
            const active = d.last_seen_ago_sec < 60 && !d.blocked;
            const subBits = [d.ip];
            if (d.ua_short && d.ua_short !== primary) subBits.push(esc(d.ua_short));
            return `
                <div class="v4-lan-device ${active ? 'active' : ''} ${d.blocked ? 'blocked' : ''}" data-ip="${esc(d.ip)}">
                    <span class="v4-lan-dot ${active ? 'on' : ''}"></span>
                    <div class="v4-lan-dev-main">
                        <div class="v4-lan-dev-name" data-act="note" data-ip="${esc(d.ip)}" data-note="${esc(d.note || '')}" title="点击编辑备注">${esc(primary)}${d.note ? '<span class="v4-lan-dev-note-tag">备注</span>' : ''}</div>
                        <div class="v4-lan-dev-sub">${subBits.join(' · ')}</div>
                    </div>
                    <div class="v4-lan-dev-meta">
                        ${d.blocked ? '<span class="v4-lan-dev-blocked">已屏蔽</span>' :
                          `<span class="v4-lan-dev-count">${d.query_count} 次</span><span class="v4-lan-dev-ago">${_lanAgo(d.last_seen_ago_sec)}</span>`}
                    </div>
                    <div class="v4-lan-dev-actions">
                        <button class="v4-lan-dev-btn" data-act="note" data-ip="${esc(d.ip)}" data-note="${esc(d.note || '')}" title="备注">✎</button>
                        <button class="v4-lan-dev-btn" data-act="${d.blocked ? 'unblock' : 'block'}" data-ip="${esc(d.ip)}" title="${d.blocked ? '解除屏蔽' : '屏蔽'}">${d.blocked ? '✓' : '⊘'}</button>
                    </div>
                </div>`;
        }).join('');
        wrap.innerHTML = `
            <div class="v4-lan-stats-head">
                📡 连接设备
                <span class="v4-lan-stats-sum">${data.device_count} 台 · ${data.total_queries} 次查询</span>
            </div>
            ${rows}`;
    }
    async function refreshLanStats() {
        try {
            const r = await fetch('/api/lan_stats');
            const d = await r.json();
            renderLanStats(d);
        } catch {}
    }
    function startLanStatsPolling() {
        refreshLanStats();
        if (_lanStatsTimer) clearInterval(_lanStatsTimer);
        _lanStatsTimer = setInterval(refreshLanStats, 4000);
    }
    function stopLanStatsPolling() {
        if (_lanStatsTimer) { clearInterval(_lanStatsTimer); _lanStatsTimer = null; }
    }

    async function renderLanShare() {
        const body = $('#lanShareBody');
        body.innerHTML = '<div class="v4-pop-hint" style="text-align:center;padding:32px;">加载中…</div>';
        try {
            const r = await fetch('/api/lan_info');
            const d = await r.json();
            if (!d.accessible) {
                stopLanStatsPolling();
                body.innerHTML = `<div class="v4-lan-unavail">
                    <div class="v4-lan-unavail-title">⚠ 没检测到可用的局域网</div>
                    <div>请确认本机已连接 Wi-Fi / 有线局域网后重新打开。</div>
                </div>`;
                return;
            }
            const isAdmin = !!d.is_admin;
            const enabled = !!d.enabled;
            body.innerHTML = `
                <div class="v4-lan-layout ${enabled ? '' : 'single'}">
                    <div class="v4-lan-col-left">
                        <label class="v4-lan-toggle-row">
                            <input type="checkbox" id="lanToggle" ${enabled ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}>
                            <span class="v4-lan-switch"></span>
                            <span class="v4-lan-toggle-text">
                                <b>${enabled ? 'LAN 共享已开启' : 'LAN 共享未开启'}</b>
                                <span class="v4-lan-toggle-sub">${isAdmin
                                    ? (enabled ? '同 Wi-Fi 设备可访问下方地址' : '打开开关后其他设备才能访问')
                                    : '🔐 仅本机管理员可切换'}</span>
                            </span>
                        </label>
                        <div class="v4-lan-warn">
                            ⚠ <b>仅限局域网</b>访问，无账号密码保护，请仅在信任的网络开启。
                        </div>
                        <div class="v4-lan-content ${enabled ? '' : 'v4-lan-disabled'}">
                            <div class="v4-lan-url-card" data-copy="${esc(d.url || '')}" title="点击复制">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                <span class="v4-lan-url-text">${esc(d.url || '')}</span>
                            </div>
                            ${d.qr_data_url ? `<img src="${esc(d.qr_data_url)}" alt="扫码访问" class="v4-lan-qr" />` : ''}
                            <div class="v4-lan-note">手机扫码或输入地址即可 · 本机 IP ${esc(d.lan_ip || '')}</div>
                        </div>
                    </div>
                    <div class="v4-lan-col-right" ${enabled ? '' : 'hidden'}>
                        <div id="lanStatsWrap" class="v4-lan-stats"></div>
                    </div>
                </div>`;

            const urlCard = body.querySelector('.v4-lan-url-card');
            if (urlCard) urlCard.addEventListener('click', (e) => {
                const url = e.currentTarget.dataset.copy;
                if (url) copyToClipboard(url).then(() => toast('已复制地址')).catch(() => toast('复制失败'));
            });
            const tog = body.querySelector('#lanToggle');
            if (tog && isAdmin) {
                tog.addEventListener('change', async () => {
                    const next = tog.checked;
                    tog.disabled = true;
                    try {
                        const rr = await fetch('/api/lan_toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled: next }),
                        });
                        const dd = await rr.json();
                        if (dd.ok) { toast(dd.enabled ? '已开启 LAN 共享' : '已关闭 LAN 共享'); renderLanShare(); }
                        else { toast('切换失败：' + (dd.error || '')); tog.checked = !next; }
                    } catch (err) { toast('切换失败：' + err.message); tog.checked = !next; }
                    finally { tog.disabled = false; }
                });
            }
            if (enabled) startLanStatsPolling(); else stopLanStatsPolling();
        } catch (e) {
            stopLanStatsPolling();
            body.innerHTML = `<div class="v4-lan-unavail"><div class="v4-lan-unavail-title">加载失败</div><div>${esc(e.message)}</div></div>`;
        }
    }

    $('#btnLan').addEventListener('click', () => {
        $('#lanShareMask').hidden = false;
        renderLanShare();
    });
    function closeLanShare() {
        $('#lanShareMask').hidden = true;
        stopLanStatsPolling();
    }
    $('#btnLanClose').addEventListener('click', closeLanShare);
    $('#lanShareMask').addEventListener('click', (e) => {
        if (e.target.id === 'lanShareMask') closeLanShare();
    });

    /* 设备卡操作（备注 / 屏蔽） —— 备注走原地编辑，不再弹窗 */
    function startEditDeviceNote(trigger) {
        const row = trigger.closest('.v4-lan-device');
        if (!row) return;
        const nameEl = row.querySelector('.v4-lan-dev-name');
        if (!nameEl || nameEl.querySelector('input')) return;

        const ip = row.dataset.ip;
        const currentNote = nameEl.dataset.note || '';
        const origHTML = nameEl.innerHTML;

        // 编辑期间暂停轮询刷新
        const wasPolling = !!_lanStatsTimer;
        if (wasPolling) { clearInterval(_lanStatsTimer); _lanStatsTimer = null; }
        const resume = () => {
            if (wasPolling && !_lanStatsTimer) _lanStatsTimer = setInterval(refreshLanStats, 4000);
        };

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'v4-lan-dev-name-edit';
        input.value = currentNote;
        input.placeholder = '备注（回车保存 / Esc 取消）';
        input.maxLength = 40;

        nameEl.innerHTML = '';
        nameEl.appendChild(input);
        nameEl.classList.add('editing');
        input.focus();
        input.select();

        let finished = false;
        const cancel = () => {
            if (finished) return; finished = true;
            nameEl.innerHTML = origHTML;
            nameEl.classList.remove('editing');
            resume();
        };
        const save = async () => {
            if (finished) return; finished = true;
            const next = input.value.trim();
            if (next === currentNote) { cancel(); return; }
            try {
                const r = await fetch('/api/lan_device_note', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip, note: next }),
                });
                const d = await r.json();
                if (d.ok) {
                    toast(next ? `已备注：${next}` : '已清除备注');
                    nameEl.classList.remove('editing');
                    refreshLanStats();
                } else {
                    toast('保存失败：' + (d.error || ''));
                    nameEl.innerHTML = origHTML;
                    nameEl.classList.remove('editing');
                }
            } catch (err) {
                toast('保存失败：' + err.message);
                nameEl.innerHTML = origHTML;
                nameEl.classList.remove('editing');
            }
            resume();
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => setTimeout(save, 50));
    }

    document.addEventListener('click', async (e) => {
        // 点击设备名或 ✎ 按钮 → 原地编辑备注
        const noteTrigger = e.target.closest('[data-act="note"]');
        if (noteTrigger) {
            e.stopPropagation();
            startEditDeviceNote(noteTrigger);
            return;
        }
        const btn = e.target.closest('.v4-lan-dev-btn');
        if (!btn) return;
        const act = btn.dataset.act;
        const ip  = btn.dataset.ip;
        if (!ip) return;
        if (act === 'block' || act === 'unblock') {
            if (act === 'block' && !confirm(`确定屏蔽 ${ip} 吗？该设备将无法访问本工具（可在此面板解除）。`)) return;
            try {
                const r = await fetch('/api/lan_device_block', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip, blocked: act === 'block' }),
                });
                const d = await r.json();
                if (d.ok) { toast(act === 'block' ? '已屏蔽该设备' : '已解除屏蔽'); refreshLanStats(); }
                else toast('操作失败：' + (d.error || ''));
            } catch (err) { toast('操作失败：' + err.message); }
        }
    });

    /* ---------- 关于 Modal ---------- */
    let _aboutQrLoaded = false;
    async function openAbout() {
        $('#aboutMask').hidden = false;
        if (_aboutQrLoaded) return;
        try {
            const r = await fetch('/api/about_info');
            const d = await r.json();
            const img = $('#aboutWechatQr');
            const ph  = $('#aboutWechatQrPlaceholder');
            if (d.wechat_qr_data_url) {
                img.src = d.wechat_qr_data_url;
                img.hidden = false;
                if (ph) ph.style.display = 'none';
                _aboutQrLoaded = true;
            } else if (ph) {
                ph.textContent = '二维码加载失败';
            }
        } catch { const ph = $('#aboutWechatQrPlaceholder'); if (ph) ph.textContent = '二维码加载失败'; }
    }
    $('#footerAbout').addEventListener('click', (e) => { e.preventDefault(); openAbout(); });
    $('#btnAboutClose').addEventListener('click', () => { $('#aboutMask').hidden = true; });
    $('#aboutMask').addEventListener('click', (e) => {
        if (e.target.id === 'aboutMask') $('#aboutMask').hidden = true;
    });
    $('#aboutWechatId').addEventListener('click', () => {
        const id = $('#aboutWechatId').textContent.trim();
        copyToClipboard(id).then(() => toast('已复制微信号：' + id)).catch(() => toast('复制失败'));
    });

    /* ---------- 历史记录（复用老版 localStorage key） ---------- */
    const HISTORY_KEY = 'app_finder_history';
    const MAX_HISTORY = 100;
    const SHARED_KEY = 'app_finder_shared_history_enabled';
    const DEVICE_ID_KEY = 'app_finder_device_id';
    const DEVICE_NAME_KEY = 'app_finder_device_name';

    function getDeviceId() {
        let id = null;
        try { id = localStorage.getItem(DEVICE_ID_KEY); } catch {}
        if (!id) {
            id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
            try { localStorage.setItem(DEVICE_ID_KEY, id); } catch {}
        }
        return id;
    }
    function getDeviceName() {
        try {
            const n = localStorage.getItem(DEVICE_NAME_KEY);
            if (n) return n;
        } catch {}
        // 默认猜一个名字：平台 + 浏览器
        const ua = navigator.userAgent || '';
        let plat = 'Device';
        if (/iPhone/.test(ua)) plat = 'iPhone';
        else if (/iPad/.test(ua)) plat = 'iPad';
        else if (/Android/.test(ua)) plat = 'Android';
        else if (/Mac/.test(ua)) plat = 'Mac';
        else if (/Windows/.test(ua)) plat = 'Windows';
        else if (/Linux/.test(ua)) plat = 'Linux';
        return plat;
    }
    function setDeviceName(name) {
        try { localStorage.setItem(DEVICE_NAME_KEY, name); } catch {}
    }
    const MY_DEVICE_ID = getDeviceId();
    let sharedHistoryEnabled = false;
    try { sharedHistoryEnabled = localStorage.getItem(SHARED_KEY) === '1'; } catch {}
    let _serverHistoryCache = [];  // 最近一次从服务端拉到的合并用缓存

    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
        catch { return []; }
    }
    // 把服务端历史条目（POST /api/history 存下来的结构）转成抽屉能渲染的本地格式
    function _serverEntryToLocal(s) {
        const sPackages = s.lines || s.packages || [];
        return {
            packages: sPackages,
            label:    sPackages.length > 1 ? `${sPackages[0]} 等${sPackages.length}个` : (sPackages[0] || ''),
            appNames: (s.results || []).filter(r => r && r.app_name && r.app_name !== '未找到').map(r => r.app_name).slice(0, 5),
            isBatch:  sPackages.length > 1,
            time:      s.timestamp || 0,
            timestamp: s.timestamp || 0,
            results:   s.results || [],
            _device_id:   s.device_id || '',
            _device_name: s.device_name || (s.saved_by === 'server' ? '' : '其他设备'),
            _from_server: true,
            _saved_by_server: s.saved_by === 'server',
        };
    }

    function loadHistoryMerged() {
        // 本机模式：历史以服务端为权威源（查询完 _server_side_save_history 已经自动写了），
        // 不再读本地 localStorage——不然会和服务端那条撞出重复"自己查的 + 服务端自动"。
        if (_sync.isLocal) {
            return (_serverHistoryCache || [])
                .map(_serverEntryToLocal)
                .sort((a, b) => (b.timestamp || b.time || 0) - (a.timestamp || a.time || 0));
        }
        // LAN 模式（手机等）：本地 + 服务端共享（按共享开关）合并
        const local = loadHistory().map(h => ({ ...h, _source: 'local' }));
        if (!sharedHistoryEnabled) return local;
        const server = (_serverHistoryCache || []).map(s => ({ ..._serverEntryToLocal(s), _source: 'server' }));
        // 按 packages + 10 秒窗口去重：同一次查询本地写一条、服务端 _server_side_save_history
        // 也自动写一条，两边 timestamp 不同但 packages 相同。本地优先（用户视角更直观）。
        const all = [...local, ...server].sort((a, b) => (b.timestamp || b.time || 0) - (a.timestamp || a.time || 0));
        const result = [];
        for (const e of all) {
            const ePkgs = JSON.stringify(e.packages || []);
            const eTs   = e.timestamp || e.time || 0;
            const dupIdx = result.findIndex(x =>
                JSON.stringify(x.packages || []) === ePkgs
                && Math.abs((x.timestamp || x.time || 0) - eTs) < 10000
            );
            if (dupIdx >= 0) {
                // 已有一条，如果当前是 local 而已存是 server，本地覆盖（保留 device badge 等）
                if (e._source === 'local' && result[dupIdx]._source === 'server') {
                    result[dupIdx] = e;
                }
                continue;
            }
            result.push(e);
        }
        return result;
    }
    async function refreshServerHistory() {
        if (!sharedHistoryEnabled) return;
        try {
            const r = await fetch('/api/history');
            const d = await r.json();
            _serverHistoryCache = Array.isArray(d.history) ? d.history : [];
        } catch { _serverHistoryCache = []; }
    }
    async function pushEntryToServer(entry) {
        if (!sharedHistoryEnabled) return;
        try {
            await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entry: {
                    timestamp: entry.timestamp || entry.time || Date.now(),
                    lines: entry.packages || [],
                    results: entry.results || [],
                    count: (entry.results || []).length,
                    device_id: MY_DEVICE_ID,
                    device_name: getDeviceName(),
                } }),
            });
        } catch {}
    }
    function saveHistoryList(list) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }
        catch {
            const light = list.map(h => ({ ...h, results: [] }));
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(light)); } catch {}
        }
    }
    function saveToHistory(packageNames, results) {
        if (!packageNames.length) return;
        const isBatch = packageNames.length > 1;
        const appNames = [...new Set(results.filter(r => r.app_name && r.app_name !== '未找到').map(r => r.app_name))];
        const entry = {
            packages: packageNames,
            label: isBatch ? `${packageNames[0]} 等${packageNames.length}个` : packageNames[0],
            appNames: appNames.slice(0, 5),
            isBatch,
            time: Date.now(),
            timestamp: Date.now(),
            results: results.slice(0, 60),
            device_id: MY_DEVICE_ID,
            device_name: getDeviceName(),
        };
        // 本机模式：服务端在 /api/query 完成时已经 _server_side_save_history 写了一条，
        // 这里不再写 localStorage、不再 pushEntryToServer，避免"自己查的一条 +
        // 服务端自动写一条"在抽屉里重复显示。只刷新一下服务端缓存让抽屉立即看到。
        if (_sync.isLocal) {
            if (typeof refreshServerHistory === 'function') {
                refreshServerHistory().then(() => renderHistory());
            } else {
                renderHistory();
            }
            return;
        }
        // LAN 模式（手机等）：仍写本地 localStorage（离线也能看自己的历史），
        // 但不再 pushEntryToServer——服务端自动写过了，推了只会造成重复条目。
        let list = loadHistory();
        list = list.filter(h => JSON.stringify(h.packages) !== JSON.stringify(packageNames));
        list.unshift(entry);
        if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
        saveHistoryList(list);
        if (sharedHistoryEnabled && typeof refreshServerHistory === 'function') {
            refreshServerHistory().then(() => renderHistory());
        } else {
            renderHistory();
        }
    }
    function timeAgo(ts) {
        const d = Date.now() - ts;
        if (d < 60e3) return '刚刚';
        if (d < 3600e3) return Math.floor(d / 60e3) + '分钟前';
        if (d < 86400e3) return Math.floor(d / 3600e3) + '小时前';
        return Math.floor(d / 86400e3) + '天前';
    }
    function applyHistory(entry) {
        input.value = entry.packages.join('\n');
        input.dispatchEvent(new Event('input'));
        $('#historyMask').hidden = true;
        input.focus();
    }
    function renderHistory() {
        const list = loadHistoryMerged();
        const total = $('#historyTotal');
        if (total) total.textContent = list.length;
        // 同步设备名显示 & toggle 状态
        const devLabel = $('#deviceNameLabel');
        if (devLabel) devLabel.textContent = getDeviceName();
        const chk = $('#chkSharedHistory');
        if (chk) chk.checked = sharedHistoryEnabled;
        const clearShared = $('#btnHistoryClearShared');
        if (clearShared) clearShared.hidden = !sharedHistoryEnabled;
        const strip = $('#recentStrip');
        if (strip) {
            if (!list.length) {
                strip.innerHTML = '<div class="v4-inline-history-empty">暂无历史 · 开始你的第一次查询</div>';
            } else {
                strip.innerHTML = list.slice(0, 3).map((h, i) => {
                    const hasResults = h.results && h.results.length;
                    const showBtn = hasResults
                        ? `<span class="v4-recent-chip-show" data-hist-show="${i}" title="直接显示上次结果">显示</span>`
                        : '';
                    return `<span class="v4-recent-chip-wrap">
                        <button class="v4-recent-chip" data-hist-idx="${i}" title="${esc(h.label)}">${esc(h.label)}</button>
                        ${showBtn}
                    </span>`;
                }).join('');
            }
        }
        const drawerList = $('#historyList');
        if (drawerList) {
            if (!list.length) {
                drawerList.innerHTML = '<div class="v4-inline-history-empty">暂无历史</div>';
            } else {
                drawerList.innerHTML = list.map((h, i) => {
                    const hasResults = h.results && h.results.length;
                    // 本机模式下所有条目都是用户自己（同一台机器多浏览器），badge 是噪声；
                    // 只在 LAN 模式下才标"来自其它设备"——手机从 LAN 看电脑查的记录才有意义。
                    const fromOther = !_sync.isLocal
                        && (h._from_server || (h.device_id && h.device_id !== MY_DEVICE_ID));
                    const deviceName = h._device_name || h.device_name || '';
                    const badge = (fromOther && deviceName)
                        ? `<span class="v4-hist-device-badge other" title="来自其它设备">${esc(deviceName)}</span>`
                        : '';
                    return `
                    <div class="v4-hist-item" data-hist-idx="${i}">
                        <span class="label">${esc(h.label)}</span>
                        ${h.appNames && h.appNames.length ? `<span class="app-names">(${esc(h.appNames[0])}${h.appNames.length > 1 ? '…' : ''})</span>` : ''}
                        ${badge}
                        <span class="time">${timeAgo(h.time || h.timestamp || Date.now())}</span>
                        ${hasResults ? `<button class="v4-hist-show" data-hist-show="${i}" title="直接显示上次查询结果">显示</button>` : ''}
                    </div>
                `;}).join('');
            }
        }
    }

    async function openHistoryDrawer() {
        renderHistory();
        $('#historyMask').hidden = false;
        if (sharedHistoryEnabled) {
            await refreshServerHistory();
            renderHistory();
        }
    }
    $('#btnHistory').addEventListener('click', openHistoryDrawer);
    $('#btnMoreHistory').addEventListener('click', openHistoryDrawer);

    // 共享开关：默认关闭；开启时弹警告
    $('#chkSharedHistory').addEventListener('change', async (e) => {
        // 本机模式下这个开关根本不该显示（CSS 已隐藏整条 #sharedHistoryBar）；
        // 如果出现极端情况（data-access-mode 还没写上去就被点了），忽略并强制回 true
        if (_sync.isLocal) { e.target.checked = true; return; }
        if (e.target.checked) {
            const ok = confirm(
                '⚠ 开启"共享局域网历史"后：\n\n' +
                '• 本机的查询历史会上传到服务端，局域网里任何能打开本服务的人都能看到；\n' +
                '• 同时你也会看到其他设备留下的历史；\n' +
                '• 条目里可能含应用名 / 包名 / 下载链接，请确认局域网内没有不信任的人。\n\n' +
                '确定开启吗？'
            );
            if (!ok) { e.target.checked = false; return; }
            sharedHistoryEnabled = true;
            try { localStorage.setItem(SHARED_KEY, '1'); } catch {}
            // 把本机已有记录一次性推到服务端，方便其他设备能看到
            const local = loadHistory();
            for (const h of local.slice(0, 20)) pushEntryToServer(h);
            await refreshServerHistory();
            toast('共享已开启');
        } else {
            sharedHistoryEnabled = false;
            try { localStorage.setItem(SHARED_KEY, '0'); } catch {}
            _serverHistoryCache = [];
            toast('共享已关闭，仅显示本机历史');
        }
        renderHistory();
    });

    // 改设备名
    $('#btnRenameDevice').addEventListener('click', (e) => {
        e.preventDefault();
        const cur = getDeviceName();
        const next = prompt('为此设备起一个方便辨认的名字（只本地使用，下次查询会带到共享历史）：', cur);
        if (next && next.trim()) {
            setDeviceName(next.trim().slice(0, 24));
            renderHistory();
            toast('已改名：' + next.trim().slice(0, 24));
        }
    });

    // 清空服务端共享历史（仅本机管理员能生效，后端会校验）
    $('#btnHistoryClearShared').addEventListener('click', async () => {
        if (!confirm('确定清空服务端共享历史？（所有设备的共享记录都会被删除，不影响本机本地）')) return;
        try {
            const r = await fetch('/api/history', { method: 'DELETE' });
            const d = await r.json();
            if (d.ok) {
                _serverHistoryCache = [];
                renderHistory();
                toast('服务端共享历史已清空');
            } else {
                toast('清空失败：' + (d.error || '无权限'));
            }
        } catch (err) { toast('清空失败：' + err.message); }
    });
    $('#btnHistoryClose').addEventListener('click', () => { $('#historyMask').hidden = true; });
    $('#historyMask').addEventListener('click', (e) => {
        if (e.target.id === 'historyMask') $('#historyMask').hidden = true;
    });
    $('#btnHistoryClear').addEventListener('click', () => {
        if (!confirm('确定清空所有历史？')) return;
        localStorage.removeItem(HISTORY_KEY);
        renderHistory();
        toast('已清空历史');
    });
    document.addEventListener('click', (e) => {
        const show = e.target.closest('[data-hist-show]');
        if (show) {
            e.stopPropagation();
            const idx = parseInt(show.dataset.histShow, 10);
            const list = loadHistoryMerged();
            const entry = list[idx];
            if (entry && entry.results && entry.results.length) {
                currentResults = entry.results.slice();
                input.value = entry.packages.join('\n');
                input.dispatchEvent(new Event('input'));
                $('#historyMask').hidden = true;
                if (typeof markIncomplete === 'function') markIncomplete();
                $('#v4Root').classList.add('searched', 'has-results');
                $('#resultsZone').hidden = false;
                $('#tbTitle').textContent = '查询结果';
                $('#inlineProgress').hidden = true;
                $('#toolbarRight').style.visibility = '';
                showResults();
                if (window._collapseInputForResults) window._collapseInputForResults();
                if (window._measureStickyHeights) window._measureStickyHeights();
                toast('已显示历史结果');
            }
            return;
        }
        const el = e.target.closest('[data-hist-idx]');
        if (!el) return;
        const idx = parseInt(el.dataset.histIdx, 10);
        const list = loadHistoryMerged();
        if (list[idx]) applyHistory(list[idx]);
    });
    renderHistory();

    /* ---------- landing 小知识轮播 ---------- */
    let landingTipTimer = null;
    function applyMarquee(el) {
        if (!el) return;
        el.classList.remove('marquee');
        // 强制回流后测量
        void el.offsetWidth;
        const parent = el.parentElement;
        if (parent && el.scrollWidth > parent.clientWidth + 2) {
            el.classList.add('marquee');
        }
    }
    function swapTip(el) {
        // 先停掉 marquee，避免两段动画叠加
        el.classList.remove('marquee');
        el.classList.remove('swapping');
        void el.offsetWidth;
        el.classList.add('swapping');
        // 动画 900ms，在中点（约 450ms）不可见时换文本
        setTimeout(() => { el.textContent = nextTip(); }, 450);
        setTimeout(() => {
            el.classList.remove('swapping');
            applyMarquee(el);
        }, 920);
    }
    function startLandingTips() {
        const el = $('#landingTipText');
        if (!el) return;
        el.textContent = nextTip();
        applyMarquee(el);
        if (landingTipTimer) clearInterval(landingTipTimer);
        landingTipTimer = setInterval(() => swapTip(el), 8000);
        window.addEventListener('resize', () => applyMarquee(el));
    }
    startLandingTips();

    /* ============================================================
       ↓↓↓ Slice 2：查询 / SSE / 结果表 / 导出 / 重试 / 恢复 ↓↓↓
       ============================================================ */

    let currentJob = null;       // { jobId, total, done, eventSource, lines }
    let currentResults = [];
    let _orderPinned = false;   // 冻结行顺序，避免重查填回后行位置跳动
    const iconRetry = new Map(); // pkg -> count
    let bgBannerTimer = null;
    let tipsTimer = null;
    // 多列排序：栈结构，数组前部为主键（legacy 行为）
    let sortKeys = []; // [{col, dir: 'asc'|'desc'}]
    const MAX_SORT_KEYS = 3;
    let filterPlatform = 'all';  // 'all' | 'iOS' | 'Android' | ...

    /* ---------- Toast ---------- */
    let toastTimer = null;
    function toast(msg) {
        const t = $('#v4Toast');
        t.textContent = msg; t.hidden = false;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
    }

    /* ---------- 查询入口 ---------- */
    async function triggerQuery() {
        const lines = parseLines(input.value);
        if (!lines.length) { input.focus(); return; }
        // ⚠️ 不要删除这一行 blur —— 这里修的 bug 修了好多次。
        // _collapseInputForResults() 里有一道 `if (document.activeElement === input) return`
        // 护栏，目的是避免流式 progress 把用户正在编辑的多行压回一行。
        // 但 Cmd/Ctrl+Enter 触发查询时 textarea 仍然带 focus，那道护栏会把"提交后的
        // 多行→单行折叠"也跳过，导致结果页还是 3 行高的 textarea 占满空间。
        // 这里显式 blur 让 activeElement 挪走，折叠才能正常执行。鼠标点 #btnQuery
        // 时本来就会挪走 focus，所以无副作用。
        input.blur();
        if (lines.length >= BATCH_WARN_THRESHOLD) {
            const ok = await batchWarn(lines.length);
            if (!ok) return;
            requestNotificationPermission();
        }
        await startJob(lines);
    }

    function batchWarn(n) {
        return new Promise(resolve => {
            const hard = n >= BATCH_HARD_THRESHOLD;
            $('#batchWarnBody').innerHTML = `你要查询 <b>${n}</b> 条。${hard ? '超过 100 条耗时可能较长，' : ''}继续？`;
            $('#batchWarnMask').hidden = false;
            const close = (v) => {
                $('#batchWarnMask').hidden = true;
                $('#btnBatchCancel').onclick = null;
                $('#btnBatchConfirm').onclick = null;
                resolve(v);
            };
            $('#btnBatchCancel').onclick = () => close(false);
            $('#btnBatchConfirm').onclick = () => close(true);
        });
    }

    async function startJob(lines) {
        const body = {
            package_names: lines,
            exact_search: filters.match === 'exact',
            get_apk_url: filters.ext.has('apk'),
            apk_url_mode: 'single',
            get_sha1: filters.ext.has('sha1'),
            get_sha256: filters.ext.has('sha256'),
            query_interval_ms: getIntervalMs(lines.length),
            // 照抄 main-legacy.js:1203 —— 后端用小写 "all"/"ios"/"android" 比较
            // （app.py:817/819/911/913/4685/4687）。V4 早期版本这里多写了一次大小写
            // 转换成 "iOS"/"Android"，导致后端三条分支全部不命中：跨端补全被跳过
            // (app.py:4675 只在 == "all" 时跑)，筛选 continue 也不触发 → 选 Android
            // 反而出 iOS 的怪象。修复方式 = 直接透传 filters.platform（它本来就是小写）。
            // 违反了 feedback_ui_only.md："数据逻辑/API 参数全部照抄老版"。
            platform_filter: filters.platform,
            extended_search: filters.opts.has('extended'),
        };
        enterLoading(lines.length);
        currentResults = [];
        iconRetry.clear();
        // 保留本次提交的原始多行输入，供查询后折叠 / focus 展开使用
        if (lines.length > 1) {
            input.dataset.raw = lines.join('\n');
        } else {
            delete input.dataset.raw;
        }
        try {
            const r = await fetch('/api/start_job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await r.json();
            currentJob = { jobId: data.job_id, total: data.total_tasks || lines.length, done: 0, lines };
            persistPending(data.job_id, lines);
            scheduleBgBanner();
            openStream(data.job_id, 0);
        } catch (e) {
            exitLoading();
            toast('启动查询失败：' + e.message);
        }
    }

    /* ---------- SSE ---------- */
    function openStream(jobId, offset) {
        const es = new EventSource(`/api/job_stream/${jobId}?offset=${offset}`);
        es.onmessage = (ev) => {
            try { handleEvent(JSON.parse(ev.data)); } catch (e) { console.warn('bad sse', e); }
        };
        es.onerror = () => { /* EventSource 自动重连 */ };
        currentJob.eventSource = es;
    }

    function closeStream() {
        if (currentJob && currentJob.eventSource) { try { currentJob.eventSource.close(); } catch {} }
    }

    function handleEvent(ev) {
        switch (ev.type) {
            case 'start':
                if (ev.total != null) currentJob.total = ev.total;
                updateProgress(0, currentJob.total);
                break;
            case 'progress':
                currentJob.done = ev.done || 0;
                updateProgress(currentJob.done, ev.total || currentJob.total);
                if (ev.rows) mergeRows(ev.rows);
                break;
            case 'session_reset':
                toast('⚠ 商店会话已重建，继续查询');
                break;
            case 'retry_start': {
                const b = $('#retryBadge'); if (b) b.hidden = false;
                const bt = $('#retryBadgeText'); if (bt) bt.textContent = `0/${ev.retry_total || 0}`;
                if (ev.retry_total) updateProgress(0, ev.retry_total);
                // 冻结当前顺序：重查填回来的行留在原位
                pinDisplayOrder();
                showResults();
                break;
            }
            case 'retry_progress': {
                updateProgress(ev.retry_done || 0, ev.retry_total || 0);
                const bt = $('#retryBadgeText');
                if (bt) bt.textContent = `${ev.retry_done || 0}/${ev.retry_total || 0}`;
                if (ev.rows) mergeRows(ev.rows);
                break;
            }
            case 'retry_done': {
                const b = $('#retryBadge'); if (b) b.hidden = true;
                break;
            }
            case 'complete':
                if (ev.results) currentResults = ev.results;
                markIncomplete();
                showResults();
                exitLoading();
                closeStream();
                clearPending();
                if (currentJob && currentJob.lines) saveToHistory(currentJob.lines, currentResults);
                // 保留输入开关关闭时：查询完成自动清空输入框
                if (!filters.opts.has('keep')) {
                    try {
                        input.value = '';
                        delete input.dataset.raw;
                        input.dispatchEvent(new Event('input'));
                    } catch {}
                }
                sendNotification(currentResults.length);
                if (ev.over_limit) toast('⚠ 部分结果被截断（超出限制）');
                if (ev.invalid_count) toast(`跳过 ${ev.invalid_count} 条无效输入`);
                break;
            case 'error':
                exitLoading();
                closeStream();
                clearPending();
                toast('错误：' + (ev.message || 'unknown'));
                break;
        }
    }

    function mergeRows(rows) {
        for (const row of rows) {
            const key = (row.package_name || '') + '|' + (row.platform || '');
            const idx = currentResults.findIndex(r => (r.package_name || '') + '|' + (r.platform || '') === key);
            if (idx >= 0) currentResults[idx] = row;
            else currentResults.push(row);
        }
        markIncomplete();
        showResults();
    }

    /* ---------- Loading UI (legacy-style inline progress in toolbar) ---------- */
    function enterLoading(total) {
        $('#v4Root').classList.add('has-results');
        // 立刻展示结果区（空表也展示工具栏 + 进度条）
        $('#resultsZone').hidden = false;
        $('#tbTitle').textContent = '查询结果';
        $('#inlineProgress').hidden = false;
        // 查询中隐藏右侧下载/复制按钮（legacy 风格）
        $('#toolbarRight').style.visibility = 'hidden';
        updateProgress(0, total);
        // 先渲染一次骨架（表头 + 空 body），避免首次结果到达前工具栏悬空
        showResults();
        if (window._measureStickyHeights) window._measureStickyHeights();
        // 轮播小贴士：启动"查询中"的 tip 节奏（6s 一条，点击立即切下一条）
        const tip = $('#toolbarTip');
        if (tip) {
            tip.hidden = false;
            tip.textContent = nextTip();
            _tipsSource   = () => nextTip();
            _tipsInterval = 6000;
            _resetTipsTimer();
            _bindTipClickOnce();
        }
    }
    function exitLoading() {
        $('#inlineProgress').hidden = true;
        const rb = $('#retryBadge'); if (rb) rb.hidden = true;
        $('#toolbarRight').style.visibility = '';
        // 结束查询后，将 tip 从"查询中快速轮播"切到"结果页慢速轮播"，
        // 让"看着结果等下一步"的用户也能顺便学到快捷键/筛选/复制的玩法。
        _startResultsTips();
        if (bgBannerTimer) { clearTimeout(bgBannerTimer); bgBannerTimer = null; }
        $('#bgBanner').hidden = true;
        // ⚠️ 这一行是"header 跑到数据下面"老 bug 的止血点之一（TIPS #13）。
        // exitLoading 会隐藏 inlineProgress，toolbar 从查询中的高度缩回"无进度条"高度；
        // 如果不重新测量，`--sticky-top-2` 仍是查询中那个较大值，thead 就会粘在
        // 一个比实际 toolbar 更低的位置，中间空出 gap 让数据行从下面窜到 header 上方。
        // 更根治的方案是给 .v4-tb 挂 ResizeObserver（见本文件下方的 _ro 定义）。
        if (window._measureStickyHeights) window._measureStickyHeights();
    }
    function _startResultsTips() {
        const tip = $('#toolbarTip');
        if (!tip) return;
        tip.hidden = false;
        // 结果页第一条：立即换成使用类 tip（别让查询中的冷笑话残留到结果页）
        tip.textContent = nextUsageTip();
        _tipsSource   = () => nextUsageTip();
        _tipsInterval = 9000;   // 结果页比查询中慢一档（6s→9s），降低视觉干扰
        _resetTipsTimer();
        _bindTipClickOnce();
    }
    function _stopTips() {
        if (tipsTimer) { clearInterval(tipsTimer); tipsTimer = null; }
        _tipsInterval = 0;      // 停止状态下，点击也不会自动恢复计时器
        const tip = $('#toolbarTip');
        if (tip) {
            tip.hidden = true;
            tip.classList.remove('fade', 'tip-leave', 'tip-enter-init', 'tip-enter-active');
        }
    }
    // ─── Tips 切换：上下滚动动画 + 点击立即换下一条 ─────────────────
    // 设计：
    //  · 切换分两段：旧 tip 向上滑出 150ms → 换文本 → 新 tip 从下滑入 150ms
    //  · 两个轮播模式（查询中 6s / 结果页 9s）共用同一套动画与计时器
    //  · 用户点击 tip → 立刻跑一次动画 + 重置自动计时器（避免点完马上被自动切走）
    let _tipsSource   = null;    // () => string，当前阶段的下一条来源
    let _tipsInterval = 9000;    // 自动轮播间隔（0 = 已停止）
    let _tipSwapping  = false;   // 防止重入：一次动画进行中时忽略新触发
    let _tipClickBound = false;
    function _swapTip() {
        const tipEl = $('#toolbarTip');
        if (!tipEl || !_tipsSource || _tipSwapping) return;
        _tipSwapping = true;
        tipEl.classList.remove('tip-enter-init', 'tip-enter-active');
        tipEl.classList.add('tip-leave');
        setTimeout(() => {
            tipEl.textContent = _tipsSource();
            tipEl.classList.remove('tip-leave');
            tipEl.classList.add('tip-enter-init');
            // 双 rAF 保证浏览器应用 init 起点后再过渡到 active
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    tipEl.classList.remove('tip-enter-init');
                    tipEl.classList.add('tip-enter-active');
                    setTimeout(() => {
                        tipEl.classList.remove('tip-enter-active');
                        _tipSwapping = false;
                    }, 160);
                });
            });
        }, 150);
    }
    function _resetTipsTimer() {
        if (tipsTimer) { clearInterval(tipsTimer); tipsTimer = null; }
        if (!_tipsInterval) return;
        tipsTimer = setInterval(_swapTip, _tipsInterval);
    }
    function _bindTipClickOnce() {
        if (_tipClickBound) return;
        const tipEl = $('#toolbarTip');
        if (!tipEl) return;
        tipEl.title = '点击看下一条';
        tipEl.addEventListener('click', () => {
            _swapTip();
            _resetTipsTimer();   // 用户主动翻 → 重新计时，避免 1s 后被自动翻掉
        });
        _tipClickBound = true;
    }
    function updateProgress(done, total) {
        const t = total || 0;
        $('#inlineProgressText').textContent = `${done} / ${t || '?'}`;
        $('#inlineProgressFill').style.width = (t ? (done / t * 100) : 0) + '%';
    }

    /* ---------- BG banner ---------- */
    function scheduleBgBanner() {
        bgBannerTimer = setTimeout(() => { $('#bgBanner').hidden = false; }, BG_BANNER_DELAY);
    }
    $('#btnDismissBanner').addEventListener('click', () => { $('#bgBanner').hidden = true; });

    /* ---------- Pending 持久化 ---------- */
    function persistPending(jobId, lines) {
        try { localStorage.setItem(PENDING_JOB_KEY, JSON.stringify({ job_id: jobId, packageNames: lines })); } catch {}
    }
    function clearPending() { try { localStorage.removeItem(PENDING_JOB_KEY); } catch {} }

    /* ---------- 浏览器通知（大批量提示） ---------- */
    async function requestNotificationPermission() {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch {}
        }
    }
    function sendNotification(resultCount) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (document.visibilityState === 'visible') return;  // 前台不打扰
        try {
            const n = new Notification('App 查询完成', {
                body: `共查到 ${resultCount} 条结果，点击查看`,
                tag: 'app-finder-done',
            });
            n.onclick = () => { window.focus(); n.close(); };
        } catch {}
    }

    async function checkPendingJob() {
        let pending = null;
        try { pending = JSON.parse(localStorage.getItem(PENDING_JOB_KEY) || 'null'); } catch { return; }
        if (!pending || !pending.job_id) return;
        try {
            const r = await fetch(`/api/job_status/${pending.job_id}`);
            const data = await r.json();
            if (!data.found) { clearPending(); return; }
            if (data.status === 'done') {
                currentResults = data.results || [];
                markIncomplete();
                $('#v4Root').classList.add('has-results');
                showResults();
                clearPending();
                toast('上次的查询结果已恢复');
                sendNotification(currentResults.length);
            } else {
                enterLoading(pending.packageNames.length);
                currentJob = { jobId: pending.job_id, total: pending.packageNames.length, done: 0, lines: pending.packageNames };
                scheduleBgBanner();
                openStream(pending.job_id, 0);
                toast('正在继续上次的后台查询…');
            }
        } catch (e) { console.warn('resume failed', e); }
    }

    /* ---------- 完整性判定 ---------- */
    // 完整性判定：照抄老版 main-legacy.js 逻辑（四个核心字段）
    function markIncomplete() {
        // 判定规则（与后端一致）：
        // - 只有找不到「关键字段」（app_name + download_url）时才算不完整，
        //   会进「重查不完整」通道。
        // - icon / category 缺失属于「锦上添花」，不影响完整度判定，也不进重查。
        // - 一个包名只存在于单端（iOS-only 或 Android-only）属于正常——后端此时
        //   根本不会返回另一端的行，所以不会在 currentResults 里看到「缺」的另一端。
        for (const r of currentResults) {
            const missing = [];
            if (!r.package_name) missing.push('package_name');
            if (!r.platform) missing.push('platform');
            if (!r.app_name || r.app_name === '未找到') missing.push('app_name');
            if (!r.download_url) missing.push('download_url');
            // 非关键字段：仅记录，不标 incomplete
            const soft = [];
            if (!r.icon_url) soft.push('icon_url');
            if (!r.category) soft.push('category');
            if (missing.length) { r.incomplete = true; r.missing_fields = missing.concat(soft); }
            else { r.incomplete = false; r.missing_fields = soft; }
        }
    }

    /* ---------- 渲染 ---------- */
    const COLS = [
        { key: 'icon', label: '', sortable: false },
        { key: 'app_name', label: 'App 名', sortable: true },
        { key: 'package_name', label: '包名 / Bundle ID', sortable: true },
        { key: 'platform', label: '平台', sortable: true },
        { key: 'category', label: '分类', sortable: true },
        { key: 'store_url', label: '商店', sortable: false },
        { key: 'download_url', label: 'APK 直链', sortable: false, requires: () => filters.ext.has('apk') },
        { key: 'sha1', label: 'SHA1', sortable: false, requires: () => filters.ext.has('sha1') },
        { key: 'sha256', label: 'SHA256', sortable: false, requires: () => filters.ext.has('sha256') },
        { key: 'actions', label: '', sortable: false },
    ];
    const visibleCols = () => COLS.filter(c => !c.requires || c.requires());

    function renderCell(col, r) {
        switch (col.key) {
            case 'icon':
                if (!r.icon_url) return '<span style="color:var(--text-quaternary)">-</span>';
                return `<span class="v4-icon-wrap" title="点击下载图标">
                    <img src="${esc(r.icon_url)}" alt="" referrerpolicy="no-referrer" data-pkg="${esc(r.package_name)}" data-name="${esc(r.app_name)}" data-platform="${esc(r.platform)}" data-url="${esc(r.icon_url)}" />
                    <span class="v4-icon-dl" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
                    </span>
                </span>`;
            case 'app_name': {
                const name = r.app_name || (r._notFound ? '未找到' : '');
                if (!name || name === '未找到') {
                    return `<span class="v4-app-name">${esc(name || '-')}</span>`;
                }
                // 跨端补全的结果打一个极小的「补」badge，提示可能非严格同一 App
                const extBadge = r.extended_fill
                    ? ` <span class="v4-ext-badge" title="跨端补全结果：根据另一端 App 名反查，可能非严格同一应用">补</span>`
                    : '';
                // 点击 app 名即复制
                return `<span class="v4-app-name copyable" data-copy="${esc(name)}" title="点击复制">${esc(name)}</span>${extBadge}`;
            }
            case 'package_name': {
                // 前缀手误自动修正（om./co./cm. → com.）时，在包名右侧挂一个
                // 「已修正」badge，hover 显示用户原输入
                const correctedBadge = r._corrected
                    ? ` <span class="v4-corr-badge" title="您输入的「${esc(r._orig_value || '')}」可能前缀少字母，已为您自动修正为「${esc(r.package_name || '')}」">已修正</span>`
                    : '';
                return `<code class="mono v4-pkg">${esc(r.package_name || '')}</code>${correctedBadge}`;
            }
            case 'platform': {
                if (!r.platform) return '-';
                const cls = r.platform === 'iOS' ? 'ios' : 'android';
                return `<span class="chip ${cls}">${esc(r.platform)}</span>`;
            }
            case 'category':
                return `<span class="v4-cat">${esc(r.category || '-')}</span>`;
            case 'store_url': {
                if (!r.download_url) return '<span style="color:var(--text-quaternary)">—</span>';
                const display = r.download_url.replace(/^https?:\/\//, '');
                const short = display.length > 32 ? display.slice(0, 30) + '…' : display;
                return `<span class="v4-link-cell">
                    <a class="v4-store-link" href="${esc(r.download_url)}" target="_blank" rel="noopener" title="${esc(r.download_url)}">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        ${esc(short)}
                    </a>
                    <button class="v4-copy-mini" data-copy="${esc(r.download_url)}" title="复制链接" aria-label="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                </span>`;
            }
            case 'download_url': {
                // iOS 不存在 APK 直链概念——明确告诉用户这是「本身没有」，不是「没查到」
                if (r.platform === 'iOS') return '<span class="v4-na" title="该字段仅 Android 有">iOS 无此项</span>';
                if (r.platform !== 'Android') return '-';
                const urls = r.apk_direct_urls || [];
                if (!urls.length) return '<span style="color:var(--text-quaternary)">—</span>';
                return urls.map(u => `<span class="v4-link-cell">
                    <a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(u)}</a>
                    <button class="v4-copy-mini" data-copy="${esc(u)}" title="复制链接" aria-label="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                </span>`).join('<br>');
            }
            case 'sha1':
                if (r.platform === 'iOS') return '<span class="v4-na" title="该字段仅 Android 有">iOS 无此项</span>';
                return r.sha1 ? `<span class="v4-sha mono" title="${esc(r.sha1)} (点击复制)">${esc(r.sha1)}</span>` : '-';
            case 'sha256':
                if (r.platform === 'iOS') return '<span class="v4-na" title="该字段仅 Android 有">iOS 无此项</span>';
                return r.sha256 ? `<span class="v4-sha mono" title="${esc(r.sha256)} (点击复制)">${esc(r.sha256)}</span>` : '-';
            case 'actions':
                if (!r.incomplete || !r.package_name) return '';
                return `<button class="v4-row-retry" data-retry-pkg="${esc(r.package_name)}" title="重查这一条">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
                    <span>重查</span>
                </button>`;
        }
        return '';
    }

    function pinDisplayOrder() {
        // 「完整优先 → 不完整沉底」，用户可明确看到哪些需要重查；之后冻结不再洗牌
        const complete = [];
        const incomplete = [];
        currentResults.forEach(r => (r.incomplete ? incomplete : complete).push(r));
        const sorted = [...complete, ...incomplete];
        sorted.forEach((r, i) => { r._pinnedOrder = i; });
        _orderPinned = true;
    }
    function sortedRows() {
        let rows = [...currentResults];
        for (const r of rows) {
            r._notFound = !r.app_name && !r.icon_url && !r.category;
        }
        if (filterPlatform !== 'all') {
            rows = rows.filter(r => r.platform === filterPlatform);
        }
        if (!sortKeys.length) {
            if (_orderPinned) {
                rows.sort((a, b) => (a._pinnedOrder ?? 9e9) - (b._pinnedOrder ?? 9e9));
            } else {
                // 未冻结：动态把不完整沉到底，完整项组内保持原始顺序（稳定排序）
                rows = rows.map((r, i) => ({ r, i }))
                    .sort((a, b) => {
                        const ai = a.r.incomplete ? 1 : 0;
                        const bi = b.r.incomplete ? 1 : 0;
                        if (ai !== bi) return ai - bi;
                        return a.i - b.i;
                    })
                    .map(x => x.r);
            }
        }
        if (sortKeys.length) {
            rows.sort((a, b) => {
                for (const k of sortKeys) {
                    const av = (a[k.col] || '').toString();
                    const bv = (b[k.col] || '').toString();
                    if (!av && bv) return 1;
                    if (av && !bv) return -1;
                    const c = av.localeCompare(bv, 'zh-Hans-CN');
                    if (c !== 0) return c * (k.dir === 'asc' ? 1 : -1);
                }
                return 0;
            });
        }
        return rows;
    }

    function showResults() {
        $('#resultsZone').hidden = false;
        const cols = visibleCols();
        const thRow = $('#resultHeadRow');
        thRow.innerHTML = cols.map(c => {
            if (!c.sortable) return `<th data-col="${c.key}">${esc(c.label)}</th>`;
            const idx = sortKeys.findIndex(k => k.col === c.key);
            let ind = '<span class="sort-ind">⇅</span>';
            let ctrls = '';
            if (idx >= 0) {
                const k = sortKeys[idx];
                const arrow = k.dir === 'asc' ? '▲' : '▼';
                const badge = sortKeys.length > 1 ? arrow + (idx + 1) : arrow;
                ind = `<span class="sort-ind active">${badge}</span>`;
                if (idx > 0) ctrls += `<button class="sort-move-up" data-sort-up="${c.key}" title="提升优先级">↑</button>`;
                ctrls += `<button class="sort-remove" data-sort-rm="${c.key}" title="移除排序">×</button>`;
            }
            // 平台列：加筛选按钮（legacy 行为）
            let filter = '';
            if (c.key === 'platform') {
                const active = filterPlatform !== 'all';
                filter = `<button class="th-filter-btn${active ? ' active' : ''}" data-filter-col="platform" title="筛选平台">▾</button>`;
            }
            return `<th class="sortable" data-col="${c.key}">${esc(c.label)} ${ind}${ctrls}${filter}</th>`;
        }).join('');

        const rows = sortedRows();
        let lastPkg = null;
        $('#resultBody').innerHTML = rows.map(r => {
            const isNewGroup = r.package_name !== lastPkg;
            lastPkg = r.package_name;
            const cls = [
                isNewGroup ? 'new-group' : 'same-group',
                r.incomplete ? 'incomplete' : '',
                r._notFound ? 'not-found' : '',
            ].filter(Boolean).join(' ');
            const tds = cols.map(c => {
                // 统一体验：pkg / sha1 / sha256 / app_name 都整格可点复制。
                // 光标在 td 任意位置都变成小手，点哪里都是复制那格的核心值。
                let tdCopyable = false, copyValue = '';
                if (['package_name', 'sha1', 'sha256'].includes(c.key) && r[c.key]) {
                    tdCopyable = true; copyValue = r[c.key];
                } else if (c.key === 'app_name' && r.app_name && r.app_name !== '未找到') {
                    tdCopyable = true; copyValue = r.app_name;
                }
                const copyAttr = tdCopyable ? ` data-copy="${esc(copyValue)}"` : '';
                const tdCls = [c.key === 'icon' ? 'v4-cell-icon' : '', tdCopyable ? 'copyable' : ''].filter(Boolean).join(' ');
                return `<td class="${tdCls}"${copyAttr}>${renderCell(c, r)}</td>`;
            }).join('');
            return `<tr class="${cls}">${tds}</tr>`;
        }).join('');

        $('#resultCards').innerHTML = rows.map(r => {
            const apkUrls = r.apk_direct_urls || [];
            const apkHtml = apkUrls.length
                ? apkUrls.map((u, i) => `<span class="v4-link-cell">
                    <a href="${esc(u)}" target="_blank" rel="noopener">APK 来源${i+1}</a>
                    <button class="v4-copy-mini" data-copy="${esc(u)}" title="复制链接" aria-label="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                </span>`).join(' ')
                : '';
            const storeHtml = r.download_url
                ? `<span class="v4-link-cell">
                    <a href="${esc(r.download_url)}" target="_blank" rel="noopener">${esc(r.source || '商店')}</a>
                    <button class="v4-copy-mini" data-copy="${esc(r.download_url)}" title="复制链接" aria-label="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                </span>`
                : '';
            const sha1Html = r.sha1 ? `<div class="v4-card-row copyable mono" data-copy="${esc(r.sha1)}">SHA1: <span class="v4-trunc">${esc(r.sha1)}</span></div>` : '';
            const sha256Html = r.sha256 ? `<div class="v4-card-row copyable mono" data-copy="${esc(r.sha256)}">SHA256: <span class="v4-trunc">${esc(r.sha256)}</span></div>` : '';
            // Bug F 修复：原来 app-name / 平台 / 分类 各自占一行 → 右侧大段留白，视觉浪费。
            // 重新排版：
            //   行 1：app-name (吃左侧) + platform/category 小标签 (推到右侧) —— justify-between
            //   行 2：包名（单独一行，等宽 badge 样式）
            //   行 3..N：商店链接 / SHA1 / SHA256（有才显示）
            // 配合 style-v4.css 1635+ 的移动端 .v4-card 规则：padding:12 gap:12 align-items:flex-start
            const platformChip = r.platform
                ? `<span class="v4-card-chip v4-card-chip-${String(r.platform).toLowerCase()}">${esc(r.platform)}</span>`
                : '';
            const categoryChip = r.category
                ? `<span class="v4-card-chip v4-card-chip-cat">${esc(r.category)}</span>`
                : '';
            return `
            <div class="v4-card${r.incomplete ? ' incomplete' : ''}">
                <div class="v4-card-icon">${r.icon_url ? `<img src="${esc(r.icon_url)}" />` : ''}</div>
                <div class="v4-card-main">
                    <div class="v4-card-title-row">
                        <div class="v4-card-name${r.app_name ? ' copyable' : ''}"${r.app_name ? ` data-copy="${esc(r.app_name)}" title="点击复制"` : ''}>${esc(r.app_name || '未找到')}</div>
                        <div class="v4-card-meta">${platformChip}${categoryChip}</div>
                    </div>
                    <div class="v4-card-pkg mono copyable" data-copy="${esc(r.package_name || '')}">${esc(r.package_name || '')}</div>
                    ${storeHtml || apkHtml ? `<div class="v4-card-row">${[storeHtml, apkHtml].filter(Boolean).join(' · ')}</div>` : ''}
                    ${sha1Html}
                    ${sha256Html}
                </div>
            </div>`;
        }).join('');

        $('#resultCount').textContent = rows.length + ' 条';
        const ios = currentResults.filter(r => r.platform === 'iOS').length;
        const and = currentResults.filter(r => r.platform === 'Android').length;
        $('#resultBreakdown').innerHTML = `iOS <b>${ios}</b> · Android <b>${and}</b>`;

        const incomplete = currentResults.filter(r => r.incomplete).length;
        const retryBtn = $('#btnRetryIncomplete');
        retryBtn.hidden = incomplete === 0;
        const retryLabel = retryBtn.querySelector('span') || retryBtn.lastChild;
        if (retryLabel && retryLabel.nodeType === 3) retryLabel.textContent = ` 重查不完整 (${incomplete})`;

        if (window._measureStickyHeights) window._measureStickyHeights();
        if (window._collapseInputForResults) window._collapseInputForResults();

        bindIconErrorHandlers();
    }

    /* ---------- 排序（多列，legacy 行为） ---------- */
    $('#resultHeadRow').addEventListener('click', (e) => {
        const up = e.target.closest('[data-sort-up]');
        if (up) {
            e.stopPropagation();
            const col = up.dataset.sortUp;
            const i = sortKeys.findIndex(k => k.col === col);
            if (i > 0) { [sortKeys[i-1], sortKeys[i]] = [sortKeys[i], sortKeys[i-1]]; showResults(); }
            return;
        }
        const rm = e.target.closest('[data-sort-rm]');
        if (rm) {
            e.stopPropagation();
            const col = rm.dataset.sortRm;
            sortKeys = sortKeys.filter(k => k.col !== col);
            showResults();
            return;
        }
        const fb = e.target.closest('[data-filter-col]');
        if (fb) {
            e.stopPropagation(); e.preventDefault();
            openPlatformFilterMenu(fb);
            return;
        }
        const th = e.target.closest('th.sortable');
        if (!th) return;
        const col = th.dataset.col;
        const ex = sortKeys.find(k => k.col === col);
        if (ex) ex.dir = ex.dir === 'asc' ? 'desc' : 'asc';
        else {
            sortKeys.push({ col, dir: 'asc' });
            if (sortKeys.length > MAX_SORT_KEYS) sortKeys.shift();
        }
        showResults();
    });

    /* ---------- 平台筛选下拉 ---------- */
    function openPlatformFilterMenu(anchor) {
        document.querySelectorAll('.th-filter-menu').forEach(m => m.remove());
        const platforms = [...new Set(currentResults.map(r => r.platform).filter(Boolean))];
        const opts = [{ v: 'all', label: '全部' }, ...platforms.map(p => ({ v: p, label: p }))];
        const menu = document.createElement('div');
        menu.className = 'th-filter-menu';
        menu.innerHTML = opts.map(o =>
            `<button class="th-filter-item${filterPlatform === o.v ? ' active' : ''}" data-fv="${esc(o.v)}">${esc(o.label)}</button>`
        ).join('');
        document.body.appendChild(menu);
        const rect = anchor.getBoundingClientRect();
        menu.style.left = (rect.left + window.scrollX) + 'px';
        menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
        const onDoc = (ev) => {
            if (menu.contains(ev.target)) {
                const it = ev.target.closest('[data-fv]');
                if (it) {
                    filterPlatform = it.dataset.fv;
                    showResults();
                }
            }
            menu.remove();
            document.removeEventListener('click', onDoc, true);
        };
        setTimeout(() => document.addEventListener('click', onDoc, true), 0);
    }

    /* ---------- 📋 mini 复制按钮（结果区内所有） ---------- */
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.v4-copy-mini');
        if (!btn || !btn.dataset.copy) return;
        e.preventDefault(); e.stopPropagation();
        copyToClipboard(btn.dataset.copy).then(() => toast('已复制链接')).catch(() => toast('复制失败'));
    });

    /* ---------- 卡片点击复制 ---------- */
    $('#resultCards').addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const el = e.target.closest('.copyable[data-copy]');
        if (!el || !el.dataset.copy) return;
        copyToClipboard(el.dataset.copy).then(() => toast('已复制：' + el.dataset.copy.slice(0, 48))).catch(() => toast('复制失败'));
    });

    /* ---------- 单元格点击复制 ---------- */
    $('#resultBody').addEventListener('click', (e) => {
        const img = e.target.closest('img[data-url]');
        if (img) {
            const url = `/api/icon?url=${encodeURIComponent(img.dataset.url)}&name=${encodeURIComponent(img.dataset.name || '')}&platform=${encodeURIComponent(img.dataset.platform || '')}`;
            window.open(url, '_blank');
            return;
        }
        if (e.target.closest('a')) return;
        // 1) 细粒度 copyable（.v4-app-name / 其他内联 span 等），优先于整格
        const inner = e.target.closest('.copyable[data-copy]');
        if (inner && inner.dataset.copy) {
            e.stopPropagation();
            copyToClipboard(inner.dataset.copy).then(() => toast('已复制：' + inner.dataset.copy.slice(0, 48))).catch(() => toast('复制失败'));
            return;
        }
        // 2) 整格（td.copyable，如包名整格）
        const td = e.target.closest('td.copyable');
        if (td && td.dataset.copy) {
            copyToClipboard(td.dataset.copy).then(() => toast('已复制：' + td.dataset.copy.slice(0, 48))).catch(() => toast('复制失败'));
        }
    });

    /* ---------- 坏图自动重试 ---------- */
    function bindIconErrorHandlers() {
        document.querySelectorAll('#resultBody img[data-url]').forEach(img => {
            if (img.dataset.bound) return;
            img.dataset.bound = '1';
            img.addEventListener('error', () => {
                const pkg = img.dataset.pkg;
                const c = iconRetry.get(pkg) || 0;
                const u = img.dataset.url;
                if (c < ICON_RETRY_MAX) {
                    iconRetry.set(pkg, c + 1);
                    setTimeout(() => { img.src = u + (u.includes('?') ? '&' : '?') + '_r=' + (c + 1); }, 400 * (c + 1));
                } else if (!img.dataset.proxied) {
                    // 最后兜底：走服务端 /api/icon 代理（带正确 Referer，绕开防盗链）
                    img.dataset.proxied = '1';
                    img.src = `/api/icon?url=${encodeURIComponent(u)}&name=${encodeURIComponent(img.dataset.name || '')}&platform=${encodeURIComponent(img.dataset.platform || '')}&_inline=1`;
                } else {
                    img.classList.add('broken');
                }
            });
        });
    }

    /* ---------- 工具栏 ---------- */
    function cellText(r, key) {
        if (key === 'store_url') return r.download_url || '';
        if (key === 'download_url') return (r.apk_direct_urls || []).join(' | ');
        return String(r[key] || '');
    }
    $('#btnCopyAll').addEventListener('click', () => {
        const cols = visibleCols().filter(c => c.key !== 'icon');
        const header = cols.map(c => c.label).join('\t');
        const body = currentResults.map(r => cols.map(c => cellText(r, c.key).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
        copyToClipboard(header + '\n' + body).then(() => toast('已复制 ' + currentResults.length + ' 行')).catch(() => toast('复制失败'));
    });

    async function downloadResults(format) {
        try {
            const r = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // 导出顺序与当前画面（筛选+排序+冻结序）完全一致
                    results: sortedRows(),
                    format,
                    include_icon: $('#chkIncludeIconUrl').checked,
                    include_icon_image: format === 'xlsx' && $('#chkIncludeIconImage').checked,
                }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const blob = await r.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `applookup.${format}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) { toast('导出失败：' + e.message); }
    }
    $('#btnExportCsv').addEventListener('click', () => downloadResults('csv'));
    $('#btnExportXlsx').addEventListener('click', () => downloadResults('xlsx'));

    $('#btnDownloadIcons').addEventListener('click', async () => {
        const items = currentResults.filter(r => r.icon_url).map(r => ({
            url: r.icon_url, app_name: r.app_name || '', platform: r.platform || ''
        }));
        if (!items.length) { toast('没有可下载的图标'); return; }
        if (items.length <= 5) {
            items.forEach(it => {
                const u = `/api/icon?url=${encodeURIComponent(it.url)}&name=${encodeURIComponent(it.app_name)}&platform=${encodeURIComponent(it.platform)}`;
                window.open(u, '_blank');
            });
            return;
        }
        try {
            const r = await fetch('/api/icons_zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const blob = await r.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'icons.zip';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) { toast('打包失败：' + e.message); }
    });

    /* ---------- 单行重查 ---------- */
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.v4-row-retry');
        if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        const pkg = btn.dataset.retryPkg;
        if (!pkg || btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('loading');
        // 重查这一条 → 冻结当前顺序，让填回来的行留在原位置
        pinDisplayOrder();
        try {
            const r = await fetch('/api/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_names: [pkg] }),
            });
            const data = await r.json();
            if (data.results && data.results.length) {
                mergeRows(data.results);
                toast('重查完成：' + pkg);
            } else {
                toast('该条未返回新数据');
            }
        } catch (err) { toast('重查失败：' + err.message); }
        finally { btn.disabled = false; btn.classList.remove('loading'); }
    });

    /* ---------- 重查不完整 ---------- */
    $('#btnRetryIncomplete').addEventListener('click', async () => {
        const pkgs = currentResults.filter(r => r.incomplete).map(r => r.package_name);
        if (!pkgs.length) return;
        const btn = $('#btnRetryIncomplete');
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = '重查中…';
        // 冻结顺序，填回来的行保留在原位
        pinDisplayOrder();
        try {
            const r = await fetch('/api/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_names: pkgs }),
            });
            const data = await r.json();
            if (data.results) { mergeRows(data.results); toast('重查完成'); }
            else toast('重查未返回数据');
        } catch (e) { toast('重查失败：' + e.message); }
        finally { btn.disabled = false; btn.textContent = oldLabel; }
    });

    /* ---------- 取消 ---------- */
    $('#btnCancelJob').addEventListener('click', async () => {
        if (!currentJob) return;
        const hasPartial = currentResults && currentResults.length > 0;
        try { await fetch(`/api/cancel_job/${currentJob.jobId}`, { method: 'POST' }); } catch {}
        closeStream();
        exitLoading();
        clearPending();
        if (hasPartial) {
            // 已经有部分结果：保留结果页，冻结当前行序，给用户看已拿到的
            if (typeof pinDisplayOrder === 'function') pinDisplayOrder();
            markIncomplete();
            showResults();
            // 保留已拿到的结果到历史（legacy 行为：完成才存；取消也值得留个痕）
            if (currentJob.lines && currentJob.lines.length) {
                saveToHistory(currentJob.lines, currentResults);
            }
            currentJob = null;
            toast(`已取消，保留已查到的 ${currentResults.length} 条结果`);
        } else {
            // 完全没有结果：回到搜索界面，输入框还原用户刚输入的内容
            if (currentJob && currentJob.lines && currentJob.lines.length) {
                input.value = currentJob.lines.join('\n');
                input.dispatchEvent(new Event('input'));
            }
            currentJob = null;
            input.classList.remove('is-collapsed');  // 取消返回首页态，清折叠样式
            $('#v4Root').classList.remove('has-results');
            $('#resultsZone').hidden = true;
            _stopTips();
            toast('已取消查询');
        }
    });

    /* ---------- Esc ---------- */
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!$('#batchWarnMask').hidden) { $('#btnBatchCancel').click(); return; }
        if (!$('#inlineProgress').hidden) { $('#btnCancelJob').click(); return; }
    });

    /* ---------- 回到顶部 ---------- */
    window.addEventListener('scroll', () => { $('#btnToTop').hidden = window.scrollY < 300; });
    $('#btnToTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    /* ---------- Logo 回首页 ---------- */
    function goHome() {
        if (currentJob && currentJob.eventSource) {
            try { fetch(`/api/cancel_job/${currentJob.jobId}`, { method: 'POST' }); } catch {}
            closeStream();
        }
        currentJob = null;
        currentResults = [];
        input.value = '';
        delete input.dataset.raw;
        input.dispatchEvent(new Event('input'));
        input.style.height = '';
        input.classList.remove('is-collapsed');  // 回首页清状态，避免首页输入框残留折叠样式
        $('#v4Root').classList.remove('has-results', 'searched');
        $('#resultsZone').hidden = true;
        $('#bgBanner').hidden = true;
        exitLoading();
        _stopTips();  // 回首页：停掉结果页的慢轮播
        if (window._measureStickyHeights) window._measureStickyHeights();
        $('#historyMask').hidden = true;
        setAdvOpen(false);
        clearPending();
        renderHistory();
        input.focus();
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
    const btnHome = $('#btnHome');
    btnHome.addEventListener('click', goHome);
    btnHome.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); }
    });

    /* ---------- Sticky 高度测量（搜索头→toolbar→thead 三层） ---------- */
    window._measureStickyHeights = function() {
        const root = document.documentElement;
        if (!$('#v4Root').classList.contains('has-results')) {
            root.style.setProperty('--sticky-top-1', '0px');
            root.style.setProperty('--sticky-top-2', '0px');
            return;
        }
        const tb = document.querySelector('.v4-tb');
        const h2 = tb && !$('#resultsZone').hidden ? tb.offsetHeight : 0;
        root.style.setProperty('--sticky-top-1', '0px');
        root.style.setProperty('--sticky-top-2', h2 + 'px');
    };
    const _ro = new ResizeObserver(() => window._measureStickyHeights());
    _ro.observe(document.querySelector('.v4-search-zone'));
    // ⚠️ 同时观测 .v4-tb —— toolbar 高度在多种场景会变（inlineProgress 显隐、
    // retryBadge 显隐、tip 长度变化换行、按钮 visibility 切换…），每一处都要
    // 重新测 sticky 不然会出"thead 跑到数据下面"的老 bug（TIPS #13）。
    // 挂 RO 后所有这些场景都自动收到，不再需要每处手动调 _measureStickyHeights。
    const _tbEl = document.querySelector('.v4-tb');
    if (_tbEl) _ro.observe(_tbEl);
    window.addEventListener('resize', window._measureStickyHeights);

    /* ---------- Google 式折叠输入 ----------
       核心规则（从用户视角出发）：
       1) 提交搜索后：多行 → 折叠成一行（空格分隔）展示
       2) 再次聚焦输入框 → 恢复多行，允许编辑
       3) 用户编辑还没再次搜索时，任何情况下都不能丢失内容
       4) 编辑结果和原搜索值不同时，下次聚焦也要基于"用户最新输入"恢复
    */
    // 工具：把一个多行原串压成"空格分隔"的折叠显示形式
    const _toDisplayForm = (raw) => (raw || '')
        .split(/\n+/).map(s => s.trim()).filter(Boolean).join(' ');

    window._collapseInputForResults = function() {
        if (!$('#v4Root').classList.contains('has-results')) return;
        // 用户正把光标放在输入框里审阅/编辑时，别强行折叠。
        // 否则流式 progress 触发的 showResults 会把刚展开的多行再压回一行，
        // 造成"立即点击没多行、等一会才出现"的诡异体验。
        //
        // ⚠️ 想动这个护栏前先读 triggerQuery() —— 那边在开始查询前显式 input.blur()，
        // 就是为了让这里 activeElement !== input，让首次折叠能正常发生。
        // 删这道护栏会让"用户在结果页点击输入框编辑时被流式 progress 跳回单行"那个
        // 老 bug 回归；绕过这道护栏（在 triggerQuery 里 blur）是当前的正解。
        if (document.activeElement === input) return;

        const currentVal = input.value;
        const savedRaw   = input.dataset.raw || '';
        const hasNewlines = currentVal.includes('\n');

        // 决定权威内容（authoritative）：
        //   A. 多行态（input 含换行）— 当前 input.value 就是最新，绝对用它
        //   B. 单行态但 currentVal ≠ 已保存 raw 的折叠显示形式 — 用户改过，以 input.value 为准
        //   C. 单行态且 currentVal === 折叠显示形式 — 还是上次搜索原值，用 savedRaw 还原行数
        let authoritative;
        if (hasNewlines) {
            authoritative = currentVal;
        } else if (savedRaw && currentVal.trim() === _toDisplayForm(savedRaw)) {
            authoritative = savedRaw;
        } else {
            authoritative = currentVal;
        }

        const lines = authoritative.split(/\n+/).map(s => s.trim()).filter(Boolean);
        // dataset.raw 永远跟随权威值更新 — 下次聚焦展开就是用户最新状态
        if (lines.length >= 1) input.dataset.raw = lines.join('\n');
        else delete input.dataset.raw;

        if (lines.length <= 1) {
            // 单行权威：如果当前显示是多行展开态，归一为纯单行；否则保持
            if (hasNewlines) {
                input.value = lines[0] || '';
                input.style.height = '';
            }
            // 单行态也加 is-collapsed，保证样式一致（22px 高、省略号）
            input.classList.add('is-collapsed');
            return;
        }
        // 多行权威：折叠显示为"空格分隔"一行 + 打上 is-collapsed
        input.value = lines.join(' ');
        input.style.height = '';
        input.classList.add('is-collapsed');
    };

    // 一次性展开为多行原值（抽出来让 focus 和 click 都能调用，避免仅靠
    // focus 事件时出现的时序漂移——click 在 mousedown→focus→click 链的任一
    // 节点都应尽快让用户看到原始多行）
    function _expandInputToMultilineIfAny() {
        if (!$('#v4Root').classList.contains('has-results')) return;
        // ⚠ 时序关键：先 remove is-collapsed，CSS `height:22px !important` 才会失效，
        // 后续 scrollHeight 才能读到真实多行高度。顺序反了会测到被压扁的 22px。
        input.classList.remove('is-collapsed');
        // 已经在多行态：只重算高度，不碰 value
        if (input.value.includes('\n')) {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 160) + 'px';
            return;
        }
        const raw = input.dataset.raw || '';
        if (!raw) return;
        // 只在"当前单行显示 = 折叠显示形式"时才覆盖还原；
        // 若用户已经把单行改成了别的内容（正在构思下一次查询），绝不覆盖
        if (input.value.trim() === _toDisplayForm(raw)) {
            input.value = raw;
        }
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    }
    input.addEventListener('focus', _expandInputToMultilineIfAny);
    // pointerdown/mousedown 比 focus 更早触发：用户手指一按就展开，不等 focus 链
    input.addEventListener('pointerdown', _expandInputToMultilineIfAny);
    input.addEventListener('click', _expandInputToMultilineIfAny);
    // 用户输入时实时把"最新权威值"写进 dataset.raw，
    // 这样任何后续时刻触发折叠/展开都能用上用户的真实状态，永远不丢内容。
    input.addEventListener('input', () => {
        if (!$('#v4Root').classList.contains('has-results')) return;
        const val = input.value;
        if (val.includes('\n')) {
            const lines = val.split(/\n+/).map(s => s.trim()).filter(Boolean);
            if (lines.length) input.dataset.raw = lines.join('\n');
            else delete input.dataset.raw;
        } else {
            // 单行编辑：若内容已脱离原折叠显示，覆盖 dataset.raw（用户正写新查询）
            const savedRaw = input.dataset.raw || '';
            if (!savedRaw || val.trim() !== _toDisplayForm(savedRaw)) {
                if (val.trim()) input.dataset.raw = val.trim();
                else delete input.dataset.raw;
            }
        }
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement !== input) window._collapseInputForResults();
        }, 0);
    });

    /* ---------- 启动 ---------- */
    setTimeout(() => input.focus(), 0);
    checkPendingJob();
    window._measureStickyHeights();
    // 后台拉一次"访问模式 + 本机共享设置"，结果返回后可能异步覆盖主题 / 间隔。
    // 故意不 await：让首屏用本地 localStorage 值秒级渲染，不卡白屏。
    _bootstrapSync();

})();
