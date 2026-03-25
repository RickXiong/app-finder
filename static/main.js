// ========== 设置 (Settings) ==========

const SETTINGS_KEY = "app_finder_settings";

const DEFAULT_SETTINGS = {
    storeOrder: ["xiaomi", "tencent", "wandoujia", "appchina", "pp"],
    exactSearch: false,
    getApkUrl: false,
    apkUrlMode: "single",
    getSha1: false,
    queryIntervalMs: 0,
    platformFilter: "all",
    keepInInput: false,
};

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        return Object.assign({}, DEFAULT_SETTINGS, s);
    } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings() {
    const s = {
        storeOrder: androidStoreOrder,
        exactSearch: document.getElementById("exactSearch")?.checked || false,
        getApkUrl: document.getElementById("getApkUrl")?.checked || false,
        apkUrlMode: document.querySelector('input[name="apkUrlMode"]:checked')?.value || "single",
        getSha1: document.getElementById("getSha1")?.checked || false,
        queryIntervalMs: parseInt(document.getElementById("queryIntervalSlider")?.value || 0),
        platformFilter: document.querySelector('input[name="platformFilter"]:checked')?.value || "all",
        keepInInput: document.getElementById("keepInInput")?.checked || false,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
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

    // Store order
    applyStoreOrder(s.storeOrder);
}

function applyStoreOrder(order) {
    const list = document.getElementById("storeList");
    if (!list) return;
    const items = {};
    list.querySelectorAll(".store-item").forEach(el => { items[el.dataset.store] = el; });
    // Re-append in order
    order.forEach(storeId => {
        if (items[storeId]) list.appendChild(items[storeId]);
    });
    // Append any remaining items not in saved order
    Object.keys(items).forEach(id => {
        if (!order.includes(id)) list.appendChild(items[id]);
    });
    updateStoreOrder();
}

function resetSettings() {
    localStorage.removeItem(SETTINGS_KEY);
    applySettings(DEFAULT_SETTINGS);
    updateStoreOrder();
    showToast("已恢复默认设置");
}

// ========== 设置面板开关 ==========

function openSettings() {
    document.getElementById("settingsOverlay").classList.add("open");
    // Refresh startup status
    fetch("/api/startup/status").then(r => r.json()).then(d => {
        document.getElementById("startupStatus").textContent = d.enabled ? "✓ 已开启" : "未开启";
        document.getElementById("startupStatus").style.color = d.enabled ? "#52c41a" : "#999";
    }).catch(() => {});
}

function closeSettings() {
    document.getElementById("settingsOverlay").classList.remove("open");
    saveSettings();
}

function closeSettingsIfBg(e) {
    if (e.target === document.getElementById("settingsOverlay")) closeSettings();
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

// ========== 安卓商店拖拽排序 ==========

let androidStoreOrder = [...DEFAULT_SETTINGS.storeOrder];

function initDragSort() {
    const list = document.getElementById("storeList");
    let dragItem = null;

    list.addEventListener("dragstart", (e) => {
        dragItem = e.target.closest(".store-item");
        if (dragItem) {
            dragItem.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        }
    });

    list.addEventListener("dragend", () => {
        if (dragItem) { dragItem.classList.remove("dragging"); dragItem = null; }
        list.querySelectorAll(".store-item").forEach(el => el.classList.remove("drag-over"));
        updateStoreOrder();
    });

    list.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const target = e.target.closest(".store-item");
        if (target && target !== dragItem) {
            list.querySelectorAll(".store-item").forEach(el => el.classList.remove("drag-over"));
            target.classList.add("drag-over");
        }
    });

    list.addEventListener("drop", (e) => {
        e.preventDefault();
        const target = e.target.closest(".store-item");
        if (target && dragItem && target !== dragItem) {
            const items = [...list.querySelectorAll(".store-item")];
            const dragIdx = items.indexOf(dragItem);
            const targetIdx = items.indexOf(target);
            list.insertBefore(dragItem, dragIdx < targetIdx ? target.nextSibling : target);
        }
        list.querySelectorAll(".store-item").forEach(el => el.classList.remove("drag-over"));
        updateStoreOrder();
    });

    updateStoreOrder();
}

function updateStoreOrder() {
    const items = document.getElementById("storeList").querySelectorAll(".store-item");
    androidStoreOrder = [];
    items.forEach((item, i) => {
        androidStoreOrder.push(item.dataset.store);
        let numEl = item.querySelector(".store-order-num");
        if (!numEl) {
            numEl = document.createElement("span");
            numEl.className = "store-order-num";
            item.insertBefore(numEl, item.firstChild);
        }
        numEl.textContent = i + 1;
    });
}

