// ========== 设置 (Settings) ==========

const SETTINGS_KEY = "app_finder_settings";

const DEFAULT_SETTINGS = {
    exactSearch: false,
    getApkUrl: false,
    apkUrlMode: "single",
    getSha1: false,
    getSha256: false,
    queryIntervalMs: 0,
    platformFilter: "all",
    keepInInput: false,
    showPerfWarning: true,
    colorMode: "system",  // "light" | "dark" | "system"
};

// Listen to system color scheme changes; re-apply when current setting is "system"
let _mqlDark = null;
function _isSystemMode() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        return (s.colorMode || "system") === "system";
    } catch { return true; }
}
function _ensureSystemColorListener() {
    if (_mqlDark || !window.matchMedia) return;
    _mqlDark = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (_isSystemMode()) applyColorMode("system"); };
    if (_mqlDark.addEventListener) _mqlDark.addEventListener("change", handler);
    else if (_mqlDark.addListener) _mqlDark.addListener(handler);
    // 部分浏览器从隐藏页恢复时不主动派发 MQ 变化事件，这里再兜一手
    window.addEventListener("pageshow", () => { if (_isSystemMode()) applyColorMode("system"); });
    window.addEventListener("focus",    () => { if (_isSystemMode()) applyColorMode("system"); });
}

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        return Object.assign({}, DEFAULT_SETTINGS, s);
    } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings() {
    const s = {
        exactSearch: document.getElementById("exactSearch")?.checked || false,
        getApkUrl: document.getElementById("getApkUrl")?.checked || false,
        apkUrlMode: document.querySelector('input[name="apkUrlMode"]:checked')?.value || "single",
        getSha1: document.getElementById("getSha1")?.checked || false,
        getSha256: document.getElementById("getSha256")?.checked || false,
        queryIntervalMs: parseInt(document.getElementById("queryIntervalSlider")?.value || 0),
        platformFilter: document.querySelector('input[name="platformFilter"]:checked')?.value || "all",
        keepInInput: document.getElementById("keepInInput")?.checked || false,
        showPerfWarning: document.getElementById("showPerfWarning")?.checked ?? true,
        colorMode: document.querySelector('input[name="colorMode"]:checked')?.value || "system",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    applyColorMode(s.colorMode);
}

function applySettings(s) {
    // Exact search
    const exactEl = document.getElementById("exactSearch");
    if (exactEl) exactEl.checked = s.exactSearch;

    // APK URL
    const apkEl = document.getElementById("getApkUrl");
    if (apkEl) {
        apkEl.checked = s.getApkUrl;
        const modeRow = document.getElementById("apkUrlModeRow");
        if (modeRow) modeRow.style.display = s.getApkUrl ? "flex" : "none";
    }

    // APK URL mode
    const modeEl = document.querySelector(`input[name="apkUrlMode"][value="${s.apkUrlMode}"]`);
    if (modeEl) modeEl.checked = true;

    // SHA1
    const sha1El = document.getElementById("getSha1");
    if (sha1El) sha1El.checked = s.getSha1;

    // SHA256
    const sha256El = document.getElementById("getSha256");
    if (sha256El) sha256El.checked = s.getSha256 || false;

    // Interval slider
    const slider = document.getElementById("queryIntervalSlider");
    if (slider) {
        slider.value = s.queryIntervalMs;
        updateIntervalBadge(s.queryIntervalMs);
    }

    // Platform filter
    const pfEl = document.querySelector(`input[name="platformFilter"][value="${s.platformFilter}"]`);
    if (pfEl) pfEl.checked = true;

    // Keep in input
    const keepEl = document.getElementById("keepInInput");
    if (keepEl) keepEl.checked = s.keepInInput;

    // Perf warning toggle
    const perfToggleEl = document.getElementById("showPerfWarning");
    if (perfToggleEl) perfToggleEl.checked = s.showPerfWarning !== false;

    // Color mode
    const cmEl = document.querySelector(`input[name="colorMode"][value="${s.colorMode || 'system'}"]`);
    if (cmEl) cmEl.checked = true;
    applyColorMode(s.colorMode || "system");

    // Update android extensions state based on platform filter
    updateAndroidExtensionsState();
}

function applyColorMode(mode) {
    let actual = mode;
    if (mode === "system") {
        _ensureSystemColorListener();
        actual = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", actual === "dark" ? "dark" : "light");
}


const COL_WIDTH_KEY = "app_finder_col_width";
const DEFAULT_HIST_WIDTH = 270;

/** hist-col 高度始终跟 search-col 齐平，超出内容则列表内滚动 */
function syncHistColHeight() {
    const searchCol = document.querySelector(".search-col");
    const histCol   = document.getElementById("histCol");
    if (!searchCol || !histCol) return;
    const h = searchCol.offsetHeight;
    if (h > 0) histCol.style.height = h + "px";
}

function initColResizer() {
    const histCol  = document.getElementById("histCol");
    const resizer  = document.getElementById("colResizer");
    if (!histCol || !resizer) return;

    // 恢复上次宽度
    const saved = parseInt(localStorage.getItem(COL_WIDTH_KEY));
    if (saved && saved >= 150 && saved <= 560) {
        histCol.style.width = saved + "px";
        histCol.style.flex  = "none";
    }

    let startX, startWidth;
    resizer.addEventListener("mousedown", e => {
        startX     = e.clientX;
        startWidth = histCol.offsetWidth;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
        document.body.style.cursor     = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    });
    function onMove(e) {
        const w = Math.max(150, Math.min(560, startWidth + e.clientX - startX));
        histCol.style.width = w + "px";
        histCol.style.flex  = "none";
    }
    function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
        localStorage.setItem(COL_WIDTH_KEY, histCol.offsetWidth);
    }
}

function resetSettings() {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(COL_WIDTH_KEY);
    // 重置分栏比例到默认值
    const histCol = document.getElementById("histCol");
    if (histCol) { histCol.style.width = DEFAULT_HIST_WIDTH + "px"; histCol.style.flex = "none"; }
    applySettings(DEFAULT_SETTINGS);
    renderPresetSelect();
    showToast("已恢复默认设置");
}

// ========== 设置面板开关 ==========

function openSettings() {
    document.getElementById("settingsOverlay").classList.add("open");
    // 拉取 admin 状态，LAN 访客侧要隐藏"开机自启 / 关闭服务"等管理按钮
    fetch("/api/lan_info").then(r => r.json()).then(d => {
        const isAdmin = !!d.is_admin;
        document.body.classList.toggle("is-lan-guest", !isAdmin);
    }).catch(() => {});
    // 刷新开机自启状态
    fetch("/api/startup/status").then(r => r.json()).then(d => {
        const el = document.getElementById("startupStatus");
        if (el) {
            el.textContent = d.enabled ? "✓ 已开启" : "未开启";
            el.style.color = d.enabled ? "#52c41a" : "#999";
        }
    }).catch(() => {});
    // 关于区的微信二维码：服务端动态生成，不打包图片，减小体积
    _loadAboutQr();
}

function _copyWechatId(el) {
    const id = (el && el.textContent || "rickaruike").trim();
    _copyText(id).then(() => {
        showToast("已复制微信号：" + id);
        if (el) {
            el.classList.add("copied");
            setTimeout(() => el.classList.remove("copied"), 500);
        }
    }).catch(() => showToast("复制失败，请手动长按选中复制"));
}

function _loadAboutQr() {
    const img = document.getElementById("aboutWechatQr");
    const ph  = document.getElementById("aboutWechatQrPlaceholder");
    if (!img || img.dataset.loaded === "1") return;
    fetch("/api/about_info").then(r => r.json()).then(d => {
        if (d.wechat_qr_data_url) {
            img.src = d.wechat_qr_data_url;
            img.style.display = "block";
            if (ph) ph.style.display = "none";
            img.dataset.loaded = "1";
        } else if (ph) {
            ph.textContent = "二维码加载失败";
        }
    }).catch(() => { if (ph) ph.textContent = "二维码加载失败"; });
}

function closeSettings() {
    document.getElementById("settingsOverlay").classList.remove("open");
    saveSettings();
}

function closeSettingsIfBg(e) {
    if (e.target === document.getElementById("settingsOverlay")) closeSettings();
}

// ========== LAN 分享 ==========

let _lanStatsTimer = null;

async function openLanShare() {
    const overlay = document.getElementById("lanShareOverlay");
    overlay.style.display = "flex";
    await _renderLanShare();
}

async function _renderLanShare() {
    const body = document.getElementById("lanShareBody");
    body.innerHTML = '<div class="lan-share-loading">加载中…</div>';
    try {
        const resp = await fetch("/api/lan_info");
        const data = await resp.json();
        if (!data.accessible) {
            body.innerHTML = `
                <div class="lan-share-unavail">
                    <p class="lan-share-unavail-title">⚠️ 没检测到可用的局域网</p>
                    <p class="lan-share-tip">请确认本机已连接到 Wi-Fi / 有线局域网，然后重新打开本面板。</p>
                </div>`;
            return;
        }

        // 顶部开关 + 警告（LAN 访客只能看到开关状态，不能切换）
        const toggleChecked = data.enabled ? "checked" : "";
        const disabledCls = data.enabled ? "" : "lan-disabled";
        const isAdmin = !!data.is_admin;
        const toggleAttrs = isAdmin
            ? `onchange="toggleLanAccess(this.checked)"`
            : `disabled onchange="return false"`;
        const adminHint = isAdmin ? "" : `
            <div class="lan-toggle-lock">🔐 仅运行本工具的电脑管理员可切换</div>`;
        // modal 宽度随开关状态切换：关闭=紧凑；开启=横向展开，右边显示连接设备
        const box = document.querySelector(".lan-share-box");
        if (box) box.classList.toggle("lan-expanded", !!data.enabled);

        body.innerHTML = `
            <div class="lan-body">
                <!-- 左：开关（永远可点） + 灰化内容区（关闭时只灰这里）-->
                <div class="lan-body-left">
                    <div class="lan-toggle-row ${isAdmin ? '' : 'lan-toggle-readonly'}">
                        <label class="lan-toggle-switch">
                            <input type="checkbox" id="lanToggle" ${toggleChecked} ${toggleAttrs}>
                            <span class="lan-toggle-slider"></span>
                        </label>
                        <div class="lan-toggle-text">
                            <div class="lan-toggle-title">${data.enabled ? "✅ LAN 共享已开启" : "🔒 LAN 共享未开启"}</div>
                            <div class="lan-toggle-hint">${data.enabled
                                ? "同一局域网下的其他设备可以访问下方地址"
                                : (isAdmin ? "打开开关后，其他设备才能访问本机服务" : "当前不可访问，请联系本机管理员开启")}</div>
                            ${adminHint}
                        </div>
                    </div>
                    <div class="lan-content ${disabledCls}">
                        <div class="lan-warn-banner">
                            ⚠️ <b>安全提示</b>：此服务<b>仅限局域网内访问</b>，不会暴露到公网。
                            但同一局域网下<b>任何人知道该地址都能直接使用</b>（无账号密码保护），
                            请仅在信任的网络（家 / 办公室）下开启。
                        </div>
                        <p class="lan-share-intro">其他设备（手机 / 平板 / 电脑）在同一 Wi-Fi 下访问：</p>
                        <div class="lan-share-url-card" id="lanShareUrlCard" onclick="copyLanUrl(this)" title="点击复制">
                            <svg class="lan-share-url-icon" width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M6 9 a3 3 0 0 1 0-4 l2-2 a3 3 0 0 1 4 4 l-1 1 M10 7 a3 3 0 0 1 0 4 l-2 2 a3 3 0 0 1 -4 -4 l1 -1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                            <span class="lan-share-url-text" id="lanShareUrlText">${data.url}</span>
                        </div>
                        <div class="lan-share-qr-wrap">
                            <img src="${data.qr_data_url}" alt="扫码访问" class="lan-share-qr">
                            <p class="lan-share-qr-hint">手机扫描二维码直接打开</p>
                        </div>
                        <p class="lan-share-note">
                            ⚡ 查询在本机（${data.lan_ip}）执行，其他设备仅作为显示端。关闭本工具后其他设备将无法继续使用。
                        </p>
                    </div>
                </div>
                <!-- 右：连接设备（仅开启后出现，与左侧顶部对齐）-->
                <div id="lanStatsWrap" class="lan-stats-wrap"></div>
            </div>`;

        // 启动定时刷新统计
        if (_lanStatsTimer) clearInterval(_lanStatsTimer);
        if (data.enabled) {
            _refreshLanStats();
            _lanStatsTimer = setInterval(_refreshLanStats, 3000);
        }
    } catch (e) {
        body.innerHTML = `<div class="lan-share-unavail"><p class="lan-share-unavail-title">加载失败</p><p class="lan-share-tip">${e}</p></div>`;
    }
}

async function toggleLanAccess(enabled) {
    try {
        const resp = await fetch("/api/lan_toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
        });
        const d = await resp.json();
        if (d.ok) {
            showToast(d.enabled ? "已开启 LAN 共享" : "已关闭 LAN 共享");
            await _renderLanShare();  // 重绘面板反映新状态
        } else {
            showToast("切换失败：" + (d.error || ""));
        }
    } catch (e) {
        showToast("切换失败：" + e);
    }
}

async function _refreshLanStats() {
    try {
        const resp = await fetch("/api/lan_stats");
        const data = await resp.json();
        const wrap = document.getElementById("lanStatsWrap");
        if (!wrap) return;
        if (!data.enabled) {
            wrap.innerHTML = "";
            return;
        }
        if (data.device_count === 0) {
            wrap.innerHTML = `
                <div class="lan-stats-box lan-stats-empty">
                    <div class="lan-stats-title">📡 连接情况</div>
                    <div class="lan-stats-empty-text">暂无其他设备访问</div>
                </div>`;
            return;
        }
        const rows = data.devices.map(d => _renderDeviceCard(d)).join("");
        wrap.innerHTML = `
            <div class="lan-stats-box">
                <div class="lan-stats-title">
                    📡 连接情况
                    <span class="lan-stats-summary">${data.device_count} 台 · ${data.total_queries} 次查询</span>
                </div>
                ${rows}
            </div>`;
    } catch (e) { /* 静默 */ }
}

