# -*- mode: python ; coding: utf-8 -*-
# Mac .app 多 entry 打包：单一 .app 内含 3 个 binary
#   Contents/MacOS/lookup_appinfo_mac    ← 主 web 服务（双击 .app 默认跑这个）
#   Contents/MacOS/applookup             ← CLI 入口（命令行直接调）
#   Contents/MacOS/applookup-mcp         ← MCP server（挂 Claude Desktop / Code）
#
# 用 PyInstaller MERGE 让三个 Analysis 共享 Python.framework / Frameworks，
# 避免三份 Python runtime 副本（按 self_review 档案 T-3 的教训防体积爆炸）。
#
# 改 spec 前先 rm -rf build dist —— 半截产物混进新 build 是已知踩坑。
#
# x86_64 兼容：mcp 包要求 Python 3.10+，x86 venv（macOS /usr/bin/python3 = 3.9）
# 装不了 mcp。下方 HAS_MCP 探测：mcp 没装就跳过 applookup-mcp 这一 entry，
# x86_64 .app 仅含 web + CLI；arm64 venv 有 mcp 则三个 entry 全打。
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

HAS_MCP = False
try:
    import mcp  # noqa: F401
    HAS_MCP = True
    print("[spec] mcp detected → building 3 entries (web + CLI + MCP)")
except ImportError:
    print("[spec] mcp NOT installed → building 2 entries (web + CLI), skipping MCP server")


def _collect_no_cli(pkg):
    """collect_all 等价物，但跳过 *.cli.* 子模块。
    mcp 包的 mcp.cli.cli 会在 import 时调 typer（可选依赖），typer 没装就 sys.exit(1)，
    导致 PyInstaller 的 collect_submodules 子进程崩溃。我们只用 mcp.server.*，
    cli 子包根本不需要打进去。"""
    try:
        hidden = collect_submodules(pkg, filter=lambda m: '.cli' not in m and not m.endswith('.cli'))
    except Exception:
        hidden = [pkg]
    try:
        datas = collect_data_files(pkg)
    except Exception:
        datas = []
    return datas, [], hidden

# ===== 共享：所有 entry 都需要的 datas（templates + static）+ PIL =====
shared_datas = [('templates', 'templates'), ('static', 'static')]
shared_binaries = []
# [slim 2026-04-23] 从 hiddenimports 里拿掉 lxml：venv 里已卸载，app.py 自动回退到 html.parser
shared_hidden = ['requests', 'bs4', 'openpyxl', 'cryptography',
                 'qrcode', 'qrcode.image.pil']

# PIL 的所有 dylib / 子模块都让 PyInstaller 自动收集
_pil_datas, _pil_binaries, _pil_hidden = collect_all('PIL')
shared_datas    += _pil_datas
shared_binaries += _pil_binaries
shared_hidden   += _pil_hidden


# ===== entry 1：lookup_appinfo_mac（web 服务）=====
a_web = Analysis(
    ['app.py'],
    pathex=[],
    binaries=shared_binaries,
    datas=shared_datas,
    hiddenimports=shared_hidden + ['tkinter'],  # tkinter 必须有否则 .app 静默崩
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)


# ===== entry 2：applookup（CLI）=====
# cli/main.py → cli.core → import app  ⇒ hiddenimports 里要有 'app'
a_cli = Analysis(
    ['cli/main.py'],
    pathex=['.'],
    binaries=[],
    datas=shared_datas,  # cli 内 import app 时 app 找 templates/static
    hiddenimports=shared_hidden + ['app', 'cli', 'cli.core', 'tkinter'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)


# ===== entry 3（条件）：applookup-mcp（MCP server）=====
# 仅当 venv 装了 mcp 才打这个 entry。x86_64 Python 3.9 venv 不支持 mcp，
# 此分支跳过，x86_64 .app 仅含 web + CLI。
if HAS_MCP:
    _mcp_datas, _mcp_binaries, _mcp_hidden = _collect_no_cli('mcp')
    _mcp_runtime_extras = []
    for pkg in ('pydantic', 'pydantic_core', 'anyio', 'httpx', 'httpx_sse',
                'sniffio', 'starlette'):
        try:
            d, b, h = collect_all(pkg)
            _mcp_datas += d; _mcp_binaries += b; _mcp_runtime_extras += h
        except Exception:
            pass

    a_mcp = Analysis(
        ['cli/mcp_server.py'],
        pathex=['.'],
        binaries=_mcp_binaries,
        datas=shared_datas + _mcp_datas,
        hiddenimports=(shared_hidden + _mcp_hidden + _mcp_runtime_extras +
                       ['app', 'cli', 'cli.core',
                        'mcp', 'mcp.server', 'mcp.server.stdio', 'mcp.types',
                        'tkinter']),
        hookspath=[],
        hooksconfig={},
        runtime_hooks=[],
        excludes=[],
        noarchive=False,
        optimize=0,
    )


# ===== MERGE：让 Analysis 共享公共依赖 =====
if HAS_MCP:
    MERGE(
        (a_web, 'lookup_appinfo_mac', 'lookup_appinfo_mac'),
        (a_cli, 'applookup', 'applookup'),
        (a_mcp, 'applookup-mcp', 'applookup-mcp'),
    )
else:
    MERGE(
        (a_web, 'lookup_appinfo_mac', 'lookup_appinfo_mac'),
        (a_cli, 'applookup', 'applookup'),
    )


# ===== PYZ =====
pyz_web = PYZ(a_web.pure)
pyz_cli = PYZ(a_cli.pure)
if HAS_MCP:
    pyz_mcp = PYZ(a_mcp.pure)


# ===== 三个 EXE =====
# console=False 让 .app 双击不弹 terminal；CLI / MCP 用命令行调时仍能 stdout/stderr
exe_web = EXE(
    pyz_web,
    a_web.scripts,
    [],
    exclude_binaries=True,
    name='lookup_appinfo_mac',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

exe_cli = EXE(
    pyz_cli,
    a_cli.scripts,
    [],
    exclude_binaries=True,
    name='applookup',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,   # CLI 需要 stdout 给用户看 JSON / Markdown
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
)

if HAS_MCP:
    exe_mcp = EXE(
        pyz_mcp,
        a_mcp.scripts,
        [],
        exclude_binaries=True,
        name='applookup-mcp',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        console=True,   # MCP 走 stdio JSON-RPC，需要 stdin/stdout
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
    )


# ===== COLLECT 全部 EXE 到一个 dist 目录 =====
if HAS_MCP:
    coll = COLLECT(
        exe_web, a_web.binaries, a_web.datas,
        exe_cli, a_cli.binaries, a_cli.datas,
        exe_mcp, a_mcp.binaries, a_mcp.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='lookup_appinfo_mac',
    )
else:
    coll = COLLECT(
        exe_web, a_web.binaries, a_web.datas,
        exe_cli, a_cli.binaries, a_cli.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='lookup_appinfo_mac',
    )


# ===== BUNDLE 成 .app =====
# .app 主入口（双击启动那个）= CFBundleExecutable = exe_web 的 name
# 其余 binary 跟 web 同住 Contents/MacOS/，可独立调用
app = BUNDLE(
    coll,
    name='lookup_appinfo_mac.app',
    icon='icon_src/app_icon.icns',
    bundle_identifier=None,
)