// ========== 历史记录 ==========

const HISTORY_KEY = "app_finder_history";
const MAX_HISTORY = 20;

function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveToHistory(packageNames, results) {
    let history = getHistory();
    const isBatch = packageNames.length > 1;
    const appNames = [...new Set(results.filter(r => r.app_name !== "未找到").map(r => r.app_name))];
    const entry = {
        packages: packageNames,
        label: isBatch ? `${packageNames[0]} 等${packageNames.length}个` : packageNames[0],
        appNames: appNames.slice(0, 5),
        isBatch,
        time: Date.now(),
        results: results.slice(0, 500),
    };
    history = history.filter(h => JSON.stringify(h.packages) !== JSON.stringify(packageNames));
    history.unshift(entry);
    history = history.slice(0, MAX_HISTORY);
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        const lightHistory = history.map(h => ({ ...h, results: [] }));
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(lightHistory)); } catch (_) {}
    }
    renderHistory();
}

function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
}

function renderHistory() {
    const history = getHistory();
    const section = document.getElementById("historySection");
    const list = document.getElementById("historyList");
    if (history.length === 0) { section.style.display = "none"; return; }
    section.style.display = "block";
    list.innerHTML = "";
    history.forEach(entry => {
        const item = document.createElement("div");
        item.className = "history-item";

        const mainPart = document.createElement("div");
        mainPart.className = "history-main";
        mainPart.title = "点击重新搜索";

        const label = document.createElement("span");
        label.className = "label";
        label.textContent = entry.label;
        mainPart.appendChild(label);

        if (entry.appNames && entry.appNames.length > 0) {
            const names = document.createElement("span");
            names.className = "app-names";
            names.textContent = "(" + entry.appNames.join(", ") + ")";
            mainPart.appendChild(names);
        }
        mainPart.addEventListener("click", () => onHistoryClick(entry));
        item.appendChild(mainPart);

        if (entry.results && entry.results.length > 0) {
            const resultBtn = document.createElement("button");
            resultBtn.className = "history-result-btn";
            resultBtn.textContent = "显示历史结果";
            resultBtn.title = "直接显示上次结果，不重新请求";
            resultBtn.addEventListener("click", e => {
                e.stopPropagation();
                showCachedResults(entry);
            });
            item.appendChild(resultBtn);
        }

        list.appendChild(item);
    });
}

function onHistoryClick(entry) {
    const keepInInput = document.getElementById("keepInInput")?.checked || false;
    const doSearch = () => startQuery(entry.packages, keepInInput);
    if (entry.isBatch) {
        showConfirm(`确定重新查询这 ${entry.packages.length} 项吗？`, doSearch);
    } else {
        doSearch();
    }
}

function showCachedResults(entry) {
    if (!entry.results || entry.results.length === 0) {
        showToast("暂无缓存结果");
        return;
    }
    currentResults = entry.results;
    renderResults(entry.results);
    const keepInInput = document.getElementById("keepInInput")?.checked || false;
    if (keepInInput) {
        document.getElementById("packageInput").value = entry.packages.join("\n");
    }
}

// ========== 确认弹窗 ==========

