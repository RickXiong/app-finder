"""embedded query core — 嵌入式调 app.py 内部 worker，不依赖 HTTP server。

为什么嵌入式：
- AI / 脚本调用时不必先启动 9527 web 服务
- 单进程跑完即退，无端口占用、无 daemon 管理
- 字段返回与 web UI 完全一致（共用同一 worker）

为什么不动 app.py：
- feedback_ui_only.md：后端逻辑照搬，禁止重写
- _parse_query_input + _job_worker 是公开稳定的内部入口
"""
from __future__ import annotations

import os
import sys
import time
import uuid
import threading
import queue
from typing import Iterator, Any

# ---- import app.py 但不启动 Flask（app.py 有 __main__ 保护，line 5226）----
_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)

# 注意：import 期间 app.py 会执行 module-level 代码（注册 routes、读 .settings.json 等），
# 但因为有 __main__ 保护，不会调 app.run()。
import app as _af  # type: ignore  # noqa: E402


# ---------- 选项默认值（与 web UI / main-v4.js startJob 对齐）----------
DEFAULT_OPTS = {
    "platform": "all",          # "all" | "ios" | "android"
    "exact": False,
    "extended": True,           # 跨端补齐
    "apk": False,
    "sha1": False,
    "sha256": False,
    "description": False,
    "interval_ms": 0,
}


def _build_req(inputs: list[str], opts: dict) -> dict:
    """把 CLI/MCP 风格的 opts 翻译成 app.py 期望的 req_data 字段。"""
    o = {**DEFAULT_OPTS, **(opts or {})}
    return {
        "package_names":     list(inputs),
        "exact_search":      bool(o["exact"]),
        "get_apk_url":       bool(o["apk"]),
        "apk_url_mode":      "single",
        "get_sha1":          bool(o["sha1"]),
        "get_sha256":        bool(o["sha256"]),
        "get_description":   bool(o["description"]),
        "query_interval_ms": int(o["interval_ms"]),
        "platform_filter":   str(o["platform"]).lower(),
        "extended_search":   bool(o["extended"]),
    }


def _make_job(req_data: dict) -> tuple[str, dict, dict]:
    """复刻 api_start_job：解析 + 注册 JOBS 项 + 起 worker（不起 worker 由调用方决定）。

    返回 (job_id, worker_params, meta)。
    """
    tasks, worker_params, meta, est = _af._parse_query_input(req_data)
    job_id = uuid.uuid4().hex[:12]
    with _af.JOBS_LOCK:
        _af.JOBS[job_id] = {
            "status":        "running",
            "events":        [],
            "tasks":         tasks,
            "worker_params": worker_params,
            "results":       [],
            "created_at":    time.time(),
        }
    return job_id, worker_params, meta


def query(inputs: list[str], **opts: Any) -> dict:
    """同步阻塞查询，返回完整结果。

    Args:
        inputs: 包名 / app 名 / iOS id / Apple URL 混合。后端自动识别类型。
        **opts: platform/exact/extended/apk/sha1/sha256/description/interval_ms

    Returns:
        {
            "results":       List[row],   # 见 row schema
            "total_input":   int,         # 入参总数（去重前）
            "deduplicated":  int,         # 去重数
            "invalid_count": int,         # 无效数（无法识别为包名/app名/id）
            "over_limit":    int,         # 超出 10000 上限被截断
        }

    每个 row 字段（与 web UI 一致）：
        package_name:     str
        platform:         "iOS" | "Android"
        app_name:         str         # 未找到时 = "未找到"
        icon_url:         str | None
        category:         str | None
        download_url:     str | None  # 商店链接
        source:           str | None  # 商店名
        apk_direct_urls:  list[str]   # Android only
        sha1:             str | None  # 仅当 sha1=True
        sha256:           str | None  # 仅当 sha256=True
        description:      str | None  # 仅当 description=True；iOS 行总有
        _orig_task_type:  "pkg" | "ios_id" | "name"
        _orig_value:      str         # 原始输入
        _corrected:       bool        # 包名前缀自动修正过
        extended_fill:    bool        # 跨端补齐而来
    """
    if not inputs:
        return {"results": [], "total_input": 0, "deduplicated": 0,
                "invalid_count": 0, "over_limit": 0}

    req = _build_req(inputs, opts)
    job_id, worker_params, meta = _make_job(req)

    # _job_worker 是 blocking call，跑完所有 tasks 才返回。直接同步调。
    _af._job_worker(job_id)

    job = _af.JOBS.get(job_id, {})
    results = job.get("results", [])

    # 提取 complete 事件里的 meta 字段（over_limit / invalid_count / deduplicated）
    meta_out = {
        "total_input":   meta.get("total_input", len(inputs)),
        "deduplicated":  meta.get("deduplicated", 0),
        "invalid_count": meta.get("invalid_count", 0),
        "over_limit":    meta.get("over_limit", 0),
    }
    for ev in job.get("events", []):
        if ev.get("type") == "complete":
            for k in ("total_input", "deduplicated", "invalid_count", "over_limit"):
                if k in ev:
                    meta_out[k] = ev[k]

    # 释放 JOBS 占位（避免长期内存涨）
    with _af.JOBS_LOCK:
        _af.JOBS.pop(job_id, None)

    return {"results": results, **meta_out}


