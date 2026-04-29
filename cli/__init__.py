"""applookup CLI / MCP 共用核心 + 入口。

设计原则（2026-04-29）：
- 不动 app.py 一行（feedback_ui_only.md：后端逻辑照搬）
- 嵌入式：直接 `import app` 复用 _parse_query_input + _job_worker，不依赖 9527 服务
- core.query(...) 一个函数同时被 CLI 和 MCP server 调用，返回 / 字段 / 错误码完全一致
"""
