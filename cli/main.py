"""applookup CLI — 给 AI / shell / 自动化脚本用。

用法（pip install -e . 后）：
    applookup com.tencent.mm 微信 414478124        # 混合输入
    applookup --jsonl com.tencent.mm                # 流式 JSONL
    applookup --markdown 微信                       # 人类可读表格
    applookup --platform ios --extended -            # 从 stdin 读，每行一个
    applookup --schema                              # 输出 JSON schema（LLM function calling 用）

未装也能跑：
    python3 -m cli.main com.tencent.mm
"""
from __future__ import annotations

import argparse
import json
import sys
import os
from typing import Any

# 兼容三种启动方式：
#   1. `python3 -m cli.main`            → __package__='cli'，from .core 走相对导入
#   2. `python3 cli/main.py`            → __package__=None；把 _repo 加 sys.path 后 from cli.core 可用
#   3. PyInstaller frozen .app          → cli.core 已 frozen 进 bundle，from cli.core 直接命中
# 三种走同一条 try：from cli.core import ...；fallback 才用 core
_here = os.path.dirname(os.path.abspath(__file__))
_repo = os.path.dirname(_here)
for _p in (_repo, _here):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    from cli.core import query, query_stream, ROW_FIELDS, OPT_FIELDS, DEFAULT_OPTS  # type: ignore
except ImportError:
    if __package__:
        from .core import query, query_stream, ROW_FIELDS, OPT_FIELDS, DEFAULT_OPTS
    else:
        from core import query, query_stream, ROW_FIELDS, OPT_FIELDS, DEFAULT_OPTS  # type: ignore


def _read_inputs(args: argparse.Namespace) -> list[str]:
    """从 argv / stdin 读输入，按行/逗号/空格切。"""
    raw: list[str] = []
    if args.inputs:
        raw.extend(args.inputs)
    if "-" in args.inputs or args.stdin:
        raw = [x for x in raw if x != "-"]
        for line in sys.stdin.read().splitlines():
            raw.append(line)
    out: list[str] = []
    for item in raw:
        for tok in item.replace("，", ",").replace("；", ";").split():
            for sub in tok.split(","):
                for s in sub.split(";"):
                    s = s.strip()
                    if s:
                        out.append(s)
    # 保序去重
    seen: set[str] = set()
    uniq: list[str] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def _build_opts(args: argparse.Namespace) -> dict:
    return {
        "platform":    args.platform,
        "exact":       args.exact,
        "extended":    args.extended,
        "apk":         args.apk,
        "sha1":        args.sha1,
        "sha256":      args.sha256,
        "description": args.description,
        "interval_ms": args.interval_ms,
    }


def _emit_json(result: dict, indent: int | None) -> None:
    json.dump(result, sys.stdout, ensure_ascii=False, indent=indent)
    sys.stdout.write("\n")


