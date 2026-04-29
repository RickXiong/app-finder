/* ============================================================
   AppLookup · Mobile JS (2026-04-24)
   零依赖移动端访客视图。仅消费现有后端 API：
     POST /api/start_job          { package_names: [...], ...flags }
     SSE  /api/job_stream/<id>?offset=0
     POST /api/cancel_job/<id>
   字段约定与 main-v4.js 完全一致（照抄，不自创字段）。
   ============================================================ */
(function () {
  'use strict';

  // ---------- 工具 ----------
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function setView(view) {
    document.getElementById('mRoot').dataset.view = view;
    $$('.m-view').forEach(el => {
      el.hidden = (el.dataset.view !== view);
    });
    // 切视图时滚回顶
    window.scrollTo(0, 0);
  }

  let _toastTimer = 0;
  function toast(msg, ms = 1800) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    // Fallback：textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function parseInput(text) {
    // 支持换行 / 逗号 / 中文逗号 / 全角分号 / 多空格分隔
    return String(text || '')
      .split(/[\n,，;；\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // ---------- 状态 ----------
  const state = {
    job: null,            // { jobId, eventSource, total, done, lines }
    results: [],          // 累加的结果（含 incomplete）
    history: [],          // localStorage
    theme: null,          // 'light' / 'dark' / null（auto）
  };

  const HISTORY_KEY = 'applookup_mobile_history_v1';
  const THEME_KEY   = 'applookup_mobile_theme_v1';
  const HISTORY_MAX = 30;

  // ---------- 主题 ----------
  function applyTheme(t) {
    state.theme = t;
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    } else {
      delete document.documentElement.dataset.theme;
    }
    try { localStorage.setItem(THEME_KEY, t || 'auto'); } catch {}
  }
  function loadTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      applyTheme(v === 'light' || v === 'dark' ? v : null);
    } catch {}
  }
  function toggleTheme() {
    // auto → light → dark → auto
    const cur = state.theme;
    const next = cur == null ? 'light' : (cur === 'light' ? 'dark' : null);
    applyTheme(next);
    toast('主题：' + (next === 'light' ? '浅色' : next === 'dark' ? '深色' : '跟随系统'));
  }

  // ---------- 历史 ----------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.history = Array.isArray(arr) ? arr : [];
    } catch { state.history = []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, HISTORY_MAX))); } catch {}
  }
  function pushHistory(packages, results) {
    if (!packages || !packages.length) return;
    const entry = {
      ts: Date.now(),
      packages: packages.slice(),
      results: (results || []).slice(),
    };
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    saveHistory();
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day} ${hh}:${mm}`;
  }

  function renderHistory() {
    const list = $('#historyList');
    const empty = $('#historyEmpty');
    if (!state.history.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = state.history.map((entry, idx) => `
      <div class="m-hist-item" data-hist-idx="${idx}">
        <div class="m-hist-meta">
          <span class="m-hist-time">${esc(fmtTime(entry.ts))}</span>
          <span class="m-hist-stats">${entry.packages.length} 包 · ${entry.results.length} 条</span>
        </div>
        <div class="m-hist-pkgs">${esc(entry.packages.join(', '))}</div>
        <div class="m-hist-actions">
          <button class="m-btn m-btn-ghost" data-hist-show="${idx}">显示</button>
          <button class="m-btn m-btn-ghost" data-hist-del="${idx}">删除</button>
        </div>
      </div>
    `).join('');
  }

  function openDrawer() {
    const d = $('#drawer');
    d.hidden = false;
    // 强制下一帧加 class，触发 transition
    requestAnimationFrame(() => d.classList.add('is-open'));
    d.setAttribute('aria-hidden', 'false');
    renderHistory();
  }
  function closeDrawer() {
    const d = $('#drawer');
    d.classList.remove('is-open');
    d.setAttribute('aria-hidden', 'true');
    setTimeout(() => { d.hidden = true; }, 250);
  }

  // ---------- 查询启动 ----------
  async function startJob(lines) {
    state.results = [];
    state.job = { jobId: null, eventSource: null, total: lines.length, done: 0, lines };

    // UI 切到 loading
    setView('loading');
    updateProgress(0, lines.length, '正在准备查询…');
    $('#loadingList').innerHTML = '';

    const body = {
      package_names: lines,
      exact_search: false,
      get_apk_url: false,
      apk_url_mode: 'single',
      get_sha1: false,
      get_sha256: false,
      get_description: false,
      query_interval_ms: 200,
      platform_filter: 'all',
      extended_search: true,
    };
    try {
      const r = await fetch('/api/start_job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data.job_id) throw new Error(data.error || '启动查询失败');
      state.job.jobId = data.job_id;
      state.job.total = data.total_tasks || lines.length;
      openStream(data.job_id);
    } catch (e) {
      toast('启动查询失败：' + (e.message || e));
      setView('landing');
    }
  }

  function openStream(jobId) {
    const es = new EventSource(`/api/job_stream/${jobId}?offset=0`);
    es.onmessage = (ev) => {
      try { handleEvent(JSON.parse(ev.data)); }
      catch (err) { console.warn('bad sse', err); }
    };
    es.onerror = () => { /* EventSource 自动重连，让浏览器自己处理 */ };
    state.job.eventSource = es;
  }

  function closeStream() {
    if (state.job && state.job.eventSource) {
      try { state.job.eventSource.close(); } catch {}
      state.job.eventSource = null;
    }
  }

  function cancelJob() {
    if (state.job && state.job.jobId) {
      try { fetch(`/api/cancel_job/${state.job.jobId}`, { method: 'POST' }); } catch {}
    }
    closeStream();
    state.job = null;
    setView('landing');
    toast('已取消');
  }

  // ---------- SSE 事件分发（照抄 main-v4.js handleEvent 的核心分支） ----------
  function handleEvent(ev) {
    if (!state.job) return; // 已被取消
    switch (ev.type) {
      case 'start':
        if (ev.total != null) state.job.total = ev.total;
        updateProgress(0, state.job.total, '查询中…');
        break;
      case 'progress':
        state.job.done = ev.done || 0;
        updateProgress(state.job.done, ev.total || state.job.total, currentPkgHint(ev));
        if (ev.rows) mergeRows(ev.rows, /*streaming*/ true);
        break;
      case 'session_reset':
        toast('商店会话已重建，继续查询');
        break;
      case 'retry_progress':
        if (ev.rows) mergeRows(ev.rows, true);
        break;
      case 'complete':
        if (ev.results) state.results = ev.results;
        markIncomplete();
        closeStream();
        // 保存历史 + 切到结果页
        pushHistory(state.job.lines, state.results);
        state.job = null;
        renderResults();
        setView('results');
        if (ev.over_limit) toast('部分结果被截断（超出限制）');
        if (ev.invalid_count) toast(`跳过 ${ev.invalid_count} 条无效输入`);
        break;
      case 'error':
        toast('查询出错：' + (ev.message || 'unknown'));
        closeStream();
        state.job = null;
        setView('landing');
        break;
    }
  }

  function currentPkgHint(ev) {
    // 进度事件里通常没具体当前包名（流式 row 上来才有），尽量友好
    const total = ev.total || state.job.total;
    const done = ev.done || state.job.done || 0;
    return `已完成 ${done} / ${total}`;
  }

  function mergeRows(rows, streaming) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const key = (row.package_name || '') + '|' + (row.platform || '');
      const idx = state.results.findIndex(r => (r.package_name || '') + '|' + (r.platform || '') === key);
      if (idx >= 0) state.results[idx] = row;
      else state.results.push(row);
    }
    markIncomplete();
    if (streaming) renderStreamList();
  }

  function markIncomplete() {
    // 完整性判定：照抄 main-v4.js:1702（关键字段任一缺失 = incomplete）
    // 关键字段：package_name / platform / app_name(非"未找到") / download_url
    // 4 项任一缺 → incomplete = true（橙黄色卡片，提示用户）
    for (const r of state.results) {
      const missing = [];
      if (!r.package_name) missing.push('package_name');
      if (!r.platform) missing.push('platform');
      if (!r.app_name || r.app_name === '未找到') missing.push('app_name');
      if (!r.download_url) missing.push('download_url');
      r.incomplete = missing.length > 0;
      r._notFound = !r.app_name || r.app_name === '未找到';
    }
  }

  // ---------- 进度 UI ----------
  function updateProgress(done, total, hint) {
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    $('#loadingBarFill').style.width = pct + '%';
    $('#loadingCounter').textContent = `${done} / ${total}`;
    if (hint) {
      $('#loadingStatus .m-loading-text').textContent = hint;
    }
  }

  // ---------- 卡片渲染 ----------
  function iconHTML(r) {
    if (r.icon_url) {
      return `<img src="${esc(r.icon_url)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'m-card-icon-fallback',textContent:'📱'}))" />`;
    }
    return `<span class="m-card-icon-fallback">📱</span>`;
  }

  function platformChipHTML(r) {
    if (!r.platform) return '';
    const cls = r.platform === 'iOS' ? 'm-card-chip-ios' : 'm-card-chip-android';
    return `<span class="m-card-chip ${cls}">${esc(r.platform)}</span>`;
  }

  function categoryChipHTML(r) {
    if (!r.category) return '';
    return `<span class="m-card-chip m-card-chip-cat copyable" data-copy="${esc(r.category)}">${esc(r.category)}</span>`;
  }

  function correctedChipHTML(r) {
    if (!r._corrected) return '';
    const orig = r._orig_value || '';
    return `<span class="m-card-chip m-card-chip-corr" title="原输入：${esc(orig)}">已修正</span>`;
  }

  function rowIconSVG(name) {
    const svgs = {
      pkg:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      store:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18M3 9l1.5 11h15L21 9M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/></svg>',
      apk:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
      sha:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      cat:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    };
    return svgs[name] || '';
  }

  function renderCard(r) {
    const noName = !r.app_name || r.app_name === '未找到';
    const nameHTML = noName
      ? `<span class="m-card-name is-empty">未找到</span>`
      : `<span class="m-card-name copyable" data-copy="${esc(r.app_name)}">${esc(r.app_name)}</span>`;

    // 包名行（永远显示，整行可复制）
    const pkgRow = `
      <div class="m-card-row copyable" data-copy="${esc(r.package_name || '')}">
        <span class="m-card-row-icon">${rowIconSVG('pkg')}</span>
        <span class="m-card-row-content"><span class="m-card-pkg">${esc(r.package_name || '')}</span></span>
      </div>`;

    // 商店链接行
    let storeRow = '';
    if (r.download_url) {
      const storeName = r.source || '商店';
      storeRow = `
        <div class="m-card-row">
          <span class="m-card-row-icon">${rowIconSVG('store')}</span>
          <span class="m-card-row-content">
            <a class="m-card-link" href="${esc(r.download_url)}" target="_blank" rel="noopener">
              <span class="m-card-link-name">${esc(storeName)}</span>
              <svg class="m-card-link-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
            </a>
          </span>
        </div>`;
    }

    // APK 直链（Android only；iOS 不显示）
    let apkRow = '';
    if (r.platform === 'Android' && Array.isArray(r.apk_direct_urls) && r.apk_direct_urls.length) {
      const u = r.apk_direct_urls[0];
      apkRow = `
        <div class="m-card-row">
          <span class="m-card-row-icon">${rowIconSVG('apk')}</span>
          <span class="m-card-row-content">
            <a class="m-card-link" href="${esc(u)}" target="_blank" rel="noopener">
              <span class="m-card-link-name">APK 直链</span>
              <svg class="m-card-link-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
            </a>
          </span>
        </div>`;
    }

    // 分类行（如有）
    let catRow = '';
    if (r.category) {
      catRow = `
        <div class="m-card-row copyable" data-copy="${esc(r.category)}">
          <span class="m-card-row-icon">${rowIconSVG('cat')}</span>
          <span class="m-card-row-content"><span>${esc(r.category)}</span></span>
        </div>`;
    }

    // 卡片底部按钮
    const canShare = !noName && r.package_name;
    const actions = `
      <div class="m-card-actions">
        <button class="m-card-action" data-act="copy" data-copy="${esc(buildCardCopyText(r))}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>复制</span>
        </button>
        ${canShare ? `<button class="m-card-action" data-act="share" data-share-idx="${state.results.indexOf(r)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          <span>分享</span>
        </button>` : ''}
      </div>`;

    const incompleteCls = r.incomplete ? ' incomplete' : '';
    const notFoundCls   = r._notFound ? ' not-found' : '';

    return `
      <article class="m-card${incompleteCls}${notFoundCls} is-fresh">
        <div class="m-card-head">
          <div class="m-card-icon">${iconHTML(r)}</div>
          <div class="m-card-headtext">
            ${nameHTML}
            <div class="m-card-meta">
              ${platformChipHTML(r)}
              ${categoryChipHTML(r)}
              ${correctedChipHTML(r)}
            </div>
          </div>
        </div>
        ${pkgRow}
        ${storeRow}
        ${apkRow}
        ${actions}
      </article>`;
  }

  function buildCardCopyText(r) {
    const parts = [];
    if (r.app_name && r.app_name !== '未找到') parts.push(r.app_name);
    if (r.platform) parts.push(`[${r.platform}]`);
    if (r.package_name) parts.push(r.package_name);
    if (r.category) parts.push('分类：' + r.category);
    if (r.download_url) parts.push('商店：' + r.download_url);
    if (r.platform === 'Android' && Array.isArray(r.apk_direct_urls) && r.apk_direct_urls.length) {
      parts.push('APK：' + r.apk_direct_urls[0]);
    }
    return parts.join('\n');
  }

  function renderStreamList() {
    // 流式时渲染到 loadingList（保持当前查询页可见）
    const el = $('#loadingList');
    el.innerHTML = state.results.map(renderCard).join('');
    // 一次性触发，去掉 is-fresh class（避免重复动画）
    requestAnimationFrame(() => {
      el.querySelectorAll('.m-card.is-fresh').forEach(c => c.classList.remove('is-fresh'));
    });
  }

  function renderResults() {
    const list = $('#resultsList');
    const empty = $('#resultsEmpty');
    if (!state.results.length) {
      list.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.innerHTML = state.results.map(renderCard).join('');
    }
    $('#resultsTitle').textContent = `结果 (${state.results.length})`;
    const ios = state.results.filter(r => r.platform === 'iOS').length;
    const and = state.results.filter(r => r.platform === 'Android').length;
    $('#resultsSummary').textContent = `iOS ${ios} · Android ${and}`;
    requestAnimationFrame(() => {
      list.querySelectorAll('.m-card.is-fresh').forEach(c => c.classList.remove('is-fresh'));
    });
  }

  // ---------- 全局事件委托：复制 + 分享 ----------
  document.addEventListener('click', async (e) => {
    // 卡片底部按钮
    const action = e.target.closest('[data-act]');
    if (action) {
      e.preventDefault();
      const act = action.dataset.act;
      if (act === 'copy') {
        const text = action.dataset.copy || '';
        const ok = await copyText(text);
        toast(ok ? '已复制' : '复制失败');
        return;
      }
      if (act === 'share') {
        const idx = parseInt(action.dataset.shareIdx, 10);
        const r = state.results[idx];
        if (!r) return;
        const text = buildCardCopyText(r);
        if (navigator.share) {
          try { await navigator.share({ title: r.app_name || r.package_name, text }); }
          catch {}
        } else {
          // Fallback 复制
          const ok = await copyText(text);
          toast(ok ? '已复制（系统分享不可用）' : '分享失败');
        }
        return;
      }
    }

    // 整行 / 整 chip 可复制
    const copyable = e.target.closest('[data-copy].copyable, .copyable[data-copy]');
    if (copyable && !copyable.closest('a, button')) {
      const text = copyable.dataset.copy || copyable.textContent || '';
      const ok = await copyText(text);
      if (ok) toast('已复制');
      return;
    }

    // 历史"显示"
    const histShow = e.target.closest('[data-hist-show]');
    if (histShow) {
      const idx = parseInt(histShow.dataset.histShow, 10);
      const entry = state.history[idx];
      if (entry && entry.results) {
        state.results = entry.results.slice();
        markIncomplete();
        closeDrawer();
        renderResults();
        setView('results');
        toast('已显示历史结果');
      }
      return;
    }
    // 历史"删除"
    const histDel = e.target.closest('[data-hist-del]');
    if (histDel) {
      const idx = parseInt(histDel.dataset.histDel, 10);
      state.history.splice(idx, 1);
      saveHistory();
      renderHistory();
      return;
    }
    // 示例 chip：填进 textarea
    const fill = e.target.closest('[data-fill]');
    if (fill) {
      const ta = $('#txtInput');
      const cur = ta.value.trim();
      ta.value = cur ? cur + '\n' + fill.dataset.fill : fill.dataset.fill;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
      return;
    }
  });

  // ---------- 初始化 ----------
  function init() {
    loadTheme();
    loadHistory();

    // 输入框：实时启用/禁用提交按钮 + 自适应高度
    const ta = $('#txtInput');
    const btn = $('#btnSubmit');
    const btnClear = $('#btnClear');
    const updateInputUI = () => {
      const lines = parseInput(ta.value);
      btn.disabled = lines.length === 0;
      btnClear.hidden = !ta.value;
      // 自适应高度
      ta.style.height = 'auto';
      ta.style.height = Math.min(240, Math.max(96, ta.scrollHeight)) + 'px';
    };
    ta.addEventListener('input', updateInputUI);
    btnClear.addEventListener('click', () => { ta.value = ''; updateInputUI(); ta.focus(); });

    // 提交
    btn.addEventListener('click', () => {
      const lines = parseInput(ta.value);
      if (!lines.length) return;
      // 移除可能的重复
      const uniq = [...new Set(lines)];
      startJob(uniq);
    });

    // 取消
    $('#btnCancel').addEventListener('click', cancelJob);
    $('#btnLoadingBack').addEventListener('click', cancelJob);

    // 返回首页
    $('#btnResultsBack').addEventListener('click', () => {
      setView('landing');
    });

    // 复制全部
    $('#btnCopyAll').addEventListener('click', async () => {
      if (!state.results.length) { toast('没有可复制的内容'); return; }
      const text = state.results.map(buildCardCopyText).join('\n\n');
      const ok = await copyText(text);
      toast(ok ? `已复制 ${state.results.length} 条` : '复制失败');
    });

    // 历史抽屉
    $('#btnMenu').addEventListener('click', openDrawer);
    $('#btnDrawerClose').addEventListener('click', closeDrawer);
    $('#drawerMask').addEventListener('click', closeDrawer);
    $('#btnHistClearAll').addEventListener('click', () => {
      if (!state.history.length) return;
      if (!confirm('清空全部历史？')) return;
      state.history = [];
      saveHistory();
      renderHistory();
      toast('已清空');
    });

    // 主题
    $('#btnTheme').addEventListener('click', toggleTheme);

    // 初次状态
    updateInputUI();
    setView('landing');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