/** 渲染单台设备卡片（含备注 / 屏蔽操作）*/
function _renderDeviceCard(d) {
    const ago = d.last_seen_ago_sec < 5 ? "刚刚" :
                d.last_seen_ago_sec < 60 ? `${d.last_seen_ago_sec}秒前` :
                d.last_seen_ago_sec < 3600 ? `${Math.floor(d.last_seen_ago_sec/60)}分钟前` :
                d.last_seen_ago_sec < 86400 ? `${Math.floor(d.last_seen_ago_sec/3600)}小时前` :
                "很久前";
    const active = d.last_seen_ago_sec < 60 && !d.blocked;
    const blockedCls = d.blocked ? "blocked" : "";
    // 主标识：有备注就显主备注；否则 hostname；否则 UA 简写
    const primaryName = d.note || d.hostname || d.ua_short || "未知设备";
    const showNoteBadge = !!d.note;
    // 副信息组装
    const subParts = [];
    if (d.hostname && d.hostname !== primaryName) subParts.push(`<span class="dev-host">${_esc(d.hostname)}</span>`);
    if (d.ua_short && d.ua_short !== primaryName) subParts.push(`<span class="dev-ua">${_esc(d.ua_short)}</span>`);
    if (d.mac) subParts.push(`<span class="dev-mac">${d.mac}</span>`);
    const subLine = subParts.join(" · ");

    const blockBtnLabel = d.blocked ? "解除屏蔽" : "屏蔽";
    const blockBtnCls   = d.blocked ? "dev-btn-unblock" : "dev-btn-block";

    return `
        <div class="lan-stats-device ${active ? 'active' : ''} ${blockedCls}" data-ip="${d.ip}">
            <div class="dev-head">
                <span class="lan-stats-dot ${active ? 'on' : ''}"></span>
                <span class="dev-name" onclick="_editDeviceNote('${d.ip}', this)">
                    ${_esc(primaryName)}
                    ${showNoteBadge ? '<span class="dev-note-badge">备注</span>' : ''}
                </span>
                <div class="dev-actions">
                    <button class="dev-btn dev-btn-note" title="${d.note ? '编辑备注' : '添加备注'}" onclick="_editDeviceNote('${d.ip}', this)">✎</button>
                    <button class="dev-btn ${blockBtnCls}" title="${blockBtnLabel}" onclick="_toggleBlockDevice('${d.ip}', ${d.blocked})">
                        ${d.blocked ? '✓' : '🚫'}
                    </button>
                </div>
            </div>
            <div class="dev-sub">
                <span class="dev-ip">${d.ip}</span>
                ${subLine ? ' · ' + subLine : ''}
            </div>
            <div class="dev-footer">
                ${d.blocked ? '<span class="dev-blocked-tag">已屏蔽</span>' :
                  `查询 <b>${d.query_count}</b> 次 · ${ago}`}
            </div>
        </div>`;
}

function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** 原地编辑备注：点 ✎ 或设备名 → dev-name 变成输入框，回车/失焦保存，Esc 取消。
 *  期间暂停 stats 轮询刷新，避免用户正在输入时 DOM 被重绘冲掉。*/
function _editDeviceNote(ip, triggerEl) {
    const row = document.querySelector(`.lan-stats-device[data-ip="${ip}"]`);
    if (!row) return;
    const nameEl = row.querySelector(".dev-name");
    if (!nameEl || nameEl.querySelector("input")) return;  // 已在编辑

    // 取当前备注（从 DOM 反推，避免额外 API 调用）
    const badge = nameEl.querySelector(".dev-note-badge");
    const currentNote = badge
        ? (nameEl.textContent || "").replace("备注", "").trim()
        : "";  // 没备注则输入框为空

    // 暂停自动刷新
    const prevTimer = _lanStatsTimer;
    if (prevTimer) { clearInterval(prevTimer); _lanStatsTimer = null; }

    const origHTML = nameEl.innerHTML;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "dev-name-edit";
    input.value = currentNote;
    input.placeholder = "输入备注（回车保存 / Esc 取消）";
    input.maxLength = 40;

    nameEl.innerHTML = "";
    nameEl.appendChild(input);
    nameEl.classList.add("editing");
    input.focus();
    input.select();

    let finished = false;
    const resumePolling = () => {
        if (!_lanStatsTimer) {
            _lanStatsTimer = setInterval(_refreshLanStats, 3000);
        }
    };

    const save = async () => {
        if (finished) return; finished = true;
        const newNote = input.value.trim();
        try {
            const resp = await fetch("/api/lan_device_note", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ip, note: newNote }),
            });
            const d = await resp.json();
            if (d.ok) {
                if (newNote) showToast(`已备注 ${ip}：${newNote}`);
                else if (currentNote) showToast(`已清空 ${ip} 的备注`);
                _refreshLanStats();
            } else {
                showToast("保存失败：" + (d.error || d.message || ""));
                nameEl.innerHTML = origHTML;
                nameEl.classList.remove("editing");
            }
        } catch (e) {
            showToast("保存失败：" + e);
            nameEl.innerHTML = origHTML;
            nameEl.classList.remove("editing");
        }
        resumePolling();
    };

    const cancel = () => {
        if (finished) return; finished = true;
        nameEl.innerHTML = origHTML;
        nameEl.classList.remove("editing");
        resumePolling();
    };

    input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => setTimeout(save, 50));
}

async function _toggleBlockDevice(ip, currentBlocked) {
    const willBlock = !currentBlocked;
    if (willBlock && !confirm(`确定要屏蔽 ${ip} 吗？\n该设备将无法访问本工具（可在此面板解除）。`)) {
        return;
    }
    try {
        const resp = await fetch("/api/lan_device_block", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ip, blocked: willBlock }),
        });
        const d = await resp.json();
        if (d.ok) {
            showToast(willBlock ? `已屏蔽 ${ip}` : `已解除屏蔽 ${ip}`);
            _refreshLanStats();
        } else {
            showToast("操作失败：" + (d.error || ""));
        }
    } catch (e) { showToast("操作失败"); }
}

function closeLanShare() {
    document.getElementById("lanShareOverlay").style.display = "none";
    if (_lanStatsTimer) { clearInterval(_lanStatsTimer); _lanStatsTimer = null; }
}

function closeLanShareIfBg(e) {
    if (e.target === document.getElementById("lanShareOverlay")) closeLanShare();
}

function copyLanUrl(card) {
    const urlText = document.getElementById("lanShareUrlText");
    const url = urlText ? urlText.textContent.trim() : "";
    if (!url) return;
    _copyText(url).then(() => {
        showToast("链接已复制");
        const target = card || document.getElementById("lanShareUrlCard");
        if (target) {
            target.classList.add("copied");
            setTimeout(() => target.classList.remove("copied"), 900);
        }
    }).catch(() => showToast("复制失败，请手动长按选中复制"));
}

// ========== 查询间隔 ==========

function onIntervalSliderChange() {
    const val = parseInt(document.getElementById("queryIntervalSlider").value);
    updateIntervalBadge(val);
}

function updateIntervalBadge(ms) {
    const badge = document.getElementById("intervalValueBadge");
    if (!badge) return;
    if (ms === 0) {
        badge.textContent = "关闭";
        badge.style.background = "#f0f0f0";
        badge.style.color = "#999";
    } else {
        badge.textContent = ms >= 1000 ? `${ms / 1000} 秒` : `${ms} ms`;
        badge.style.background = ms >= 2000 ? "#fff3e0" : "#e8f5e9";
        badge.style.color = ms >= 2000 ? "#e67e22" : "#2e7d32";
    }
}

// ========== 关闭服务 ==========

function confirmShutdown() {
    document.getElementById("shutdownOverlay").style.display = "flex";
}

function doShutdown() {
    document.getElementById("shutdownOverlay").style.display = "none";
    closeSettings();
    fetch("/api/shutdown", { method: "POST" })
        .then(() => {
            document.body.innerHTML = `<div style="text-align:center;padding:80px 20px;font-family:sans-serif;color:#666;">
                <p style="font-size:20px;margin-bottom:12px;">✓ 服务已关闭</p>
                <p style="font-size:14px;">如需重新使用，请重新启动程序。</p>
            </div>`;
        })
        .catch(() => showToast("关闭失败，请手动关闭窗口"));
}

// ========== 开机自启 ==========

function setupStartup(enable) {
    fetch("/api/startup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
    }).then(r => r.json()).then(d => {
        document.getElementById("startupStatus").textContent = d.enabled ? "✓ 已开启" : "未开启";
        document.getElementById("startupStatus").style.color = d.enabled ? "#52c41a" : "#999";
        showToast(d.message || (enable ? "已添加开机启动" : "已取消开机启动"));
    }).catch(() => showToast("操作失败"));
}

// ========== 历史记录 ==========

const HISTORY_KEY = "app_finder_history";
const HISTORY_SHARE_KEY = "app_finder_history_share";  // "1" 代表当前设备启用共享模式
const MY_TIMESTAMPS_KEY = "app_finder_my_timestamps"; // 本设备查过的 timestamp 列表（持久化）
const MAX_HISTORY = 20;
const MAX_MY_TS = 500;   // 本设备 timestamp 最多记多少条，避免无限增长
const HISTORY_POLL_MS = 4000;   // 共享模式下每 4 秒拉一次，发现新条目立即刷

// 历史记录两套存储模式：
//  - 本地（默认）：localStorage[HISTORY_KEY]，每台设备独立
//  - 共享（用户手动开启）：服务端 /api/history，所有"开启共享"的设备看到同一份
let _historyCache = null;
let _historyPollTimer = null;
// "本设备查过的 timestamp 集合"——持久化到 localStorage，刷新后仍在。
// 共享模式下：不在这里的条目 = 来自其他设备 → 加云朵
const _localSessionTs = new Set(_loadMyTimestamps());

function _loadMyTimestamps() {
    try {
        const arr = JSON.parse(localStorage.getItem(MY_TIMESTAMPS_KEY)) || [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}
function _rememberMyTimestamp(ts) {
    if (!ts) return;
    _localSessionTs.add(ts);
    // 持久化；超出上限按插入顺序砍掉最旧的
    try {
        let arr = [..._localSessionTs];
        if (arr.length > MAX_MY_TS) arr = arr.slice(-MAX_MY_TS);
        localStorage.setItem(MY_TIMESTAMPS_KEY, JSON.stringify(arr));
    } catch (_) {}
}

function _isHistoryShared() {
    return localStorage.getItem(HISTORY_SHARE_KEY) === "1";
}

function getHistory() { return _historyCache || []; }

async function _loadHistoryByMode() {
    if (_isHistoryShared()) {
        try {
            const resp = await fetch("/api/history");
            const d = await resp.json();
            _historyCache = Array.isArray(d.history) ? d.history : [];
        } catch (e) { _historyCache = []; }
        _startHistoryPolling();
    } else {
        _stopHistoryPolling();
        try { _historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
        catch { _historyCache = []; }
    }
    renderHistory();
    _updateHistoryShareToggleUI();
}

/** 共享模式下启动定时轮询——有新条目时自动打到 UI，无需用户刷新 */
function _startHistoryPolling() {
    _stopHistoryPolling();
    _historyPollTimer = setInterval(async () => {
        if (!_isHistoryShared()) { _stopHistoryPolling(); return; }
        try {
            const resp = await fetch("/api/history");
            const d = await resp.json();
            const latest = Array.isArray(d.history) ? d.history : [];
            const knownTs = new Set((_historyCache || []).map(h => h.timestamp));
            const fresh = latest.filter(h => !knownTs.has(h.timestamp));
            if (fresh.length > 0 || latest.length !== (_historyCache || []).length) {
                _historyCache = latest;
                renderHistory();
            }
        } catch (_) { /* 静默 */ }
    }, HISTORY_POLL_MS);
}

function _stopHistoryPolling() {
    if (_historyPollTimer) { clearInterval(_historyPollTimer); _historyPollTimer = null; }
}

async function _pushHistoryToServer(entry) {
    try {
        await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry }),
        });
    } catch (_) {}
}

function _saveLocalHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }
    catch (_) {
        // 容量爆了——砍 results 再试
        const light = list.map(h => ({ ...h, results: [] }));
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(light)); } catch (_) {}
    }
}

async function saveToHistory(packageNames, results) {
    const isBatch = packageNames.length > 1;
    const appNames = [...new Set(results.filter(r => r.app_name !== "未找到").map(r => r.app_name))];
    const entry = {
        packages: packageNames,
        label: isBatch ? `${packageNames[0]} 等${packageNames.length}个` : packageNames[0],
        appNames: appNames.slice(0, 5),
        isBatch,
        time: Date.now(),
        timestamp: Date.now(),
        results: results.slice(0, 60),
    };
    if (!_historyCache) _historyCache = [];
    _historyCache = _historyCache.filter(
        h => JSON.stringify(h.packages) !== JSON.stringify(packageNames)
    );
    _historyCache.unshift(entry);
    if (_historyCache.length > MAX_HISTORY) _historyCache = _historyCache.slice(0, MAX_HISTORY);
    // 记住自己发的 timestamp（持久化到 localStorage），后续永远不会被误标为云端同步
    _rememberMyTimestamp(entry.timestamp);
    renderHistory();

    if (_isHistoryShared()) {
        _pushHistoryToServer(entry);
    } else {
        _saveLocalHistory(_historyCache);
    }
}

async function clearHistory() {
    if (_isHistoryShared()) {
        try {
            const resp = await fetch("/api/history", { method: "DELETE" });
            const d = await resp.json();
            if (d.error === "forbidden") {
                showToast("共享历史只能由运行本工具的电脑管理员清空");
                return;
            }
        } catch (e) { showToast("清空失败"); return; }
    } else {
        localStorage.removeItem(HISTORY_KEY);
    }
    _historyCache = [];
    renderHistory();
}

/** 切换共享模式（当前设备级的选择）。切换时不合并数据——各管各的。*/
async function toggleHistoryShare() {
    const willShare = !_isHistoryShared();
    if (willShare) {
        // 首次开启：如果本地有历史、而服务端共享池里还没有，问问要不要一次性上传
        let localCount = 0;
        try { localCount = (JSON.parse(localStorage.getItem(HISTORY_KEY)) || []).length; }
        catch (_) {}
        if (localCount > 0 && confirm(
            `开启共享后，本设备新的查询会同步到共享池；其他开启了共享的设备也能看到。\n` +
            `你本地当前有 ${localCount} 条历史，要不要一次性上传到共享池？\n\n` +
            `（点"取消"只切换模式，本地历史保留在本机不上传）`
        )) {
            try {
                const legacy = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
                for (const h of legacy) {
                    if (!h.timestamp) h.timestamp = h.time || Date.now();
                    await _pushHistoryToServer(h);
                }
                showToast(`已上传 ${legacy.length} 条历史到共享池`);
            } catch (_) { showToast("上传失败，但已切换到共享模式"); }
        }
    }
    localStorage.setItem(HISTORY_SHARE_KEY, willShare ? "1" : "0");
    _historyCache = null;
    await _loadHistoryByMode();
    showToast(willShare ? "已开启历史共享" : "已切回本地历史");
}