function showConfirm(message, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
        <div class="confirm-box">
            <p>${message}</p>
            <div class="btn-row">
                <button class="btn btn-secondary" id="confirmCancel">取消</button>
                <button class="btn btn-primary" id="confirmOk">确认查询</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#confirmCancel").onclick = () => overlay.remove();
    overlay.querySelector("#confirmOk").onclick = () => { overlay.remove(); onConfirm(); };
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// ========== 风险确认弹窗（>100条）==========

function showRiskWarning(itemCount, intervalMs, onConfirm) {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const intervalHint = intervalMs > 0
        ? `<p style="color:#52c41a;font-size:13px;">✓ 已设置查询间隔 ${intervalMs >= 1000 ? intervalMs/1000 + ' 秒' : intervalMs + ' ms'}，可有效降低封锁风险。</p>`
        : `<p class="risk-hint">建议在 <strong>设置</strong> 中开启查询间隔（2-5秒），可大幅降低被封锁的风险。</p>`;
    overlay.innerHTML = `
        <div class="confirm-box risk-box">
            <h3>⚠️ 大量查询风险提示</h3>
            <p>您即将查询 <span class="risk-count-badge">${itemCount} 条</span> 数据。</p>
            <p>大量并发请求可能导致您的 IP 被小米、腾讯等应用商店封锁，影响后续使用。</p>
            ${intervalHint}
            <p class="risk-hint">如确认继续，请在下方输入 <code>i know the risk</code>：</p>
            <input type="text" id="riskInput" class="risk-input" placeholder="i know the risk" autocomplete="off" spellcheck="false">
            <div class="btn-row">
                <button class="btn btn-secondary" id="riskCancel">取消</button>
                <button class="btn btn-primary" id="riskOk" disabled>确认查询</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#riskInput");
    const okBtn = overlay.querySelector("#riskOk");

    input.addEventListener("input", () => {
        const valid = input.value.trim() === "i know the risk";
        okBtn.disabled = !valid;
        input.classList.toggle("valid", valid);
    });

    overlay.querySelector("#riskCancel").onclick = () => overlay.remove();
    okBtn.onclick = () => { overlay.remove(); onConfirm(); };
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

    setTimeout(() => input.focus(), 100);
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
    new Notification("App 查询完成 ✅", { body: `共查到 ${resultCount} 条结果` });
}

// ========== 进度条 ==========

let progressStartTime = null;

function showProgressBar(total, estimatedSeconds) {
    progressStartTime = Date.now();
    const container = document.getElementById("progressContainer");
    container.style.display = "block";
    document.getElementById("progressFill").style.width = "0%";
    document.getElementById("progressText").textContent = `0 / ${total}`;
    document.getElementById("progressEta").textContent =
        estimatedSeconds > 0 ? `预计约 ${formatTime(estimatedSeconds)}` : "";
}

function updateProgressBar(done, total) {
    const pct = total > 0 ? (done / total * 100) : 0;
    document.getElementById("progressFill").style.width = pct.toFixed(1) + "%";
    document.getElementById("progressText").textContent = `${done} / ${total}  (${pct.toFixed(1)}%)`;
    if (done > 0 && progressStartTime) {
        const elapsed = (Date.now() - progressStartTime) / 1000;
        const rate = done / elapsed;
        const remaining = (total - done) / rate;
        document.getElementById("progressEta").textContent =
            `已用 ${formatTime(elapsed)} · 预计还需 ${formatTime(remaining)}`;
    }
}

function resetProgressBar() {
    const container = document.getElementById("progressContainer");
    if (container) container.style.display = "none";
    progressStartTime = null;
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "--";
    if (seconds < 60) return `${Math.round(seconds)} 秒`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

// ========== 查询入口 ==========

let currentResults = [];

function doQuery() {
    const input = document.getElementById("packageInput").value.trim();
    if (!input) { showToast("请输入包名或App名称"); return; }
    const packageNames = input.split("\n").map(s => s.trim()).filter(s => s.length > 0);
    if (packageNames.length === 0) { showToast("请输入包名或App名称"); return; }

    const intervalMs = parseInt(document.getElementById("queryIntervalSlider")?.value || 0);

    if (packageNames.length > 100) {
        requestNotificationPermission();
        showRiskWarning(packageNames.length, intervalMs, () => startQuery(packageNames));
    } else {
        startQuery(packageNames);
    }
}

function startQuery(packageNames, keepInput = false) {
    if (keepInput) {
        document.getElementById("packageInput").value = packageNames.join("\n");
    } else {
        document.getElementById("packageInput").value = "";
    }
    executeQuery(packageNames);
}

async function executeQuery(packageNames) {
    const loadingEl  = document.getElementById("loading");
    const resultEl   = document.getElementById("resultSection");
    const btnQuery   = document.getElementById("btnQuery");
    const loadingTxt = document.getElementById("loadingText");

    loadingEl.style.display  = "flex";
    resultEl.style.display   = "none";
    btnQuery.disabled        = true;
    resetProgressBar();

    const n = packageNames.length;
    if (n > 1000)      loadingTxt.textContent = `共 ${n} 条，查询中请耐心等待（可能需要数十分钟）...`;
    else if (n > 100)  loadingTxt.textContent = `共 ${n} 条，查询中请稍候...`;
    else               loadingTxt.textContent = "正在查询中，请稍候...";

    const intervalMs = parseInt(document.getElementById("queryIntervalSlider")?.value || 0);
    const platformFilter = document.querySelector('input[name="platformFilter"]:checked')?.value || "all";

    try {
        const response = await fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                package_names: packageNames,
                android_store_order: androidStoreOrder,
                exact_search: document.getElementById("exactSearch")?.checked || false,
                get_apk_url:  document.getElementById("getApkUrl")?.checked || false,
                apk_url_mode: document.querySelector('input[name="apkUrlMode"]:checked')?.value || "single",
                get_sha1:     document.getElementById("getSha1")?.checked || false,
                query_interval_ms: intervalMs,
                platform_filter: platformFilter,
            }),
        });

        if (!response.ok) {
            showToast("服务器错误: " + response.status);
            return;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";

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
                        handleSSEEvent(data, packageNames);
                    } catch (_) {}
                }
            }
        }

    } catch (err) {
        showToast("查询失败: " + err.message);
    } finally {
        loadingEl.style.display = "none";
        btnQuery.disabled       = false;
    }
}

function handleSSEEvent(data, packageNames) {
    if (data.type === "start") {
        showProgressBar(data.total, data.estimated_seconds);
    } else if (data.type === "progress") {
        updateProgressBar(data.done, data.total);
    } else if (data.type === "complete") {
        currentResults = data.results;
        renderResults(data.results);
        showQueryInfo(data);
        saveToHistory(packageNames, data.results);
        sendNotification(data.results.length);
    } else if (data.type === "error") {
        showToast(data.message || "查询出错");
    }
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

// ========== 结果渲染 ==========

function renderResults(results) {
    const section = document.getElementById("resultSection");
    const body    = document.getElementById("resultBody");
    const count   = document.getElementById("resultCount");

    section.style.display = "block";
    count.textContent = results.length;
    body.innerHTML = "";

    const hasApk  = results.some(r => r.apk_direct_urls && r.apk_direct_urls.length > 0);
    const hasSha1 = results.some(r => r.sha1);

    // Show/hide column headers
    document.getElementById("thApkUrl").style.display = hasApk  ? "" : "none";
    document.getElementById("thSha1").style.display   = hasSha1 ? "" : "none";

    let lastPkg = null;
    results.forEach(r => {
        const tr = document.createElement("tr");
        if (lastPkg === r.package_name)      tr.className = "same-group";
        else if (lastPkg !== null)           tr.className = "new-group";
        lastPkg = r.package_name;

        // 图标
        const tdIcon = document.createElement("td");
        if (r.icon_url) {
            const img = document.createElement("img");
            img.className = "app-icon"; img.src = r.icon_url; img.alt = r.app_name;
            img.onerror = function () {
                this.style.display = "none";
                const ph = document.createElement("div");
                ph.className = "icon-placeholder"; ph.textContent = "?";
                this.parentNode.appendChild(ph);
            };
            tdIcon.appendChild(img);
        } else {
            const ph = document.createElement("div");
            ph.className = "icon-placeholder"; ph.textContent = "?";
            tdIcon.appendChild(ph);
        }

        // App名称
        const tdName = document.createElement("td");
        if (r.app_name === "未找到") {
            tdName.innerHTML = '<span class="not-found">未找到</span>';
        } else {
            tdName.textContent = r.app_name;
            tdName.style.cursor = "pointer";
            tdName.onclick = () => copyCell(tdName, r.app_name);
        }

        // 包名
        const tdPkg = document.createElement("td");
        tdPkg.className = "pkg-cell";
        tdPkg.textContent = r.package_name;
        tdPkg.style.cursor = "pointer";
        tdPkg.onclick = () => copyCell(tdPkg, r.package_name);

        // 平台
        const tdPlatform = document.createElement("td");
        const platformTag = document.createElement("span");
        platformTag.className = "platform-tag " + getPlatformClass(r.platform);
        platformTag.textContent = r.platform;
        tdPlatform.appendChild(platformTag);

        // 分类
        const tdCategory = document.createElement("td");
        if (r.category) {
            const catSpan = document.createElement("span");
            catSpan.className = "category-text";
            catSpan.textContent = r.category;
            tdCategory.appendChild(catSpan);
        }

        // 商店地址
        const tdUrl = document.createElement("td");
        const urlCell = document.createElement("div");
        urlCell.className = "url-cell";
        const link = document.createElement("a");
        link.href = r.download_url; link.textContent = r.download_url; link.target = "_blank";
        urlCell.appendChild(link);
        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-btn"; copyBtn.textContent = "复制";
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(r.download_url).then(() => {
                copyBtn.textContent = "已复制"; copyBtn.classList.add("copied-btn");
                showToast("已复制链接");
                setTimeout(() => { copyBtn.textContent = "复制"; copyBtn.classList.remove("copied-btn"); }, 1500);
            });
        };
        urlCell.appendChild(copyBtn);
        tdUrl.appendChild(urlCell);

        // APK直链（仅显示当列存在时）
        const tdApk = document.createElement("td");
        tdApk.className = "td-apk-url";
        if (!hasApk) {
            tdApk.style.display = "none";
        } else if (r.apk_direct_urls && r.apk_direct_urls.length > 0) {
            r.apk_direct_urls.forEach((url, i) => {
                const div = document.createElement("div");
                div.className = "url-cell";
                const a = document.createElement("a");
                a.href = url; a.textContent = `来源${i+1}`; a.target = "_blank";
                const cb = document.createElement("button");
                cb.className = "copy-btn"; cb.textContent = "复制";
                cb.onclick = () => navigator.clipboard.writeText(url).then(() => {
                    cb.textContent = "已复制"; setTimeout(() => cb.textContent = "复制", 1500);
                });
                div.append(a, cb);
                tdApk.appendChild(div);
            });
        }

        // SHA1（仅显示当列存在时）
        const tdSha1 = document.createElement("td");
        tdSha1.className = "td-sha1";
        if (!hasSha1) {
            tdSha1.style.display = "none";
        } else if (r.sha1) {
            tdSha1.textContent = r.sha1;
            tdSha1.style.cursor = "pointer";
            tdSha1.style.fontFamily = "monospace";
            tdSha1.style.fontSize = "11px";
            tdSha1.onclick = () => copyCell(tdSha1, r.sha1);
        }

        tr.append(tdIcon, tdName, tdPkg, tdPlatform, tdCategory, tdUrl, tdApk, tdSha1);
        body.appendChild(tr);
    });

    requestAnimationFrame(updateToolbarHeight);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getPlatformClass(platform) {
    if (platform === "Android") return "android";
    if (platform === "iOS")     return "ios";
    return "unknown";
}

// ========== 复制功能 ==========

function copyCell(td, text) {
    navigator.clipboard.writeText(text).then(() => {
        td.classList.add("copied");
        setTimeout(() => td.classList.remove("copied"), 400);
        showToast("已复制: " + (text.length > 40 ? text.slice(0, 40) + "..." : text));
    });
}

function copyAllResults() {
    if (currentResults.length === 0) { showToast("没有可复制的结果"); return; }
    const hasApk  = currentResults.some(r => r.apk_direct_urls && r.apk_direct_urls.length > 0);
    const hasSha1 = currentResults.some(r => r.sha1);
    let header = "App名称\t包名\t平台\t分类\t商店地址";
    if (hasApk)  header += "\t下载地址";
    if (hasSha1) header += "\tSHA1";
    const rows = currentResults.map(r => {
        let line = `${r.app_name}\t${r.package_name}\t${r.platform}\t${r.category || ""}\t${r.download_url}`;
        if (hasApk)  line += "\t" + (r.apk_direct_urls ? r.apk_direct_urls.join(" | ") : "");
        if (hasSha1) line += "\t" + (r.sha1 || "");
        return line;
    });
    navigator.clipboard.writeText([header, ...rows].join("\n")).then(() => {
        showToast("已复制全部结果，可直接粘贴到Excel");
    });
}

// ========== 下载功能 ==========

function downloadResults(format) {
    if (currentResults.length === 0) { showToast("没有可下载的结果"); return; }
    const includeIcon = document.getElementById("includeIcon").checked;
    const includeIconImage = document.getElementById("includeIconImage").checked;
    fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: currentResults, format, include_icon: includeIcon, include_icon_image: includeIconImage }),
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

// ========== APK URL checkbox 联动 ==========

document.addEventListener("DOMContentLoaded", () => {
    const cb = document.getElementById("getApkUrl");
    const modeRow = document.getElementById("apkUrlModeRow");
    if (cb && modeRow) {
        cb.addEventListener("change", () => {
            modeRow.style.display = cb.checked ? "flex" : "none";
            saveSettings();
        });
    }

    // Save settings on any change
    ["exactSearch", "getSha1"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", saveSettings);
    });
    document.querySelectorAll('input[name="apkUrlMode"], input[name="platformFilter"]').forEach(el => {
        el.addEventListener("change", saveSettings);
    });
    document.getElementById("keepInInput")?.addEventListener("change", saveSettings);
    document.getElementById("queryIntervalSlider")?.addEventListener("change", saveSettings);
});

// ========== 初始化 ==========

renderHistory();
initDragSort();

// 从 localStorage 恢复设置
const savedSettings = loadSettings();
applySettings(savedSettings);

document.getElementById("packageInput").addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doQuery();
});