def _emit_jsonl(inputs: list[str], opts: dict) -> int:
    """流式：每行一个 event。返回 exit code。"""
    saw_complete = False
    saw_error = False
    for ev in query_stream(inputs, **opts):
        sys.stdout.write(json.dumps(ev, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        if ev.get("type") == "complete":
            saw_complete = True
        elif ev.get("type") == "error":
            saw_error = True
    if saw_error:
        return 3
    return 0 if saw_complete else 2


def _emit_markdown(result: dict) -> None:
    rows = result["results"]
    if not rows:
        sys.stdout.write("> 无结果\n")
        return
    cols = ["app_name", "platform", "package_name", "category", "source", "download_url"]
    head = ["App", "平台", "包名/Bundle ID", "分类", "商店", "链接"]
    sys.stdout.write("| " + " | ".join(head) + " |\n")
    sys.stdout.write("|" + "|".join(["---"] * len(head)) + "|\n")
    for r in rows:
        cells = []
        for c in cols:
            v = r.get(c) or ""
            cells.append(str(v).replace("|", "\\|").replace("\n", " "))
        sys.stdout.write("| " + " | ".join(cells) + " |\n")
    meta = {k: v for k, v in result.items() if k != "results"}
    sys.stdout.write(f"\n_共 {len(rows)} 条；元信息：{json.dumps(meta, ensure_ascii=False)}_\n")


def _emit_schema() -> None:
    """打印 JSON schema：LLM 做 function-calling 直接用。"""
    schema = {
        "name": "applookup",
        "description": (
            "Query app metadata across iOS App Store and Android stores by package name "
            "(e.g. com.tencent.mm), app name (e.g. 微信 / WeChat), or iOS App Store numeric ID "
            "(e.g. 414478124 or full Apple URL). Backend auto-detects input type. "
            "Returns a flat list of rows; the same query can produce both an iOS row and an "
            "Android row when cross-platform fill is on."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "List of queries — package name, app name (Chinese or English), iOS "
                        "App Store numeric ID, or full Apple URL. Mixed types allowed."
                    ),
                },
                **{
                    k: {
                        "type": ("string" if t == "string" else
                                ("integer" if t == "int" else "boolean")),
                        **({"enum": enum.split("|")} if enum else {}),
                        "default": default,
                        "description": desc,
                    }
                    for k, (t, enum, default, desc) in OPT_FIELDS.items()
                },
            },
            "required": ["queries"],
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "results": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {k: {"description": v} for k, v in ROW_FIELDS.items()},
                    },
                },
                "total_input":   {"type": "integer", "description": "去重前入参数"},
                "deduplicated":  {"type": "integer", "description": "去重数"},
                "invalid_count": {"type": "integer", "description": "无效输入数"},
                "over_limit":    {"type": "integer", "description": "超 10000 上限被截断"},
            },
        },
        "examples": [
            {"queries": ["com.tencent.mm"]},
            {"queries": ["微信", "com.taobao.taobao", "414478124"], "extended": True},
            {"queries": ["WeChat"], "platform": "ios"},
        ],
    }
    json.dump(schema, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="applookup",
        description=(
            "查包名 / app 名 / iOS id 的应用信息（iOS + Android 双端）。\n"
            "Query app metadata by package name, app name, or iOS ID."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  applookup com.tencent.mm 微信 414478124\n"
            "  applookup --jsonl com.tencent.mm\n"
            "  applookup --markdown 微信\n"
            "  echo 'com.tencent.mm\\ncom.taobao.taobao' | applookup -\n"
            "  applookup --schema    # for LLM function-calling\n"
        ),
    )
    p.add_argument("inputs", nargs="*", help="包名 / app 名 / iOS id / Apple URL（混合可）。'-' = 从 stdin 读")
    p.add_argument("--stdin", action="store_true", help="从 stdin 读输入（每行一个）")

    fmt = p.add_mutually_exclusive_group()
    fmt.add_argument("--json", dest="fmt", action="store_const", const="json", help="JSON 数组（默认）")
    fmt.add_argument("--jsonl", dest="fmt", action="store_const", const="jsonl", help="流式 JSONL（每行一个事件）")
    fmt.add_argument("--markdown", "-m", dest="fmt", action="store_const", const="markdown", help="Markdown 表格")
    p.set_defaults(fmt="json")

    p.add_argument("--platform", choices=["all", "ios", "android"], default="all", help="平台筛选")
    p.add_argument("--exact", action="store_true", help="精确匹配（按 app 名查时才生效）")
    ext = p.add_mutually_exclusive_group()
    ext.add_argument("--extended", dest="extended", action="store_true", default=True, help="跨端补齐（默认开）")
    ext.add_argument("--no-extended", dest="extended", action="store_false", help="关闭跨端补齐")

    p.add_argument("--apk", action="store_true", help="抓 APK 直链（耗时）")
    p.add_argument("--sha1", action="store_true", help="抓 APK SHA1（需 --apk）")
    p.add_argument("--sha256", action="store_true", help="抓 APK SHA256（需 --apk）")
    p.add_argument("--description", action="store_true", help="抓应用介绍（iOS 默认有）")
    p.add_argument("--interval-ms", dest="interval_ms", type=int, default=0, help="查询间隔毫秒（防限流）")
    p.add_argument("--indent", type=int, default=2, help="JSON 缩进（默认 2，0=单行）")
    p.add_argument("--schema", action="store_true", help="输出 JSON schema（LLM function-calling 用），不查询")

    args = p.parse_args(argv)

    if args.schema:
        _emit_schema()
        return 0

    inputs = _read_inputs(args)
    if not inputs:
        sys.stderr.write("error: 没有输入。例：applookup com.tencent.mm\n")
        return 2

    opts = _build_opts(args)

    try:
        if args.fmt == "jsonl":
            return _emit_jsonl(inputs, opts)
        result = query(inputs, **opts)
        if args.fmt == "markdown":
            _emit_markdown(result)
        else:
            _emit_json(result, indent=(None if args.indent == 0 else args.indent))
        if not result["results"] and result.get("invalid_count", 0) >= len(inputs):
            return 1
        return 0
    except KeyboardInterrupt:
        sys.stderr.write("\n^C 中断\n")
        return 130
    except Exception as e:
        sys.stderr.write(f"error: {e}\n")
        return 3


if __name__ == "__main__":
    sys.exit(main())