/** 更新切换按钮的显示（图标 + 文字 + tooltip）*/
function _updateHistoryShareToggleUI() {
    const btn = document.getElementById("btnHistoryShare");
    if (!btn) return;
    const shared = _isHistoryShared();
    btn.classList.toggle("is-shared", shared);
    btn.title = shared
        ? '历史已共享，点击切回"仅本设备"模式'
        : '历史仅本设备可见，点击切换为"与其他设备共享"模式';
    const labelEl = btn.querySelector(".hist-share-label");
    if (labelEl) labelEl.textContent = shared ? "共享" : "本地";
}

function renderHistory() {
    const history = getHistory();
    const list = document.getElementById("historyList");
    if (!list) return;
    list.innerHTML = "";

    if (history.length === 0) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "暂无查询记录";
        list.appendChild(empty);
        return;
    }

    history.forEach(entry => {
        const item = document.createElement("div");
        item.className = "history-item";
        // 共享模式下，凡是"不是本会话自己查的"条目，都当成从其他设备同步过来
        // （首次打开所有已有条目都会被标；本会话新查时 _localSessionTs 记录，不会被误标）
        const fromRemote = _isHistoryShared()
            && entry.timestamp != null
            && !_localSessionTs.has(entry.timestamp);
        if (fromRemote) item.classList.add("from-remote");
        item.title = fromRemote
            ? "从其他设备同步过来 · 点击重新搜索"
            : "点击重新搜索";
        item.addEventListener("click", () => onHistoryClick(entry));

        // 云朵标记（来自其他设备）
        if (fromRemote) {
            const cloud = document.createElement("span");
            cloud.className = "hist-cloud";
            cloud.title = "来自其他设备";
            cloud.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 11 a3 3 0 0 1 0-6 a3.5 3.5 0 0 1 7 -1 a2.5 2.5 0 0 1 1 5 z" fill="currentColor"/></svg>';
            item.appendChild(cloud);
        }

        // 主文本
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = entry.label;
        item.appendChild(label);

        // App 名称（取第一个，保持紧凑）
        if (entry.appNames && entry.appNames.length > 0) {
            const names = document.createElement("span");
            names.className = "app-names";
            names.textContent = "(" + entry.appNames[0] + (entry.appNames.length > 1 ? "…" : "") + ")";
            item.appendChild(names);
        }

        // 显示历史结果按钮
        if (entry.results && entry.results.length > 0) {
            const resultBtn = document.createElement("button");
            resultBtn.className = "history-result-btn";
            resultBtn.textContent = "显示";
            resultBtn.title = "直接显示上次结果，不重新请求";
            resultBtn.addEventListener("click", e => {
                e.stopPropagation();
                showCachedResults(entry);
            });
            item.appendChild(resultBtn);
        }

        list.appendChild(item);
    });

    // 渲染完后同步高度
    requestAnimationFrame(syncHistColHeight);
}

function onHistoryClick(entry) {
    const keepInInput = document.getElementById("keepInInput")?.checked || false;
    if (entry.packages.length >= BATCH_WARN_THRESHOLD) {
        const intervalMs = parseInt(document.getElementById("queryIntervalSlider")?.value || 0);
        requestNotificationPermission();
        showRiskWarning(entry.packages.length, intervalMs,
            (batchInterval) => startQuery(entry.packages, keepInInput, batchInterval));
    } else {
        startQuery(entry.packages, keepInInput);
    }
}

function showCachedResults(entry) {
    if (!entry.results || entry.results.length === 0) {
        showToast("暂无缓存结果");
        return;
    }
    // 切换历史缓存等同于一次新的结果展示：重置行分组基准与用户滚动干预状态，
    // 避免沿用上一轮查询的 _lastPkgForGroup（导致分组样式错乱）或 _userScrollIntervened
    // （导致自动滚动行为在缓存结果上异常失效/生效）
    _lastPkgForGroup = null;
    _userScrollIntervened = false;
    currentResults = entry.results;
    renderResults(entry.results);
    const keepInInput = document.getElementById("keepInInput")?.checked || false;
    if (keepInInput) {
        document.getElementById("packageInput").value = entry.packages.join("\n");
    }
}

// ========== 批量查询确认弹窗（≥10条）==========
// 默认在弹窗里提供"间隔时间"滑块，默认 1.5s，仅对本次批量查询生效。
// itemCount > 100 时额外要求输入 "i know the risk"。

const BATCH_WARN_THRESHOLD = 50;         // ≥ 该条数触发批量查询提示
const BATCH_DEFAULT_INTERVAL_MS = 1500;  // 弹窗里"间隔时间"的默认值