def query_stream(inputs: list[str], **opts: Any) -> Iterator[dict]:
    """流式查询：每个事件一个 dict，按到达顺序 yield。

    事件类型（与 SSE /api/job_stream 一致）：
        {"type": "start",    "total": int, ...}
        {"type": "progress", "done": int, "total": int, "rows": [row...]}
        {"type": "complete", "results": [...], "total_input": int, ...}
        {"type": "error",    "message": str}

    用法（CLI --jsonl 模式）：
        for ev in query_stream(["微信", "com.taobao.taobao"]):
            print(json.dumps(ev, ensure_ascii=False))
    """
    if not inputs:
        yield {"type": "complete", "results": [], "total_input": 0,
               "deduplicated": 0, "invalid_count": 0, "over_limit": 0}
        return

    req = _build_req(inputs, opts)
    job_id, worker_params, meta = _make_job(req)

    # 后台跑 worker，主线程轮询 events 增量
    th = threading.Thread(target=_af._job_worker, args=(job_id,), daemon=True)
    th.start()

    seen = 0
    try:
        while True:
            job = _af.JOBS.get(job_id)
            if not job:
                break
            events = job.get("events", [])
            while seen < len(events):
                yield events[seen]
                seen += 1
            if not th.is_alive() and seen >= len(events):
                break
            time.sleep(0.05)
    finally:
        with _af.JOBS_LOCK:
            _af.JOBS.pop(job_id, None)


# ---------- 元信息暴露（给 MCP / --schema 用）----------

ROW_FIELDS = {
    "package_name":    "包名（Android）或 Bundle ID（iOS）",
    "platform":        "平台：'iOS' 或 'Android'",
    "app_name":        "应用名；未找到时为 '未找到'",
    "icon_url":        "图标 URL（可能为 null）",
    "category":        "分类（可能为 null）",
    "download_url":    "商店详情页链接（可能为 null）",
    "source":          "商店名（小米应用商店 / 应用宝 / App Store / ...）",
    "apk_direct_urls": "APK 直链数组（仅 Android，仅 apk=true 时填充）",
    "sha1":            "APK SHA1（仅 sha1=true 时填充）",
    "sha256":          "APK SHA256（仅 sha256=true 时填充）",
    "description":     "应用介绍（iOS 默认有；Android 仅 description=true 时抓）",
    "_orig_task_type": "原输入识别为：'pkg' / 'ios_id' / 'name'",
    "_orig_value":     "原始输入字符串",
    "_corrected":      "包名是否被自动前缀修正（om./co./cm. → com.）",
    "extended_fill":   "是否由跨端补齐而来（不是直接命中）",
}

OPT_FIELDS = {
    "platform":    ("string", "all|ios|android", "all", "平台筛选"),
    "exact":       ("bool",   None, False, "精确匹配（仅按 app 名查时生效）"),
    "extended":    ("bool",   None, True,  "跨端补齐：单端命中后查另一端"),
    "apk":         ("bool",   None, False, "抓取 APK 直链（耗时）"),
    "sha1":        ("bool",   None, False, "抓取 APK SHA1（耗时，需 apk=true 起作用）"),
    "sha256":      ("bool",   None, False, "抓取 APK SHA256（耗时，需 apk=true 起作用）"),
    "description": ("bool",   None, False, "抓取应用介绍（iOS 默认有，Android 需此开关）"),
    "interval_ms": ("int",    None, 0,     "查询间隔毫秒（防限流）"),
}
