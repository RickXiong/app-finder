"""applookup MCP server — Claude Desktop / Claude Code 直接挂载。

启动方式（用户在 ~/.claude/claude_desktop_config.json 或 mcp.json 里配置）：
    {
      "mcpServers": {
        "applookup": {
          "command": "/path/to/.venv-dev/bin/python3",
          "args": ["-m", "cli.mcp_server"],
          "cwd": "/Users/xrick/app_finder_web"
        }
      }
    }

或直接 stdio 跑（开发调试）：
    python3 -m cli.mcp_server

依赖：
    pip install mcp

工具：
    lookup_app(queries, platform=..., extended=..., apk=..., sha1=..., sha256=..., description=..., interval_ms=...)
"""
from __future__ import annotations

import asyncio
import json
import sys
import os
from typing import Any

# 兼容 -m / 直接跑 / PyInstaller frozen 三种入口（同 cli/main.py 注释）
_here = os.path.dirname(os.path.abspath(__file__))
_repo = os.path.dirname(_here)
for _p in (_repo, _here):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    from cli.core import query, ROW_FIELDS, OPT_FIELDS  # type: ignore
except ImportError:
    if __package__:
        from .core import query, ROW_FIELDS, OPT_FIELDS
    else:
        from core import query, ROW_FIELDS, OPT_FIELDS  # type: ignore

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent


server = Server("applookup")


TOOL_DESCRIPTION = (
    "Query app metadata across iOS App Store and major Android stores (Tencent / Xiaomi / "
    "Huawei / OPPO / Sogou / 360 / etc.) by **package name** (e.g. `com.tencent.mm`), "
    "**app name** in any language (e.g. `微信`, `WeChat`, `TikTok`), or **iOS App Store numeric ID** "
    "(e.g. `414478124` or a full Apple URL). Backend auto-detects input type per item, "
    "so a single call may mix all three. By default `extended=true` cross-fills the other "
    "platform when found on one (so a single `com.tencent.mm` returns both the Android and "
    "iOS row for 微信). Returns app name, icon, category, store URL, and optional SHA / "
    "APK direct URL / description. Use this when the user asks 'what is com.x.y?', 'find the "
    "package name for 抖音', 'is this iOS or Android only?', or wants store links to share."
)


def _build_input_schema() -> dict[str, Any]:
    type_map = {"string": "string", "int": "integer", "bool": "boolean"}
    props: dict[str, Any] = {
        "queries": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "List of queries. Each item can be a package name (e.g. `com.tencent.mm`), "
                "an app name in any language (e.g. `微信`, `WeChat`, `Microsoft Teams`), "
                "an iOS App Store numeric ID (e.g. `414478124`), or a full Apple URL "
                "(e.g. `https://apps.apple.com/cn/app/id414478124`). Mixing types is fine."
            ),
            "minItems": 1,
        },
    }
    for k, (t, enum, default, desc) in OPT_FIELDS.items():
        node: dict[str, Any] = {"type": type_map[t], "default": default, "description": desc}
        if enum:
            node["enum"] = enum.split("|")
        props[k] = node
    return {
        "type": "object",
        "properties": props,
        "required": ["queries"],
        "additionalProperties": False,
    }


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="lookup_app",
            description=TOOL_DESCRIPTION,
            inputSchema=_build_input_schema(),
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name != "lookup_app":
        return [TextContent(type="text", text=json.dumps(
            {"error": f"unknown tool: {name}"}, ensure_ascii=False))]

    queries = arguments.get("queries") or []
    if not isinstance(queries, list) or not queries:
        return [TextContent(type="text", text=json.dumps(
            {"error": "queries must be a non-empty array of strings"}, ensure_ascii=False))]

    opts = {k: v for k, v in arguments.items() if k != "queries"}

    # 在线程池里跑（query 是同步阻塞的，避免拖死 asyncio loop）
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: query(queries, **opts))
    except Exception as e:
        return [TextContent(type="text", text=json.dumps(
            {"error": f"query failed: {e}"}, ensure_ascii=False))]

    # 给 LLM 的精简回包：人类可读 summary + 完整 JSON
    n = len(result["results"])
    ios = sum(1 for r in result["results"] if r.get("platform") == "iOS")
    android = sum(1 for r in result["results"] if r.get("platform") == "Android")
    summary = (f"Found {n} results ({ios} iOS, {android} Android) "
               f"from {result.get('total_input', 0)} input(s).")
    payload = {"summary": summary, **result}
    return [TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))]


async def _run() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