function showRiskWarning(itemCount, intervalMs, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const strongRisk = itemCount > 100;
    // 弹窗内的间隔滑块：优先用用户已有设置，否则用默认 1.5s
    const initialInterval = intervalMs > 0 ? intervalMs : BATCH_DEFAULT_INTERVAL_MS;
    const strongRiskBlock = strongRisk ? `
        <p class="risk-hint">数量较多，请在下方输入 <code>i know the risk</code> 后确认：</p>
        <input type="text" id="riskInput" class="risk-input" placeholder="i know the risk" autocomplete="off" spellcheck="false">
    ` : "";
    overlay.innerHTML = `
        <div class="confirm-box risk-box">
            <h3>⚠️ 批量查询风险提示</h3>
            <p>您即将查询 <span class="risk-count-badge">${itemCount} 条</span> 数据。</p>
            <p style="font-size:13px;color:#666;">大量并发请求可能导致 IP 被小米、腾讯等应用商店封锁，影响后续使用。建议设置查询间隔以降低风险。</p>
            <div class="batch-interval-row">
                <label class="batch-interval-label">
                    查询间隔
                    <span class="batch-interval-hint">（仅对本次批量查询生效，默认 1.5 秒）</span>
                </label>
                <div class="batch-interval-slider-row">
                    <input type="range" id="batchIntervalSlider" min="0" max="5000" step="100" value="${initialInterval}">
                    <span class="interval-value-badge" id="batchIntervalBadge">${_fmtIntervalMs(initialInterval)}</span>
                </div>
            </div>
            ${strongRiskBlock}
            <div class="btn-row">
                <button class="btn btn-secondary" id="riskCancel">取消</button>
                <button class="btn btn-primary" id="riskOk"${strongRisk ? " disabled" : ""}>确认查询</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    // 间隔滑块
    const slider = overlay.querySelector("#batchIntervalSlider");
    const badge  = overlay.querySelector("#batchIntervalBadge");
    slider.addEventListener("input", () => {
        badge.textContent = _fmtIntervalMs(parseInt(slider.value || 0));
    });

    const okBtn = overlay.querySelector("#riskOk");
    if (strongRisk) {
        const input = overlay.querySelector("#riskInput");
        input.addEventListener("input", () => {
            const valid = input.value.trim() === "i know the risk";
            okBtn.disabled = !valid;
            input.classList.toggle("valid", valid);
        });
        setTimeout(() => input.focus(), 100);
    } else {
        setTimeout(() => okBtn.focus(), 100);
    }

    const doConfirm = () => {
        const batchInterval = parseInt(slider.value || 0);
        overlay.remove();
        // 带上弹窗里选的间隔（仅本次生效，不持久化到设置）
        onConfirm(batchInterval);
    };

    overlay.querySelector("#riskCancel").onclick = () => overlay.remove();
    okBtn.onclick = doConfirm;
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.preventDefault(); overlay.remove(); }
        if (e.key === "Enter" && !okBtn.disabled) { e.preventDefault(); doConfirm(); }
    });
}

function _fmtIntervalMs(ms) {
    if (!ms || ms <= 0) return "不限";
    return ms >= 1000 ? (ms / 1000).toFixed(1).replace(/\.0$/, "") + " 秒" : ms + " ms";
}

// ========== 浏览器通知 ==========

async function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        await Notification.requestPermission();
    }
}

function sendNotification(resultCount) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("App 查询完成", { body: `共查到 ${resultCount} 条结果，点击查看` });
}

// ========== 后台查询横幅 ==========

function showBackgroundBanner() {
    const banner = document.getElementById("bgJobBanner");
    if (!banner) return;
    banner.style.display = "flex";
    // 请求通知权限（此时用户正在页面上，是最好的时机）
    requestNotificationPermission();
}

function hideBackgroundBanner() {
    const banner = document.getElementById("bgJobBanner");
    if (banner) banner.style.display = "none";
}

// ========== 页面加载时恢复未完成/未读 job ==========

async function checkPendingJob() {
    const saved = localStorage.getItem(PENDING_JOB_KEY);
    if (!saved) return;
    let pending;
    try { pending = JSON.parse(saved); } catch { localStorage.removeItem(PENDING_JOB_KEY); return; }

    const { job_id, packageNames } = pending;
    if (!job_id) { localStorage.removeItem(PENDING_JOB_KEY); return; }

    let statusData;
    try {
        const r = await fetch(`/api/job_status/${job_id}`);
        statusData = await r.json();
    } catch { return; }  // 服务重启了，job 不存在，静默忽略

    if (!statusData.found) {
        // job 已过期（服务重启或超2小时），清除
        localStorage.removeItem(PENDING_JOB_KEY);
        return;
    }

    if (statusData.status === 'done') {
        // 查询已完成，自动呈现结果
        localStorage.removeItem(PENDING_JOB_KEY);
        currentResults = statusData.results;
        renderResults(statusData.results);
        showQueryInfo({ results: statusData.results, over_limit: 0, invalid_count: 0, deduplicated: 0 });
        sendNotification(statusData.results.length);
        showToast("上次的查询结果已恢复");
    } else {
        // job 仍在运行（服务没重启），重连流继续接收
        const loadingEl  = document.getElementById("loading");
        const btnQuery   = document.getElementById("btnQuery");
        const loadingTxt = document.getElementById("loadingText");
        loadingEl.style.display = "flex";
        btnQuery.disabled = true;
        loadingTxt.textContent = "正在继续后台查询，请稍候...";
        resetProgressBar();
        showBackgroundBanner();

        const _queryStart = Date.now();
        const _querySnap  = getCurrentSettingsSnapshot();
        await _streamJob(job_id, statusData.events_count, packageNames || [], _queryStart, _querySnap);

        if (_bgBannerTimer) { clearTimeout(_bgBannerTimer); _bgBannerTimer = null; }
        hideBackgroundBanner();
        stopTipRotation();
        loadingEl.style.display = "none";
        btnQuery.disabled = false;
    }
}

// ========== 等待小贴士 ==========
// 注：老版本的大进度条 UI 已被工具栏内联进度条（_showInlineProgress）取代，
// 原来的 showProgressBar / updateProgressBar / resetProgressBar 三个函数已移除。

let _tipTimer = null;  // 小贴士轮播定时器

function startTipRotation() {
    // 先清掉已有定时器，避免多次调用导致双倍速轮播
    if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null; }
    const tipContainer = document.getElementById("tipContainer");
    const tipText = document.getElementById("tipText");
    if (!tipContainer || !tipText) return;
    tipContainer.style.display = "flex";
    // 如果已有文字（之前轮播中）就保留，否则随机取一条
    if (!tipText.textContent) tipText.textContent = getRandomTip();
    tipText.classList.remove("tip-fade");
    // 每 6 秒切换一条，带淡入淡出
    _tipTimer = setInterval(() => {
        tipText.classList.add("tip-fade");
        setTimeout(() => {
            tipText.textContent = getRandomTip();
            tipText.classList.remove("tip-fade");
        }, 400);
    }, 6000);
}

function stopTipRotation() {
    if (_tipTimer) { clearInterval(_tipTimer); _tipTimer = null; }
    const tipContainer = document.getElementById("tipContainer");
    if (tipContainer) tipContainer.style.display = "none";
}

// 结果工具栏小贴士：查询结束后把当前正在看的那条放到标题右侧
function showToolbarTip() {
    const el = document.getElementById("toolbarTip");
    if (!el) return;
    // 优先取加载时正在显示的那条
    const loadingTip = document.getElementById("tipText");
    const text = (loadingTip && loadingTip.textContent) || getRandomTip();
    el.textContent = text;
}

function nextToolbarTip() {
    const el = document.getElementById("toolbarTip");
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => {
        el.textContent = getRandomTip();
        el.style.opacity = "1";
    }, 250);
}

// ========== 查询入口 ==========

let currentResults = [];
let _bgBannerTimer  = null;  // 5s 后显示后台横幅的定时器
let _currentJobId   = null;  // 当前查询的 job_id，用于取消
let _sseReader      = null;  // 当前 SSE stream reader，取消时 cancel()
let _lastQueriedPackages = null;  // 最近一次查询的包名列表，取消时还回输入框，方便重新批量查询
const PENDING_JOB_KEY = "app_finder_pending_job";  // localStorage key

function doQuery() {
    const input = document.getElementById("packageInput").value.trim();
    if (!input) { showToast("请输入包名或App名称"); return; }
    const packageNames = input.split("\n").map(s => s.trim()).filter(s => s.length > 0);
    if (packageNames.length === 0) { showToast("请输入包名或App名称"); return; }

    const intervalMs = parseInt(document.getElementById("queryIntervalSlider")?.value || 0);

    const keepInInput = document.getElementById("keepInInput")?.checked || false;

    if (packageNames.length >= BATCH_WARN_THRESHOLD) {
        requestNotificationPermission();
        // 弹窗里选的 batchInterval 仅对本次批量查询生效，不持久化到设置
        showRiskWarning(packageNames.length, intervalMs,
            (batchInterval) => startQuery(packageNames, keepInInput, batchInterval));
    } else {
        startQuery(packageNames, keepInInput);
    }
}

function startQuery(packageNames, keepInput = false, batchIntervalMs = null) {
    if (keepInput) {
        document.getElementById("packageInput").value = packageNames.join("\n");
    } else {
        document.getElementById("packageInput").value = "";
    }
    executeQuery(packageNames, batchIntervalMs);
}

async function executeQuery(packageNames, batchIntervalOverride = null) {
    const loadingEl  = document.getElementById("loading");
    const resultEl   = document.getElementById("resultSection");
    const btnQuery   = document.getElementById("btnQuery");
    const loadingTxt = document.getElementById("loadingText");

    // 记下这次查询的包名，用于用户主动取消后还回输入框（见 cancelQuery）
    _lastQueriedPackages = packageNames.slice();

    loadingEl.style.display  = "flex";
    resultEl.style.display   = "none";
    btnQuery.disabled        = true;
    resetProgressBar();
    startTipRotation();
    hideBackgroundBanner();

    const n = packageNames.length;
    if (n > 1000)      loadingTxt.textContent = `共 ${n} 条，查询中请耐心等待（可能需要数十分钟）...`;
    else if (n > 100)  loadingTxt.textContent = `共 ${n} 条，查询中请稍候...`;
    else               loadingTxt.textContent = "正在查询中，请稍候...";

    // 批量弹窗里选的间隔优先于设置里的全局间隔
    const settingsIntervalMs = parseInt(document.getElementById("queryIntervalSlider")?.value || 0);
    const intervalMs = (batchIntervalOverride !== null && batchIntervalOverride !== undefined)
        ? batchIntervalOverride
        : settingsIntervalMs;
    const platformFilter = document.querySelector('input[name="platformFilter"]:checked')?.value || "all";
    const _queryStart    = Date.now();
    const _querySnap     = getCurrentSettingsSnapshot();

    const reqBody = {
        package_names:       packageNames,
        exact_search:        document.getElementById("exactSearch")?.checked || false,
        get_apk_url:         document.getElementById("getApkUrl")?.checked || false,
        apk_url_mode:        document.querySelector('input[name="apkUrlMode"]:checked')?.value || "single",
        get_sha1:            document.getElementById("getSha1")?.checked || false,
        get_sha256:          document.getElementById("getSha256")?.checked || false,
        query_interval_ms:   intervalMs,
        platform_filter:     platformFilter,
    };

    try {
        // 1. 创建后台 job
        const startResp = await fetch("/api/start_job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
        });
        if (!startResp.ok) { showToast("服务器错误: " + startResp.status); return; }

        const { job_id, estimated_seconds } = await startResp.json();

        // 保存 job_id 到 localStorage（用于页面关闭后恢复）
        localStorage.setItem(PENDING_JOB_KEY, JSON.stringify({ job_id, packageNames }));
        _currentJobId = job_id;

        // 查询开始后固定 5 秒提示"关闭页面不影响查询"
        if (_bgBannerTimer) clearTimeout(_bgBannerTimer);
        _bgBannerTimer = setTimeout(() => showBackgroundBanner(), 5000);

        // 2. 连接 SSE 流
        await _streamJob(job_id, 0, packageNames, _queryStart, _querySnap);

    } catch (err) {
        showToast("查询失败: " + err.message);
    } finally {
        if (_bgBannerTimer) { clearTimeout(_bgBannerTimer); _bgBannerTimer = null; }
        hideBackgroundBanner();
        stopTipRotation();
        loadingEl.style.display = "none";
        btnQuery.disabled       = false;
        _hideInlineProgress();
    }
}

async function _streamJob(job_id, offset, packageNames, queryStart, querySnap) {
    try {
        const response = await fetch(`/api/job_stream/${job_id}?offset=${offset}`);
        if (!response.ok) { showToast("连接失败: " + response.status); return; }

        const reader  = response.body.getReader();
        _sseReader    = reader;   // 暴露给 cancelQuery()
        const decoder = new TextDecoder();
        let buffer    = "";
        let lastOffset = offset;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        lastOffset++;
                        handleSSEEvent(data, packageNames, queryStart, querySnap);
                    } catch (_) {}
                }
            }
        }
    } catch (err) {
        // 断线：不弹错误，静默失败（后台仍在跑）
        console.warn("stream disconnected:", err.message);
    }
}

function handleSSEEvent(data, packageNames, queryStart, querySnap) {
    if (data.type === "start") {
        // 隐藏大 loading 区块，改用内联进度条
        _prepareResultSection(data.total);
    } else if (data.type === "progress") {
        _updateInlineProgress(data.done, data.total);
        // 动态追加本次返回的结果行
        if (data.rows && data.rows.length > 0) {
            _appendResultRows(data.rows);
            // 流式阶段就显示"重查"按钮：只要本批有 incomplete 行，操作列就要出现
            _updateIncompleteUI();
        }
    } else if (data.type === "session_reset") {
        // 服务端侦测到连续空返（一般是上游商店 cookie 中毒 / 限流），已自动
        // 重建 HTTP Session 并会在补齐阶段把之前空返的条目重查一次。用户无感。
        showToast("检测到连接异常，已自动重置，正在重新查询…");
    } else if (data.type === "retry_start") {
        // 服务端进入自动补齐阶段（对首轮不完整的包以翻倍超时再跑一次）
        _showRetryIndicator(data.retry_total);
    } else if (data.type === "retry_progress") {
        // 补齐阶段的增量更新：用新数据就地替换已存在的不完整行
        // 注意：重查阶段只做就地替换，不重排序——避免用户正在看的行突然跳位
        _updateRetryIndicator(data.retry_done, data.retry_total);
        if (data.rows && data.rows.length > 0) {
            _replaceResultRows(data.rows);
            _updateIncompleteUI();
        }
    } else if (data.type === "retry_done") {
        _hideRetryIndicator();
        // 服务端补齐全部完成：此时做一次排序，把不完整行统一沉底
        _reorderIncompleteToBottom();
        _updateIncompleteUI();
    } else if (data.type === "complete") {
        // 查询完成：清除 pending job
        localStorage.removeItem(PENDING_JOB_KEY);
        // 隐藏内联进度，显示工具栏按钮
        _hideInlineProgress();
        // 如果动态追加的行数与最终结果不一致（断线重连跳过了部分 progress），重新渲染
        if (currentResults.length !== data.results.length) {
            currentResults = data.results;
            renderResults(data.results);
        } else {
            // 合并服务端数据，但保留客户端已标记的 broken-icon 状态
            // （浏览器 img.onerror 检测到图标 URL 404 后设置了 incomplete + icon_url=""，
            //   服务端不知道这些，直接覆盖会丢失这些标记导致计数不准）
            const serverMap = new Map();
            data.results.forEach(r => serverMap.set(r.package_name + "|" + r.platform, r));
            currentResults.forEach(old => {
                const key = old.package_name + "|" + old.platform;
                const fresh = serverMap.get(key);
                if (fresh) {
                    // 记住客户端侧的 broken-icon 标记
                    const wasIconBroken = old.incomplete && !old.icon_url && old._brokenIconUrl;
                    const brokenUrl = old._brokenIconUrl;
                    Object.assign(old, fresh);
                    if (wasIconBroken) {
                        // 客户端已检测到该图标 URL 在浏览器加载失败
                        // 除非服务端给了一个全新的（不同的）icon_url，否则保持 broken 状态
                        const serverGaveNewIcon = fresh.icon_url && fresh.icon_url !== brokenUrl;
                        if (!serverGaveNewIcon) {
                            old.incomplete = true;
                            old.icon_url = "";
                            old._brokenIconUrl = brokenUrl;
                            old.missing_fields = old.missing_fields || [];
                            if (!old.missing_fields.includes("icon_url")) old.missing_fields.push("icon_url");
                        }
                    }
                }
            });
            _finalizeResultColumns(currentResults);
            _updateResultCount(currentResults.length);
        }
        // 查询完成后做一次排序：不完整行沉底
        _reorderIncompleteToBottom();
        _updateIncompleteUI();
        // 等所有图标 img 完成加载（成功或失败）后再刷新一次——避免 img.onerror 延迟触发
        // 比原来的 1s/3s/6s 三次兜底更准确：图片一旦全部 settled 就立刻刷新
        _waitIconsSettled().then(() => {
            _reorderIncompleteToBottom();
            _updateIncompleteUI();
        });
        showQueryInfo(data);
        saveToHistory(packageNames, data.results);
        sendNotification(data.results.length);
        recordQueryPerf(packageNames.length, Date.now() - queryStart, querySnap);
    } else if (data.type === "error") {
        showToast(data.message || "查询出错");
    }
}

/** 准备结果区域：隐藏大 loading，显示结果区 + 内联进度条 */
function _prepareResultSection(total) {
    // 隐藏大 loading 区块（spinner + 大进度条 + tips），不再占位
    const loadingEl = document.getElementById("loading");
    if (loadingEl) loadingEl.style.display = "none";

    const section = document.getElementById("resultSection");
    const body    = document.getElementById("resultBody");
    const count   = document.getElementById("resultCount");
    section.style.display = "block";
    body.innerHTML = "";
    count.textContent = "0";
    currentResults = [];
    _lastPkgForGroup = null;
    // 重置自动重查状态（新查询全部从零开始）
    _autoRetryState.queued.clear();
    _autoRetryState.retryCount = {};
    _autoRetryState.totalRounds = 0;
    if (_autoRetryState.timer) { clearTimeout(_autoRetryState.timer); _autoRetryState.timer = null; }
    _autoRetryState.inflight = false;
    // 新查询：重置"用户手动干预滚动"标记，恢复自动跟随最新行
    _userScrollIntervened = false;
    _ensureAutoFollowListeners();
    // 新查询：清空排序 / 筛选状态，避免上一次的视图状态错乱新结果
    _resultView.sortKeys = [];
    _resultView.filterPlatform = "all";
    // 先隐藏可选列，等有数据时再显示
    document.getElementById("thApkUrl").style.display  = "none";
    document.getElementById("thSha1").style.display    = "none";
    document.getElementById("thSha256").style.display  = "none";
    showToolbarTip();

    // 显示内联进度条，隐藏工具栏右侧按钮（搜索中不需要下载/复制）
    _showInlineProgress(total);

    requestAnimationFrame(updateToolbarHeight);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 显示内联进度条，并启动 toolbar 小贴士轮播 */
function _showInlineProgress(total) {
    const el = document.getElementById("inlineProgress");
    if (el) el.style.display = "flex";
    document.getElementById("inlineProgressFill").style.width = "0%";
    document.getElementById("inlineProgressText").textContent = `0 / ${total}`;
    // 搜索中隐藏下载/复制按钮
    const toolbarRight = document.querySelector(".toolbar-right");
    if (toolbarRight) toolbarRight.style.display = "none";
    // 启动 toolbar 小贴士轮播
    _startToolbarTipRotation();
}

/** 更新内联进度条 */
function _updateInlineProgress(done, total) {
    const pct = total > 0 ? (done / total * 100) : 0;
    document.getElementById("inlineProgressFill").style.width = pct.toFixed(1) + "%";
    document.getElementById("inlineProgressText").textContent = `${done} / ${total}`;
    // 同时更新旧的大进度条（供恢复路径使用）
    updateProgressBar(done, total);
}

/** 隐藏内联进度条，恢复工具栏按钮，停止轮播 */
function _hideInlineProgress() {
    const el = document.getElementById("inlineProgress");
    if (el) el.style.display = "none";
    const toolbarRight = document.querySelector(".toolbar-right");
    if (toolbarRight) toolbarRight.style.display = "flex";
    _stopToolbarTipRotation();
}

let _toolbarTipTimer = null;

/** toolbar 小贴士轮播（搜索中每6秒切换） */
function _startToolbarTipRotation() {
    _stopToolbarTipRotation();
    const el = document.getElementById("toolbarTip");
    if (!el) return;
    el.textContent = getRandomTip();
    _toolbarTipTimer = setInterval(() => {
        el.style.opacity = "0";
        setTimeout(() => {
            el.textContent = getRandomTip();
            el.style.opacity = "1";
        }, 300);
    }, 6000);
}

function _stopToolbarTipRotation() {
    if (_toolbarTipTimer) { clearInterval(_toolbarTipTimer); _toolbarTipTimer = null; }
}

let _lastPkgForGroup = null;  // 用于分组样式的上一个包名

/** 动态追加结果行到表格（不完整的插入到末尾，完整的插入到不完整行之前） */
// ── 可选列：APK 直链 / SHA1 / SHA256 按需显示 ──
// 单一来源的逻辑：先根据 rows 推断需要显示哪些列，再统一设置
const _OPT_COLS = [
    { th: "thApkUrl", tdSel: ".td-apk-url", has: r => r.apk_direct_urls && r.apk_direct_urls.length > 0 },
    { th: "thSha1",   tdSel: ".td-sha1",    has: r => !!r.sha1 },
    { th: "thSha256", tdSel: ".td-sha256",  has: r => !!r.sha256 },
];

/** 按 rows 全量重算可选列的显示状态（用于 renderResults 完整渲染）*/
function _setOptionalColumnsByData(rows) {
    const body = document.getElementById("resultBody");
    _OPT_COLS.forEach(c => {
        const want = rows.some(c.has);
        document.getElementById(c.th).style.display = want ? "" : "none";
        body.querySelectorAll(c.tdSel).forEach(td => td.style.display = want ? "" : "none");
    });
    return {
        hasApk:    document.getElementById("thApkUrl").style.display !== "none",
        hasSha1:   document.getElementById("thSha1").style.display !== "none",
        hasSha256: document.getElementById("thSha256").style.display !== "none",
    };
}

/** 流式追加：新 rows 可能引入原本没有的列（只从隐藏→显示，不反向）*/
function _extendOptionalColumns(newRows) {
    const body = document.getElementById("resultBody");
    const cur = {
        hasApk:    document.getElementById("thApkUrl").style.display !== "none",
        hasSha1:   document.getElementById("thSha1").style.display !== "none",
        hasSha256: document.getElementById("thSha256").style.display !== "none",
    };
    let needApk = cur.hasApk, needSha1 = cur.hasSha1, needSha256 = cur.hasSha256;
    newRows.forEach(r => {
        if (!needApk    && _OPT_COLS[0].has(r)) needApk = true;
        if (!needSha1   && _OPT_COLS[1].has(r)) needSha1 = true;
        if (!needSha256 && _OPT_COLS[2].has(r)) needSha256 = true;
    });
    if (needApk && !cur.hasApk) {
        document.getElementById("thApkUrl").style.display = "";
        body.querySelectorAll(".td-apk-url").forEach(td => td.style.display = "");
    }
    if (needSha1 && !cur.hasSha1) {
        document.getElementById("thSha1").style.display = "";
        body.querySelectorAll(".td-sha1").forEach(td => td.style.display = "");
    }
    if (needSha256 && !cur.hasSha256) {
        document.getElementById("thSha256").style.display = "";
        body.querySelectorAll(".td-sha256").forEach(td => td.style.display = "");
    }
    return { hasApk: needApk, hasSha1: needSha1, hasSha256: needSha256 };
}

function _appendResultRows(rows) {
    const body  = document.getElementById("resultBody");
    const count = document.getElementById("resultCount");
    const { hasApk: needApk, hasSha1: needSha1, hasSha256: needSha256 } = _extendOptionalColumns(rows);

    rows.forEach(r => {
        currentResults.push(r);
        const tr = _buildResultRow(r, needApk, needSha1, needSha256);
        // 每次都重新查询 DOM 中第一个不完整行（同一批内的完整行也要插到本批刚加入的不完整行之前）
        const firstIncomplete = body.querySelector(".incomplete-row");
        if (r.incomplete || !firstIncomplete) {
            body.appendChild(tr);
        } else {
            body.insertBefore(tr, firstIncomplete);
        }
    });

    _initResultTableHeaderUI();
    // 用户激活了排序 / 筛选时，新行也要按当前视图状态归位
    if (_resultView.sortKeys.length > 0 || _resultView.filterPlatform !== "all") {
        _applyResultView();
    } else {
        count.textContent = currentResults.length;
    }
    requestAnimationFrame(updateToolbarHeight);

    // 滚动到表格最末一「完整」可见行（仅在用户没手动干预时）。
    // 不完整行排在末尾，如果直接跟着最末行走，用户会以为所有结果都不行——
    // 所以优先找最后一个完整行；一条完整都还没有时才回退到最后一行占位。
    if (!_userScrollIntervened) {
        const visibleRows = Array.from(body.children).filter(tr => tr.style.display !== "none");
        let target = null;
        for (let i = visibleRows.length - 1; i >= 0; i--) {
            if (visibleRows[i].dataset.incomplete !== "1") { target = visibleRows[i]; break; }
        }
        if (!target) target = visibleRows[visibleRows.length - 1];
        if (target) {
            _programmaticScrollAt = Date.now();
            target.scrollIntoView({ behavior: "auto", block: "nearest" });
        }
    }
}

// ============================================================
// 查询过程中的"自动跟随最新行"控制
// ------------------------------------------------------------
// 默认：每来一批新结果，自动把视口滚到最新一行，方便用户看到进度。
// 但若用户主动滚动 / 翻页 / 按键等，就停止自动跟随，尊重当前阅读位置；
// 用户滚回接近底部时再恢复自动跟随。
// ============================================================
let _userScrollIntervened  = false;     // 用户是否在当前查询中手动干预过
let _programmaticScrollAt  = 0;         // 最近一次我们主动调用 scrollIntoView 的时间戳
let _autoFollowListenersOn = false;     // 事件监听器是否已挂载

function _ensureAutoFollowListeners() {
    if (_autoFollowListenersOn) return;
    _autoFollowListenersOn = true;

    const markUserScroll = () => { _userScrollIntervened = true; };

    // 直接来自用户的输入（程序化滚动不会触发这些）
    window.addEventListener("wheel",      markUserScroll, { passive: true });
    window.addEventListener("touchstart", markUserScroll, { passive: true });
    window.addEventListener("keydown", (e) => {
        // 只有可能导致滚动的按键才算用户干预
        const scrollKeys = ["ArrowUp","ArrowDown","PageUp","PageDown","Home","End","Space"," "];
        if (scrollKeys.includes(e.key)) markUserScroll();
    });

    // 滚动事件：用户滚回接近底部时，恢复自动跟随
    // 过滤掉我们自己 scrollIntoView 触发的 scroll（250ms 内忽略）
    window.addEventListener("scroll", () => {
        if (Date.now() - _programmaticScrollAt < 250) return;
        const nearBottom = (window.innerHeight + window.scrollY) >=
                           (document.documentElement.scrollHeight - 80);
        if (nearBottom) _userScrollIntervened = false;
    }, { passive: true });
}

/** 查询完成时，处理动态列的最终状态 */
function _finalizeResultColumns(allResults) {
    const hasApk    = allResults.some(r => r.apk_direct_urls && r.apk_direct_urls.length > 0);
    const hasSha1   = allResults.some(r => r.sha1);
    const hasSha256 = allResults.some(r => r.sha256);
    document.getElementById("thApkUrl").style.display  = hasApk   ? "" : "none";
    document.getElementById("thSha1").style.display    = hasSha1  ? "" : "none";
    document.getElementById("thSha256").style.display  = hasSha256 ? "" : "none";
    const body = document.getElementById("resultBody");
    body.querySelectorAll(".td-apk-url").forEach(td => td.style.display = hasApk ? "" : "none");
    body.querySelectorAll(".td-sha1").forEach(td => td.style.display = hasSha1 ? "" : "none");
    body.querySelectorAll(".td-sha256").forEach(td => td.style.display = hasSha256 ? "" : "none");
}

function _updateResultCount(n) {
    document.getElementById("resultCount").textContent = n;
}

/** 图标加载失败时把该行动态降级为 incomplete：加 incomplete 标记 + 名称左边的下载按钮去掉 + 操作列补上"重查"。
 *  这针对的是"server 返回了 icon_url 但浏览器加载失败"的场景——此时 server 没把行标 incomplete，
 *  只有浏览器知道图标其实坏了。 */
function _markRowIconBroken(r, tr) {
    if (!r) return;
    const wasIncomplete = r.incomplete;
    r.incomplete = true;
    r.missing_fields = r.missing_fields || [];
    if (!r.missing_fields.includes("icon_url")) r.missing_fields.push("icon_url");
    // 记住坏掉的 URL（用于 complete 合并时判断服务端是否给了新 URL）
    if (r.icon_url) r._brokenIconUrl = r.icon_url;
    // 该图标 URL 坏了，清掉以免后续又被当成"有 icon"
    r.icon_url = "";

    if (tr) {
        tr.classList.add("incomplete-row");
        // 操作列补上"重查"按钮（如果还没有）
        const tdAction = tr.querySelector(".td-action");
        if (tdAction && !tdAction.querySelector(".btn-retry")) {
            const retryBtn = document.createElement("button");
            retryBtn.className = "btn btn-small btn-retry";
            retryBtn.textContent = "重查";
            retryBtn.title = "缺少: 图标";
            retryBtn.onclick = () => _retryIncomplete([r.package_name]);
            tdAction.appendChild(retryBtn);
        }
        // 立即确保列头可见
        const thA = document.getElementById("thAction");
        if (thA && thA.style.display === "none") thA.style.display = "";
    }
    // 不重排序：用户正在看的行一跳就懵——保留原位，只更新计数/按钮可见性
    if (typeof _updateIncompleteUI === "function") _updateIncompleteUI();
    // 自动重查（防抖合并，见 _scheduleAutoRetryForBrokenIcon）
    _scheduleAutoRetryForBrokenIcon(r.package_name);
}

// —— 自动重查：图标加载失败时防抖合并后台静默重查 ——
// 限制：每个包名最多自动重查 2 次，总共最多 3 轮，避免无限循环
const _autoRetryState = {
    queued: new Set(),    // 等待重查的包名
    timer: null,
    inflight: false,
    retryCount: {},       // pkg → 已重试次数
    totalRounds: 0,
    MAX_PER_PKG: 2,       // 每个包名最多自动重查次数
    MAX_ROUNDS: 3,        // 总共最多几轮
};
function _scheduleAutoRetryForBrokenIcon(pkg) {
    if (!pkg) return;
    // 检查该包是否已达到自动重查上限
    const cnt = _autoRetryState.retryCount[pkg] || 0;
    if (cnt >= _autoRetryState.MAX_PER_PKG) return;
    // 检查总轮数上限
    if (_autoRetryState.totalRounds >= _autoRetryState.MAX_ROUNDS) return;
    _autoRetryState.queued.add(pkg);
    if (_autoRetryState.timer) return;
    _autoRetryState.timer = setTimeout(async () => {
        _autoRetryState.timer = null;
        if (_autoRetryState.inflight) return;
        // 过滤掉已达上限的包
        const pkgs = Array.from(_autoRetryState.queued).filter(p =>
            (_autoRetryState.retryCount[p] || 0) < _autoRetryState.MAX_PER_PKG
        );
        _autoRetryState.queued.clear();
        if (!pkgs.length) return;
        _autoRetryState.totalRounds++;
        pkgs.forEach(p => { _autoRetryState.retryCount[p] = (_autoRetryState.retryCount[p] || 0) + 1; });
        _autoRetryState.inflight = true;
        try {
            await fetch("/api/retry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ package_names: pkgs }),
            }).then(async resp => {
                if (!resp.ok) return;
                const { results: retryResults } = await resp.json();
                if (!retryResults || !retryResults.length) return;
                // 合并替换并重建行（不重排序，保持原位）
                const merged = retryResults.map(fresh => {
                    const old = currentResults.find(o =>
                        o.package_name === fresh.package_name && o.platform === fresh.platform
                    );
                    if (!old) return fresh;
                    const m = { ...old, ...fresh };
                    if (old.category && !fresh.category) m.category = old.category;
                    if (old.app_name && old.app_name !== "未找到" &&
                        (!fresh.app_name || fresh.app_name === "未找到")) {
                        m.app_name = old.app_name;
                    }
                    // 重算 incomplete
                    const missing = [];
                    if (!m.app_name || m.app_name === "未找到") missing.push("app_name");
                    if (!m.icon_url) missing.push("icon_url");
                    if (!m.category) missing.push("category");
                    if (!m.download_url) missing.push("download_url");
                    if (missing.length) { m.incomplete = true; m.missing_fields = missing; }
                    else { delete m.incomplete; delete m.missing_fields; }
                    return m;
                });
                _replaceResultRows(merged);
                _updateIncompleteUI();
            }).catch(() => {});
        } finally {
            _autoRetryState.inflight = false;
            // 如果期间又有新包名入队，再来一轮
            if (_autoRetryState.queued.size > 0 && !_autoRetryState.timer) {
                _autoRetryState.timer = setTimeout(() => {
                    _autoRetryState.timer = null;
                    _scheduleAutoRetryForBrokenIcon(""); // 重入以触发处理
                }, 600);
            }
        }
    }, 600);
}

/** 构建单行 TR 元素 */
/** 图标单元格：含 hover 下载浮层 + img.onerror 动态降级 */
function _buildIconCell(r, tr) {
    const tdIcon = document.createElement("td");
    if (r.icon_url) {
        const wrap = document.createElement("div");
        wrap.className = "icon-wrap";
        const img = document.createElement("img");
        img.className = "app-icon"; img.src = r.icon_url; img.alt = r.app_name;
        img.onerror = function () {
            this.style.display = "none";
            wrap.classList.add("icon-broken");
            const ph = document.createElement("div");
            ph.className = "icon-placeholder"; ph.textContent = "?";
            wrap.appendChild(ph);
            // 移除下载浮层（URL 坏了没法下载）
            const ov = wrap.querySelector(".icon-dl-overlay");
            if (ov) ov.remove();
            _markRowIconBroken(r, tr);
        };
        wrap.appendChild(img);
        // hover 下载浮层
        const overlay = document.createElement("div");
        overlay.className = "icon-dl-overlay";
        overlay.title = "下载图标";
        overlay.innerHTML = "&#x2B07;"; // ⬇
        overlay.onclick = (e) => { e.stopPropagation(); downloadSingleIcon(r); };
        wrap.appendChild(overlay);
        tdIcon.appendChild(wrap);
    } else {
        const ph = document.createElement("div");
        ph.className = "icon-placeholder"; ph.textContent = "?";
        tdIcon.appendChild(ph);
    }
    return tdIcon;
}

/** 一个"复制到剪贴板"按钮，带已复制反馈 */
function _buildCopyBtn(text, feedbackMsg) {
    const btn = document.createElement("button");
    btn.className = "copy-btn"; btn.textContent = "复制";
    btn.onclick = () => {
        _copyText(text).then(() => {
            btn.textContent = "已复制"; btn.classList.add("copied-btn");
            if (feedbackMsg) showToast(feedbackMsg);
            setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("copied-btn"); }, 1500);
        }).catch(() => showToast("复制失败，请手动长按选中复制"));
    };
    return btn;
}

/** SHA 单元格（SHA1/SHA256 通用）*/
function _buildShaCell(tdClass, shown, sha, label) {
    const td = document.createElement("td");
    td.className = tdClass;
    if (!shown) { td.style.display = "none"; return td; }
    if (sha) {
        const sp = document.createElement("span");
        sp.className = "sha-cell";
        sp.textContent = sha.slice(0, 11) + "…";
        sp.title = sha + "\n（点击复制完整值）";
        sp.onclick = () => { _copyText(sha).then(() => showToast(label + " 已复制")).catch(() => showToast("复制失败")); };
        td.appendChild(sp);
    }
    return td;
}

/** APK 直链单元格 */
function _buildApkCell(apkUrls, shown) {
    const tdApk = document.createElement("td");
    tdApk.className = "td-apk-url";
    tdApk.dataset.label = "APK";
    if (!shown) { tdApk.style.display = "none"; return tdApk; }
    if (apkUrls && apkUrls.length > 0) {
        apkUrls.forEach((url, i) => {
            const div = document.createElement("div");
            div.className = "url-cell";
            const a = document.createElement("a");
            a.href = url; a.textContent = `来源${i+1}`; a.target = "_blank";
            div.append(a, _buildCopyBtn(url, null));
            tdApk.appendChild(div);
        });
    }
    return tdApk;
}

function _buildResultRow(r, hasApk, hasSha1, hasSha256) {
    const tr = document.createElement("tr");
    if (_lastPkgForGroup === r.package_name) tr.className = "same-group";
    else if (_lastPkgForGroup !== null)      tr.className = "new-group";
    _lastPkgForGroup = r.package_name;

    // 不完整结果高亮
    if (r.incomplete) {
        tr.classList.add("incomplete-row");
    }

    // 排序 / 筛选所需的元数据
    tr.dataset.platform = r.platform || "";
    tr.dataset.category = r.category || "";
    tr.dataset.name     = r.app_name || "";
    tr.dataset.incomplete = r.incomplete ? "1" : "0";
    tr.dataset.resultIdx  = String(currentResults.indexOf(r));
    // 用于补齐阶段按 key 定位并就地替换
    tr.dataset.pkg  = r.package_name || "";
    tr.dataset.plat = r.platform || "";

    const tdIcon = _buildIconCell(r, tr);
    tdIcon.className = "td-icon";

    // App名称
    const tdName = document.createElement("td");
    tdName.className = "td-name";
    tdName.dataset.label = "应用名";
    if (r.app_name === "未找到") {
        tdName.innerHTML = '<span class="not-found">未找到</span>';
    } else {
        tdName.textContent = r.app_name;
        tdName.style.cursor = "pointer";
        tdName.onclick = () => copyCell(tdName, r.app_name);
    }

    // 包名
    const tdPkg = document.createElement("td");
    tdPkg.className = "pkg-cell td-pkg";
    tdPkg.dataset.label = "包名";
    tdPkg.textContent = r.package_name;
    tdPkg.style.cursor = "pointer";
    tdPkg.onclick = () => copyCell(tdPkg, r.package_name);

    // 平台
    const tdPlatform = document.createElement("td");
    tdPlatform.className = "td-platform";
    tdPlatform.dataset.label = "平台";
    const platformTag = document.createElement("span");
    platformTag.className = "platform-tag " + getPlatformClass(r.platform);
    platformTag.textContent = r.platform;
    tdPlatform.appendChild(platformTag);

    // 分类
    const tdCategory = document.createElement("td");
    tdCategory.className = "td-category";
    tdCategory.dataset.label = "分类";
    if (r.category) {
        const catSpan = document.createElement("span");
        catSpan.className = "category-text";
        catSpan.textContent = r.category;
        tdCategory.appendChild(catSpan);
        tdCategory.style.cursor = "pointer";
        tdCategory.title = "点击复制分类";
        tdCategory.onclick = () => copyCell(tdCategory, r.category);
    } else if (r.incomplete && r.missing_fields && r.missing_fields.includes("category")) {
        tdCategory.classList.add("missing-field");
    }

    // 商店地址
    const tdUrl = document.createElement("td");
    tdUrl.className = "td-url";
    tdUrl.dataset.label = "商店";
    const urlCell = document.createElement("div");
    urlCell.className = "url-cell";
    const link = document.createElement("a");
    link.href = r.download_url; link.textContent = r.download_url; link.target = "_blank";
    urlCell.append(link, _buildCopyBtn(r.download_url, "已复制链接"));
    if (r.source === "qimai_hint" || r.source === "search_engine_ref") {
        const hintTip = document.createElement("div");
        hintTip.style.cssText = "margin-top:4px;font-size:11px;color:#d46b08;";
        hintTip.textContent = r.source === "qimai_hint"
            ? "⚠ 各商店均未找到，点击链接前往七麦手动查询"
            : "⚠ 各商店均未找到，此链接由搜索引擎反查获得，仅供参考";
        urlCell.appendChild(hintTip);
    }
    tdUrl.appendChild(urlCell);

    const tdApk   = _buildApkCell(r.apk_direct_urls, hasApk);
    const tdSha1  = _buildShaCell("td-sha1", hasSha1, r.sha1, "SHA1");
    const tdSha256 = _buildShaCell("td-sha256", hasSha256, r.sha256, "SHA256");

    // 操作列（不完整时显示重查按钮）
    const tdAction = document.createElement("td");
    tdAction.className = "td-action";
    if (r.incomplete) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn btn-small btn-retry";
        retryBtn.textContent = "重查";
        retryBtn.title = "缺少: " + (r.missing_fields || []).map(f =>
            ({icon_url:"图标", category:"分类", app_name:"名称", download_url:"地址"}[f] || f)
        ).join("、");
        retryBtn.onclick = () => _retryIncomplete([r.package_name]);
        tdAction.appendChild(retryBtn);
        // 立即确保列头可见（避免 progress 推送还没触发 _updateIncompleteUI 时用户看不到按钮）
        const thA = document.getElementById("thAction");
        if (thA && thA.style.display === "none") thA.style.display = "";
    }

    tr.append(tdIcon, tdName, tdPkg, tdPlatform, tdCategory, tdUrl, tdApk, tdSha1, tdSha256, tdAction);
    return tr;
}

/** 把所有 .incomplete-row DOM 行和 currentResults 都排到末尾（完整行在上）。
 *  在 _replaceResultRows / retry_done 等"就地替换"后调用，确保"缺失信息的在最下面"。 */
function _reorderIncompleteToBottom() {
    const body = document.getElementById("resultBody");
    if (!body) return;
    // DOM 层：把每一条 incomplete-row 挪到末尾（按 currentResults 里的相对顺序保持稳定）
    const incompleteTrs = Array.from(body.querySelectorAll(".incomplete-row"));
    incompleteTrs.forEach(tr => body.appendChild(tr));
    // currentResults 层：保持稳定排序（Array.prototype.sort 在现代浏览器里是稳定的）
    currentResults.sort((a, b) => {
        const ai = a.incomplete ? 1 : 0;
        const bi = b.incomplete ? 1 : 0;
        return ai - bi;
    });
}

/** 更新操作列和批量重查按钮的可见性，同时把不完整数显示在按钮上 */
/** 等所有 .app-icon img 都完成加载（成功或失败）。
 *  用途：查询完成后等一小段时间让 broken img 的 onerror 全部触发，再统一刷新不完整计数。
 *  硬上限 8 秒——超时则按已有状态走，避免永远卡在等图上。 */
function _waitIconsSettled() {
    const imgs = Array.from(document.querySelectorAll("#resultBody img.app-icon"));
    if (imgs.length === 0) return Promise.resolve();
    const pending = imgs.filter(img => !img.complete);
    if (pending.length === 0) return Promise.resolve();
    const HARD_TIMEOUT = 8000;
    return new Promise(resolve => {
        let remaining = pending.length;
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        const onEach = () => { remaining--; if (remaining <= 0) done(); };
        pending.forEach(img => {
            img.addEventListener("load",  onEach, { once: true });
            img.addEventListener("error", onEach, { once: true });
        });
        setTimeout(done, HARD_TIMEOUT);
    });
}

function _updateIncompleteUI() {
    const incompleteCount = currentResults.filter(r => r.incomplete).length;
    const hasIncomplete = incompleteCount > 0;
    document.getElementById("thAction").style.display = hasIncomplete ? "" : "none";
    document.querySelectorAll(".td-action").forEach(td => {
        td.style.display = hasIncomplete ? "" : "none";
    });
    const retryAllBtn = document.getElementById("btnRetryAll");
    if (retryAllBtn) {
        retryAllBtn.style.display = hasIncomplete ? "" : "none";
        retryAllBtn.textContent = hasIncomplete
            ? `重查不完整 (${incompleteCount})`
            : "重查不完整";
    }
}

/** 显示 "补齐 X/Y" 指示（服务端自动补齐阶段） */
function _showRetryIndicator(total) {
    const el = document.getElementById("retryIndicator");
    if (!el) return;
    el.style.display = "";
    document.getElementById("retryIndicatorText").textContent = `0/${total}`;
}
function _updateRetryIndicator(done, total) {
    const el = document.getElementById("retryIndicatorText");
    if (el) el.textContent = `${done}/${total}`;
}
function _hideRetryIndicator() {
    const el = document.getElementById("retryIndicator");
    if (el) el.style.display = "none";
}

/** 用新结果就地替换已存在的行（按 package_name+platform 匹配）。
 *  若找不到匹配行，则追加（保守回退）。 */
function _replaceResultRows(rows) {
    if (!rows || !rows.length) return;
    const body = document.getElementById("resultBody");
    const toAppend = [];

    rows.forEach(fresh => {
        const key = fresh.package_name + "|" + fresh.platform;
        let replaced = false;
        for (let i = 0; i < currentResults.length; i++) {
            const old = currentResults[i];
            if ((old.package_name + "|" + old.platform) === key) {
                currentResults[i] = fresh;
                // 找到对应 DOM 行（按 dataset 标识）并就地重建
                const oldTr = body.querySelector(
                    `tr[data-pkg="${CSS.escape(fresh.package_name)}"][data-plat="${CSS.escape(fresh.platform)}"]`
                );
                if (oldTr) {
                    const hasApk    = document.getElementById("thApkUrl").style.display !== "none";
                    const hasSha1   = document.getElementById("thSha1").style.display !== "none";
                    const hasSha256 = document.getElementById("thSha256").style.display !== "none";
                    const newTr = _buildResultRow(fresh, hasApk, hasSha1, hasSha256);
                    oldTr.replaceWith(newTr);
                }
                replaced = true;
                break;
            }
        }
        if (!replaced) toAppend.push(fresh);
    });

    if (toAppend.length) _appendResultRows(toAppend);

    // 补齐可能让"不完整"数量下降，实时刷新批量重查按钮文案
    _updateIncompleteUI();
    _updateResultCount(currentResults.length);

    // 若「重查不完整」按钮正在显示活跃的计数，也同步更新
    const retryBtn = document.getElementById("btnRetryAll");
    if (retryBtn && retryBtn.disabled) {
        const remain = currentResults.filter(r => r.incomplete).length;
        retryBtn.textContent = remain > 0 ? `重查中… 剩 ${remain}` : "重查中…";
    }
}

/** 重查指定包名（不完整结果）— 并发调用 /api/retry 每包一次，
 *  收到结果即就地替换对应行，按钮上显示实时剩余数。 */
async function _retryIncomplete(packageNames) {
    if (!packageNames.length) return;

    // 禁用重查按钮并在上面显示进度
    const retryAllBtn = document.getElementById("btnRetryAll");
    document.querySelectorAll(".btn-retry").forEach(b => b.disabled = true);

    const total = packageNames.length;
    let done = 0;
    const updateBtnText = () => {
        if (retryAllBtn) {
            const remain = total - done;
            retryAllBtn.textContent = remain > 0
                ? `重查中… ${done}/${total}`
                : "重查完成";
        }
    };
    updateBtnText();

    const oneRetry = async (pkg) => {
        try {
            const resp = await fetch("/api/retry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ package_names: [pkg] }),
            });
            if (!resp.ok) return;
            const { results: retryResults } = await resp.json();
            if (!retryResults || !retryResults.length) return;

            // 就地合并替换对应行
            const merged = retryResults.map(fresh => {
                const old = currentResults.find(o =>
                    o.package_name === fresh.package_name && o.platform === fresh.platform
                );
                if (!old) return fresh;
                const m = { ...old, ...fresh };
                if (old.icon_url && !fresh.icon_url) m.icon_url = old.icon_url;
                if (old.category && !fresh.category) m.category = old.category;
                if (old.app_name && old.app_name !== "未找到" &&
                    (!fresh.app_name || fresh.app_name === "未找到")) {
                    m.app_name = old.app_name;
                }
                // 合并后如果仍缺字段，重新计算 incomplete 标记（保证重查按钮正确显隐）
                const missing = [];
                if (!m.app_name || m.app_name === "未找到") missing.push("app_name");
                if (!m.icon_url) missing.push("icon_url");
                if (!m.category) missing.push("category");
                if (!m.download_url) missing.push("download_url");
                if (missing.length > 0) {
                    m.incomplete = true;
                    m.missing_fields = missing;
                } else {
                    delete m.incomplete;
                    delete m.missing_fields;
                }
                return m;
            });
            _replaceResultRows(merged);
        } catch (err) {
            /* 单包失败不打扰用户，整体还会继续 */
        } finally {
            done += 1;
            updateBtnText();
        }
    };

    // 并发上限 6，避免一次性打太多
    const CONCURRENCY = 6;
    const queue = packageNames.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
        while (queue.length > 0) {
            const pkg = queue.shift();
            if (pkg) await oneRetry(pkg);
        }
    });
    try {
        await Promise.all(workers);
    } finally {
        document.querySelectorAll(".btn-retry").forEach(b => b.disabled = false);
        // 用户触发的重查：不重排序（保持当前视图稳定）
        _updateIncompleteUI();   // 刷新按钮文案（含最新剩余数）
        const stillIncomplete = currentResults.filter(r => r.incomplete).length;
        if (stillIncomplete === 0) {
            showToast("重查完成，所有结果已完整");
        } else {
            showToast(`重查完成，仍有 ${stillIncomplete} 条不完整`);
        }
    }
}

/** 重查所有不完整结果 */
function retryAllIncomplete() {
    const incompletePackages = [...new Set(
        currentResults.filter(r => r.incomplete).map(r => r.package_name)
    )];
    if (incompletePackages.length === 0) {
        showToast("没有不完整的结果");
        return;
    }
    _retryIncomplete(incompletePackages);
}

function showQueryInfo(data) {
    const infoEl = document.getElementById("queryInfo");
    const msgs = [];
    if (data.over_limit > 0) {
        msgs.push(`输入共 ${data.total_input} 条，超出单次上限 10000 条，已跳过后 ${data.over_limit} 条`);
    }
    if (data.invalid_count > 0) {
        msgs.push(`${data.invalid_count} 条格式无效（纯符号等）已自动跳过`);
    }
    if (data.deduplicated > 0) {
        msgs.push(`去除了 ${data.deduplicated} 个重复项`);
    }
    if (msgs.length > 0) {
        infoEl.textContent = msgs.join("；");
        infoEl.style.display = "block";
    } else {
        infoEl.style.display = "none";
    }
}

// ========== 工具栏高度计算 ==========

function updateToolbarHeight() {
    const toolbar = document.getElementById("resultToolbar");
    if (toolbar) {
        document.documentElement.style.setProperty("--toolbar-height", toolbar.offsetHeight + "px");
    }
}
// 用 ResizeObserver 自动追踪工具栏高度变化（按钮换行、进度条显隐等），避免 thead 和 toolbar 之间出现缝隙
if (typeof ResizeObserver !== "undefined") {
    const _toolbarRO = new ResizeObserver(() => updateToolbarHeight());
    document.addEventListener("DOMContentLoaded", () => {
        const tb = document.getElementById("resultToolbar");
        if (tb) _toolbarRO.observe(tb);
    });
}

// ========== 结果渲染 ==========

function renderResults(results, opts) {
    const section = document.getElementById("resultSection");
    const body    = document.getElementById("resultBody");
    const count   = document.getElementById("resultCount");
    const preserveScroll = !!(opts && opts.preserveScroll);

    section.style.display = "block";
    count.textContent = results.length;
    body.innerHTML = "";
    showToolbarTip();

    const { hasApk, hasSha1, hasSha256 } = _setOptionalColumnsByData(results);

    _lastPkgForGroup = null;
    results.forEach(r => {
        const tr = _buildResultRow(r, hasApk, hasSha1, hasSha256);
        body.appendChild(tr);
    });

    _initResultTableHeaderUI();
    _applyResultView();

    requestAnimationFrame(updateToolbarHeight);
    // 仅在"新查询"等场景滚到结果区顶部；重查等局部刷新不跳动
    if (!preserveScroll) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function getPlatformClass(platform) {
    if (platform === "Android") return "android";
    if (platform === "iOS")     return "ios";
    return "unknown";
}

// ========== 结果表头：排序 + 筛选 ==========

// 多列排序：sortKeys 是一个有序栈，最近点击的列在最前（主排序键），其余依次为次级 tie-break。
// 每列只有 asc / desc 两种状态，再次点击同一列只切换方向，不会移除该列。
const _resultView = {
    sortKeys: [],          // [{col: 'name', order: 'asc'|'desc'}, ...]，最前为主键
    filterPlatform: 'all', // 'all' | 'iOS' | 'Android' | 其他具体平台值
};
const _SORTABLE_COLS = ["thName", "thPlatform", "thCategory"];
const _MAX_SORT_KEYS = 3;  // 当前可排序列的总数

function _initResultTableHeaderUI() {
    const thPlatform = document.getElementById("thPlatform");
    if (!thPlatform || thPlatform.dataset.bound) return;

    _SORTABLE_COLS.forEach(id => {
        const th = document.getElementById(id);
        if (!th) return;
        // 排序指示器 ▲1 / ▼2 / ⇅
        const ind = document.createElement("span");
        ind.className = "sort-indicator";
        ind.textContent = "⇅";
        th.appendChild(ind);
        // 提升优先级按钮（仅该列在排序里且不是主键时显示）
        const upBtn = document.createElement("button");
        upBtn.className = "sort-move-up";
        upBtn.textContent = "↑";
        upBtn.title = "提升排序优先级";
        upBtn.style.display = "none";
        upBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            _promoteSort(th.dataset.col);
        });
        th.appendChild(upBtn);
        // 移除按钮（仅该列在排序里时显示）
        const rmBtn = document.createElement("button");
        rmBtn.className = "sort-remove";
        rmBtn.textContent = "×";
        rmBtn.title = "从排序中移除该列";
        rmBtn.style.display = "none";
        rmBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            _removeSort(th.dataset.col);
        });
        th.appendChild(rmBtn);

        th.addEventListener("click", (e) => {
            // 点筛选 / 排序控件时不触发整体排序
            if (e.target.closest(".th-filter-btn") || e.target.closest(".th-filter-menu")) return;
            if (e.target.closest(".sort-move-up") || e.target.closest(".sort-remove")) return;
            _toggleSort(th.dataset.col);
        });
    });

    // 筛选按钮（仅平台列）
    const filterBtn = document.createElement("button");
    filterBtn.className = "th-filter-btn";
    filterBtn.textContent = "▾";
    filterBtn.title = "筛选平台";
    filterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        _togglePlatformFilterMenu(thPlatform, filterBtn);
    });
    thPlatform.appendChild(filterBtn);

    thPlatform.dataset.bound = "1";
}

function _toggleSort(col) {
    const existing = _resultView.sortKeys.find(k => k.col === col);
    if (existing) {
        // 已在排序栈里 → 仅切换方向（位置不变，保持原优先级）
        existing.order = existing.order === "asc" ? "desc" : "asc";
    } else {
        // 新列 → 追加到末尾作为最低优先级（additive，不抢占已有主键）
        _resultView.sortKeys.push({ col, order: "asc" });
        if (_resultView.sortKeys.length > _MAX_SORT_KEYS) {
            _resultView.sortKeys.shift();  // 超过上限时丢弃最早加入的一列
        }
    }
    _applyResultView();
}

/** 将某列在排序队列里向前移一位（提升优先级） */
function _promoteSort(col) {
    const idx = _resultView.sortKeys.findIndex(k => k.col === col);
    if (idx <= 0) return;  // 没找到 或 已经是主键
    const prev = _resultView.sortKeys[idx - 1];
    _resultView.sortKeys[idx - 1] = _resultView.sortKeys[idx];
    _resultView.sortKeys[idx] = prev;
    _applyResultView();
}

/** 从排序队列里移除某列 */
function _removeSort(col) {
    const idx = _resultView.sortKeys.findIndex(k => k.col === col);
    if (idx < 0) return;
    _resultView.sortKeys.splice(idx, 1);
    _applyResultView();
}

function _togglePlatformFilterMenu(th, btn) {
    let menu = document.getElementById("__platformFilterMenu");
    if (menu) { menu.remove(); return; }

    // 动态从 currentResults 收集平台值，保证未来扩展（如 Web、HarmonyOS）也能覆盖
    const platforms = new Set();
    currentResults.forEach(r => { if (r.platform) platforms.add(r.platform); });
    const opts = [["all", "全部"]];
    ["iOS", "Android"].forEach(p => { if (platforms.has(p)) opts.push([p, p]); platforms.delete(p); });
    Array.from(platforms).sort().forEach(p => opts.push([p, p]));

    menu = document.createElement("div");
    menu.id = "__platformFilterMenu";
    menu.className = "th-filter-menu";
    opts.forEach(([val, label]) => {
        const item = document.createElement("div");
        item.className = "th-filter-item";
        if (_resultView.filterPlatform === val) item.classList.add("checked");
        item.textContent = (_resultView.filterPlatform === val ? "✓ " : "  ") + label;
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            _resultView.filterPlatform = val;
            menu.remove();
            btn.classList.toggle("active", val !== "all");
            _applyResultView();
        });
        menu.appendChild(item);
    });
    document.body.appendChild(menu);
    // 用按钮的 viewport 位置来放置 fixed 菜单
    const r = btn.getBoundingClientRect();
    menu.style.top  = (r.bottom + 4) + "px";
    menu.style.left = r.left + "px";

    // 点外面关闭
    setTimeout(() => {
        const closer = (ev) => {
            if (!menu.contains(ev.target) && ev.target !== btn) {
                menu.remove();
                document.removeEventListener("click", closer);
            }
        };
        document.addEventListener("click", closer);
    }, 0);
}

function _updateSortIndicators() {
    _SORTABLE_COLS.forEach(id => {
        const th = document.getElementById(id);
        if (!th) return;
        const ind   = th.querySelector(".sort-indicator");
        const upBtn = th.querySelector(".sort-move-up");
        const rmBtn = th.querySelector(".sort-remove");
        th.classList.remove("sort-asc", "sort-desc");
        const col = th.dataset.col;
        const idx = _resultView.sortKeys.findIndex(k => k.col === col);
        if (idx >= 0) {
            const k = _resultView.sortKeys[idx];
            th.classList.add(k.order === "asc" ? "sort-asc" : "sort-desc");
            if (ind) {
                const arrow = k.order === "asc" ? "▲" : "▼";
                // 多列排序时显示优先级数字（1=主键），单列时不显示
                ind.textContent = _resultView.sortKeys.length > 1 ? arrow + (idx + 1) : arrow;
            }
            if (upBtn) upBtn.style.display = idx > 0 ? "" : "none"; // 主键不可再提升
            if (rmBtn) rmBtn.style.display = "";
        } else {
            if (ind)   ind.textContent = "⇅";
            if (upBtn) upBtn.style.display = "none";
            if (rmBtn) rmBtn.style.display = "none";
        }
    });
    const fb = document.querySelector("#thPlatform .th-filter-btn");
    if (fb) fb.classList.toggle("active", _resultView.filterPlatform !== "all");
}

function _applyResultView() {
    const body = document.getElementById("resultBody");
    if (!body) return;

    // 多列排序：依次按 sortKeys 比较，前一个相等才看下一个
    if (_resultView.sortKeys.length > 0) {
        const rows = Array.from(body.children);
        rows.sort((a, b) => {
            for (const k of _resultView.sortKeys) {
                const av = a.dataset[k.col] || "";
                const bv = b.dataset[k.col] || "";
                // 空值始终沉底（与方向无关）
                if (!av && bv) return 1;
                if (av && !bv) return -1;
                const cmp = av.localeCompare(bv, "zh-Hans-CN");
                if (cmp !== 0) return cmp * (k.order === "asc" ? 1 : -1);
            }
            return 0;
        });
        rows.forEach(tr => body.appendChild(tr));
    }

    // 筛选
    const filt = _resultView.filterPlatform;
    let visible = 0;
    body.querySelectorAll("tr").forEach(tr => {
        const show = (filt === "all") || (tr.dataset.platform === filt);
        tr.style.display = show ? "" : "none";
        if (show) visible++;
    });

    // 计数：筛选时显示 当前/总数
    const countEl = document.getElementById("resultCount");
    if (countEl) {
        if (filt !== "all" && visible !== currentResults.length) {
            countEl.textContent = visible + " / " + currentResults.length;
        } else {
            countEl.textContent = currentResults.length;
        }
    }

    _updateSortIndicators();
}

/** 返回当前可见且按视图排序后的结果数组（用于复制 / 下载） */
function _getVisibleSortedResults() {
    const body = document.getElementById("resultBody");
    if (!body) return currentResults.slice();
    const out = [];
    Array.from(body.children).forEach(tr => {
        if (tr.style.display === "none") return;
        const idx = parseInt(tr.dataset.resultIdx);
        if (!isNaN(idx) && currentResults[idx]) out.push(currentResults[idx]);
    });
    return out.length ? out : currentResults.slice();
}

// ========== 复制功能 ==========

function copyCell(td, text) {
    _copyText(text).then(() => {
        td.classList.add("copied");
        setTimeout(() => td.classList.remove("copied"), 400);
        const shown = text.length > 40 ? text.slice(0, 40) + "..." : text;
        showToast("已复制：" + shown);
    }).catch(() => showToast("复制失败，请手动选中复制"));
}

function copyAllResults() {
    // 跟随用户当前看到的视图（筛选 + 排序）
    const view = _getVisibleSortedResults();
    if (view.length === 0) { showToast("没有可复制的结果"); return; }
    const hasApk   = view.some(r => r.apk_direct_urls && r.apk_direct_urls.length > 0);
    const hasSha1  = view.some(r => r.sha1);
    const hasSha256 = view.some(r => r.sha256);
    let header = "App名称\t包名\t平台\t分类\t商店地址";
    if (hasApk)   header += "\t下载地址";
    if (hasSha1)  header += "\tSHA1";
    if (hasSha256) header += "\tSHA256";
    const rows = view.map(r => {
        let line = `${r.app_name}\t${r.package_name}\t${r.platform}\t${r.category || ""}\t${r.download_url}`;
        if (hasApk)   line += "\t" + (r.apk_direct_urls ? r.apk_direct_urls.join(" | ") : "");
        if (hasSha1)  line += "\t" + (r.sha1 || "");
        if (hasSha256) line += "\t" + (r.sha256 || "");
        return line;
    });
    _copyText([header, ...rows].join("\n")).then(() => {
        showToast("已复制全部结果，可直接粘贴到Excel");
    }).catch(() => showToast("复制失败"));
}

// ========== 下载功能 ==========

function downloadResults(format) {
    // 跟随用户当前看到的视图（筛选 + 排序）
    const view = _getVisibleSortedResults();
    if (view.length === 0) { showToast("没有可下载的结果"); return; }
    const includeIcon = document.getElementById("includeIcon").checked;
    const includeIconImage = document.getElementById("includeIconImage").checked;
    fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: view, format, include_icon: includeIcon, include_icon_image: includeIconImage }),
    })
        .then(resp => resp.blob())
        .then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `app_results.${format}`; a.click();
            URL.revokeObjectURL(url);
            showToast(`${format.toUpperCase()} 文件已下载`);
        })
        .catch(err => showToast("下载失败: " + err.message));
}

// ========== 图标下载 ==========

/** 触发一次浏览器下载（给定 URL 和文件名） */
function _triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} }, 100);
}

/** 下载单个图标（直接走 /api/icon，服务器返回带正确文件名的附件） */
function downloadSingleIcon(r) {
    if (!r || !r.icon_url) { showToast("该行没有图标"); return; }
    const params = new URLSearchParams({
        url: r.icon_url,
        name: r.app_name || "icon",
        platform: r.platform || "",
    });
    const url = "/api/icon?" + params.toString();
    _triggerDownload(url, "");
    showToast("开始下载图标…");
}

/** 下载当前视图里所有有图标的行：≤5 直接逐个下载，>5 打包 zip */
function downloadAllIcons() {
    const view = _getVisibleSortedResults();
    const items = view.filter(r => r && r.icon_url).map(r => ({
        url: r.icon_url,
        app_name: r.app_name || "icon",
        platform: r.platform || "",
    }));
    if (items.length === 0) { showToast("没有可下载的图标"); return; }

    if (items.length <= 5) {
        showToast(`正在下载 ${items.length} 个图标…`);
        items.forEach((it, i) => {
            setTimeout(() => {
                const params = new URLSearchParams({
                    url: it.url, name: it.app_name, platform: it.platform,
                });
                _triggerDownload("/api/icon?" + params.toString(), "");
            }, i * 250);
        });
        return;
    }

    // >5 个：请求 zip
    showToast(`正在打包 ${items.length} 个图标…`);
    fetch("/api/icons_zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
    })
        .then(async resp => {
            if (!resp.ok) {
                let msg = "打包失败";
                try { const j = await resp.json(); if (j && j.message) msg += ": " + j.message; } catch {}
                throw new Error(msg);
            }
            const count = resp.headers.get("X-Icons-Count") || items.length;
            const blob = await resp.blob();
            return { blob, count };
        })
        .then(({ blob, count }) => {
            const url = URL.createObjectURL(blob);
            const d = new Date();
            const ymd = d.getFullYear().toString()
                + String(d.getMonth() + 1).padStart(2, "0")
                + String(d.getDate()).padStart(2, "0");
            _triggerDownload(url, `icons-${ymd}-${count}.zip`);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showToast(`已下载 ${count} 个图标（zip）`);
        })
        .catch(err => showToast(err.message || "打包失败"));
}

// ========== Toast ==========

function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ========== 回到顶部 ==========

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("scroll", () => {
    const btn = document.getElementById("backToTop");
    btn.classList.toggle("visible", window.scrollY > 300);

    const toolbar = document.getElementById("resultToolbar");
    const section = document.getElementById("resultSection");
    if (section && section.style.display !== "none" && toolbar) {
        toolbar.classList.toggle("stuck", section.getBoundingClientRect().top <= 0);
    }
});

window.addEventListener("resize", updateToolbarHeight);

// ========== 清空输入 ==========

function clearInput() {
    document.getElementById("packageInput").value = "";
    document.getElementById("packageInput").focus();
}

/** 从剪贴板读取内容，追加到输入框。
 *  - 安全上下文（HTTPS / 127.0.0.1）：直接读剪贴板
 *  - 非安全上下文：按钮已在启动时被 CSS 隐藏，这里兜底聚焦输入框让用户原生粘贴 */
async function pasteFromClipboard() {
    const text = await _readClipboard();
    if (text === null) {
        const qta = document.getElementById("packageInput");
        qta.focus();
        showToast("请在输入框内长按或按 Ctrl+V 粘贴");
        return;
    }
    if (!text) { showToast("剪贴板是空的"); return; }
    const qta = document.getElementById("packageInput");
    const clean = text.trim();
    if (!qta.value.trim()) qta.value = clean;
    else qta.value = qta.value.replace(/\s+$/, "") + "\n" + clean;
    qta.focus();
    qta.setSelectionRange(qta.value.length, qta.value.length);
    showToast("已粘贴");
}

// ========== iOS 平台过滤：禁用安卓扩展选项 ==========

function updateAndroidExtensionsState() {
    const platformFilter = document.querySelector('input[name="platformFilter"]:checked')?.value || "all";
    const row = document.querySelector(".extend-options-row");
    if (!row) return;
    const inputs = row.querySelectorAll("input");
    if (platformFilter === "ios") {
        row.classList.add("disabled-section");
        inputs.forEach(el => { el.disabled = true; });
    } else {
        row.classList.remove("disabled-section");
        inputs.forEach(el => { el.disabled = false; });
    }
}

// ========== 剪贴板兼容层 ==========
// 现代 navigator.clipboard API 只在"安全上下文"（HTTPS / 127.0.0.1 / localhost）可用。
// LAN 访问（http://192.168.x.x）不是安全上下文，该 API 被浏览器直接禁用。
// 所以这里用 execCommand('copy') 做旧版兜底，两种环境都能正常复制。
function _copyText(text) {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "0";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            if (ok) resolve();
            else reject(new Error("execCommand copy failed"));
        } catch (e) { reject(e); }
    });
}

// 读剪贴板没有可靠的旧版 API 兜底——非安全上下文下返回 null，调用方应优雅降级。
async function _readClipboard() {
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
        try { return await navigator.clipboard.readText(); }
        catch (e) { return null; }
    }
    return null;
}

// 是否支持读剪贴板（粘贴按钮可见性判断用）
function _clipboardReadSupported() {
    return !!(navigator.clipboard && window.isSecureContext && navigator.clipboard.readText);
}


// ========== 启动时探测客户端权限 ==========
// LAN 访客（非本机访问者）看不到管理员专属入口：📱 LAN 按钮、开机自启、关闭服务
// 在 <body> 上加 .is-lan-guest 类，由 CSS 触发隐藏
(function _detectClientRole() {
    // 默认先按"非管理员"处理——避免按钮在探测前闪一下又消失
    document.documentElement.classList.add("pending-role");
    fetch("/api/lan_info").then(r => r.json()).then(d => {
        const isAdmin = !!d.is_admin;
        document.body.classList.toggle("is-lan-guest", !isAdmin);
        document.documentElement.classList.remove("pending-role");
    }).catch(() => {
        document.documentElement.classList.remove("pending-role");
    });
})();

// 页面加载 → 按当前模式（本地/共享）加载历史记录
document.addEventListener("DOMContentLoaded", () => {
    _loadHistoryByMode();
    // 剪贴板读权限检测：非安全上下文（LAN HTTP）隐藏"粘贴"按钮，
    // 避免按钮存在却做不到、降级到没用的弹窗里
    if (!_clipboardReadSupported()) {
        document.body.classList.add("no-clipboard-read");
    }
});


// ========== APK URL checkbox 联动 ==========

document.addEventListener("DOMContentLoaded", () => {
    const cb = document.getElementById("getApkUrl");
    const modeRow = document.getElementById("apkUrlModeRow");
    if (cb && modeRow) {
        cb.addEventListener("change", () => {
            modeRow.style.display = cb.checked ? "flex" : "none";
            requestAnimationFrame(syncHistColHeight);
            saveSettings();
        });
    }

    // Save settings on any change
    ["exactSearch", "getSha1", "getSha256"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", saveSettings);
    });
    document.querySelectorAll('input[name="apkUrlMode"]').forEach(el => {
        el.addEventListener("change", saveSettings);
    });
    document.querySelectorAll('input[name="platformFilter"]').forEach(el => {
        el.addEventListener("change", () => {
            updateAndroidExtensionsState();
            saveSettings();
        });
    });
    document.getElementById("keepInInput")?.addEventListener("change", saveSettings);
    document.getElementById("queryIntervalSlider")?.addEventListener("change", saveSettings);
});

// ========== 初始化 ==========

renderHistory();
initColResizer();

// 同步左右栏高度：等 DOM 渲染完再执行，之后监听窗口缩放 + search-col 尺寸变化
requestAnimationFrame(() => {
    syncHistColHeight();
    window.addEventListener("resize", syncHistColHeight);

    // 监听 search-col 的任何尺寸变化（结果加载、设置展开、进度条显隐等），
    // 否则 hist-col 会保留旧高度，底部出现空白。
    const searchCol = document.querySelector(".search-col");
    if (searchCol && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => syncHistColHeight());
        ro.observe(searchCol);
    }
});

// 从 localStorage 恢复设置
const PRESETS_KEY = "app_finder_presets";
const PERF_KEY    = "app_finder_perf";
const savedSettings = loadSettings();
applySettings(savedSettings);
updateAndroidExtensionsState();
renderPresetSelect();

document.getElementById("packageInput").addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doQuery();
});

// 检查是否有未读的后台查询结果
checkPendingJob();

// ========== 常用设置（Presets）==========

function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; }
}

function savePresetsData(presets) {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function renderPresetSelect() {
    const sel = document.getElementById("presetSelect");
    if (!sel) return;
    const presets = getPresets();
    sel.innerHTML = '<option value="">— 常用设置 —</option>';
    presets.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function applyPreset(idx) {
    if (idx === "") return;
    const presets = getPresets();
    const preset = presets[parseInt(idx)];
    if (!preset) return;
    applySettings(preset.settings);
    updateAndroidExtensionsState();
    saveSettings();
    // 保持下拉框显示当前生效的预设名称，让用户知道哪个在用
    document.getElementById("presetSelect").value = idx;
    showToast("已应用：" + preset.name);
}

function openSavePreset() {
    const overlay = document.getElementById("savePresetOverlay");
    overlay.style.display = "flex";
    const input = document.getElementById("presetNameInput");
    input.value = "";
    setTimeout(() => input.focus(), 80);
}

function closeSavePreset() {
    document.getElementById("savePresetOverlay").style.display = "none";
}

function closeSavePresetIfBg(e) {
    if (e.target === document.getElementById("savePresetOverlay")) closeSavePreset();
}

function getCurrentSettingsSnapshot() {
    return {
        exactSearch: document.getElementById("exactSearch")?.checked || false,
        getApkUrl: document.getElementById("getApkUrl")?.checked || false,
        apkUrlMode: document.querySelector('input[name="apkUrlMode"]:checked')?.value || "single",
        getSha1: document.getElementById("getSha1")?.checked || false,
        getSha256: document.getElementById("getSha256")?.checked || false,
        queryIntervalMs: parseInt(document.getElementById("queryIntervalSlider")?.value || 0),
        platformFilter: document.querySelector('input[name="platformFilter"]:checked')?.value || "all",
        keepInInput: document.getElementById("keepInInput")?.checked || false,
    };
}

function doSavePreset() {
    const name = document.getElementById("presetNameInput").value.trim();
    if (!name) { showToast("请输入配置名称"); return; }
    const snap = getCurrentSettingsSnapshot();
    const presets = getPresets().filter(p => p.name !== name);
    presets.unshift({ name, settings: snap });
    savePresetsData(presets);
    renderPresetSelect();
    // 保存后下拉框直接显示刚保存的名称（新增的预设排在第一位，index=0）
    document.getElementById("presetSelect").value = "0";
    closeSavePreset();
    showToast("已保存：" + name);
}

function saveAsSystemRecommend(settings) {
    const presets = getPresets().filter(p => p.name !== "系统推荐");
    presets.unshift({ name: "系统推荐", settings });
    savePresetsData(presets);
    renderPresetSelect();
}

// ========== 全局键盘快捷键（ESC关闭 / Enter确认） ==========

document.addEventListener("keydown", (e) => {
    // 保存预设弹窗：Enter 保存 / ESC 关闭
    const savePresetOverlay = document.getElementById("savePresetOverlay");
    if (savePresetOverlay && savePresetOverlay.style.display !== "none") {
        if (e.key === "Enter") { e.preventDefault(); doSavePreset(); return; }
        if (e.key === "Escape") { e.preventDefault(); closeSavePreset(); return; }
    }

    // 关闭服务确认弹窗：Enter 确认 / ESC 取消
    const shutdownOverlay = document.getElementById("shutdownOverlay");
    if (shutdownOverlay && shutdownOverlay.style.display !== "none") {
        if (e.key === "Enter") { e.preventDefault(); doShutdown(); return; }
        if (e.key === "Escape") { e.preventDefault(); shutdownOverlay.style.display = "none"; return; }
    }

    // 设置面板：ESC 关闭
    const settingsOverlay = document.getElementById("settingsOverlay");
    if (settingsOverlay && settingsOverlay.classList.contains("open")) {
        if (e.key === "Escape") { e.preventDefault(); closeSettings(); return; }
    }

    // 查询进行中：ESC 取消查询
    if (e.key === "Escape" && (_sseReader || _currentJobId)) {
        e.preventDefault();
        cancelQuery();
        return;
    }
});

// ========== 性能统计（Perf Stats）==========

const PERF_MAX = 20;

let _perfWarningDismissed = false;

function getPerfData() {
    try { return JSON.parse(localStorage.getItem(PERF_KEY)) || []; } catch { return []; }
}

function recordQueryPerf(appCount, durationMs, settings) {
    if (appCount <= 0 || durationMs <= 0) return;
    const msPerApp = durationMs / appCount;
    const data = getPerfData();
    data.unshift({ msPerApp, appCount, durationMs, settings, time: Date.now() });
    const trimmed = data.slice(0, PERF_MAX);
    localStorage.setItem(PERF_KEY, JSON.stringify(trimmed));
    // Check warning only when baseline is full (20 records = 21st query onwards)
    if (trimmed.length >= PERF_MAX) {
        checkPerfWarning(trimmed);
    }
}

function checkPerfWarning(data) {
    if (_perfWarningDismissed) return;
    // Check user's persistent "不再提醒" preference from settings
    const settings = loadSettings();
    if (settings.showPerfWarning === false) return;
    const allAvg = data.reduce((s, d) => s + d.msPerApp, 0) / data.length;
    const last5 = data.slice(0, 5);
    const last5Avg = last5.reduce((s, d) => s + d.msPerApp, 0) / last5.length;
    if (last5Avg > allAvg * 1.5) {
        const recommendedSettings = buildRecommendedConfig(data);
        showPerfWarning(allAvg, last5Avg, recommendedSettings);
    } else {
        document.getElementById("perfWarning").style.display = "none";
    }
}

function buildRecommendedConfig(data) {
    // Pick the settings from the fastest query
    const sorted = [...data].sort((a, b) => a.msPerApp - b.msPerApp);
    return sorted[0].settings;
}

function showPerfWarning(allAvg, last5Avg, recommendedSettings) {
    const banner = document.getElementById("perfWarning");
    const textEl = document.getElementById("perfWarningText");
    const slowerPct = Math.round((last5Avg / allAvg - 1) * 100);
    const last5s = (last5Avg / 1000).toFixed(1);
    const avgS = (allAvg / 1000).toFixed(1);
    textEl.textContent = `最近 5 次查询平均每个 App 耗时 ${last5s}s，比历史均值（${avgS}s）慢了 ${slowerPct}%`;
    banner.style.display = "flex";
    banner._recommendedSettings = recommendedSettings;
}

function applyRecommendedConfig() {
    const banner = document.getElementById("perfWarning");
    const settings = banner._recommendedSettings;
    if (!settings) return;
    applySettings(settings);
    updateAndroidExtensionsState();
    saveSettings();
    saveAsSystemRecommend(settings);
    dismissPerfWarning();
    showToast("已应用系统推荐配置，已保存为「系统推荐」");
}

function dismissPerfWarning() {
    _perfWarningDismissed = true;
    document.getElementById("perfWarning").style.display = "none";
}

function cancelQuery() {
    // 1. 停止读取 SSE 流
    if (_sseReader) {
        try { _sseReader.cancel(); } catch (_) {}
        _sseReader = null;
    }
    // 2. 通知服务端取消 job（让服务端停止继续处理）
    if (_currentJobId) {
        fetch(`/api/cancel_job/${_currentJobId}`, { method: "POST" }).catch(() => {});
        _currentJobId = null;
    }
    // 3. 清除 localStorage 中的 pending job
    localStorage.removeItem(PENDING_JOB_KEY);
    // 4. 恢复 UI 状态——彻底清理：不依赖 doQuery 的 finally 跑到
    if (_bgBannerTimer) { clearTimeout(_bgBannerTimer); _bgBannerTimer = null; }
    hideBackgroundBanner();
    resetProgressBar();
    _hideInlineProgress();          // 隐藏工具栏内联进度条 + 恢复下载/复制按钮
    try { stopTipRotation(); } catch (_) {}  // 停止 loading 区的 tips 轮播
    document.getElementById("loading").style.display       = "none";
    document.getElementById("btnQuery").disabled           = false;

    // 5. 关键：取消时"重查不完整"按钮要能用
    //    原本 _updateIncompleteUI() 只在 "complete" 事件里调用；用户中途取消时，
    //    表格里已经有部分不完整行（没 icon / 没 download_url 的），但按钮一直藏着，
    //    用户就找不到批量重查入口。这里手动触发一次，让按钮按实际不完整行显示。
    const hasPartialResults = Array.isArray(currentResults) && currentResults.length > 0;
    if (hasPartialResults) {
        _updateResultCount(currentResults.length);
        _updateIncompleteUI();
    }

    // 6. 若取消时还没有任何结果（早期取消），把刚才的包名还回输入框，
    //    方便用户编辑后重新发起批量查询。已有部分结果时不覆盖，避免用户把工作区搞丢。
    const inputEl = document.getElementById("packageInput");
    if (!hasPartialResults
        && inputEl && !inputEl.value.trim()
        && _lastQueriedPackages && _lastQueriedPackages.length) {
        inputEl.value = _lastQueriedPackages.join("\n");
    }

    // 7. Toast 提示：结果留着，不完整的可以点"重查不完整"
    if (hasPartialResults) {
        const incompleteCount = currentResults.filter(r => r.incomplete).length;
        if (incompleteCount > 0) {
            showToast(`查询已取消，${incompleteCount} 条不完整，可点"重查不完整"继续`);
        } else {
            showToast("查询已取消");
        }
    } else {
        showToast(`查询已取消，已还原 ${_lastQueriedPackages?.length || 0} 个包名到输入框`);
    }
}

function dismissPerfWarningForever() {
    _perfWarningDismissed = true;
    document.getElementById("perfWarning").style.display = "none";
    // Persist to settings
    const s = loadSettings();
    s.showPerfWarning = false;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    // Sync checkbox in settings panel
    const perfToggleEl = document.getElementById("showPerfWarning");
    if (perfToggleEl) perfToggleEl.checked = false;
    showToast("已关闭速度提醒，可在设置中重新开启");
}


