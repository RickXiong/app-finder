#!/usr/bin/env python3
"""
App信息查询工具 - Web版
通过包名查找App的名称和下载地址
"""

import csv
import io
import json
import math
import os
import sys
import re
import struct
import time
import zlib
import concurrent.futures
import urllib.parse

from flask import Flask, render_template, request, jsonify, send_file, Response, stream_with_context
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.drawing.image import Image as XLImage
import requests
from bs4 import BeautifulSoup
try:
    from PIL import Image as PILImage
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    from cryptography.hazmat.primitives.serialization import pkcs7 as crypto_pkcs7
    from cryptography.hazmat.primitives import hashes as crypto_hashes
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False


# PyInstaller 打包后资源路径处理
def resource_path(relative_path):
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, relative_path)


app = Flask(
    __name__,
    template_folder=resource_path('templates'),
    static_folder=resource_path('static'),
)


# ========== 工具函数 ==========

def clean_package_name(name):
    """清理包名：去掉前后空格、不可见字符、特殊符号"""
    name = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0\r\n\t\u2028\u2029\u200e\u200f\u202a-\u202e]', '', name)
    name = name.strip()
    # 包名只允许字母、数字、点、下划线、连字符
    if name and not re.match(r'^[a-zA-Z0-9._\-]+$', name):
        return ''
    return name


def clean_app_name(name):
    """清理App名称：去掉副标题/介绍部分"""
    for sep in [' - ', '-', '—', '－', ' – ', ':', '：', '|']:
        if sep in name:
            left = name.split(sep)[0].strip()
            # 只在左边部分有实际内容时才截断（避免名字本身就很短的情况）
            if len(left) >= 1:
                name = left
                break
    return name.strip()


def clean_ios_url(url):
    """简化iOS App Store链接"""
    match = re.search(r'(https://apps\.apple\.com/\w+/app/)(.*?)(id\d+)', url)
    if match:
        return f"{match.group(1)}{match.group(3)}"
    return url


def is_package_name(s):
    """判断输入是否为包名格式（含点号的字母数字组合）"""
    return bool(re.match(r'^[a-zA-Z0-9._\-]+$', s)) and '.' in s


def is_name_relevant(search_term, app_name):
    """判断App名称是否与搜索词相关"""
    if not app_name or app_name == "未找到":
        return False
    s = search_term.lower().strip()
    a = app_name.lower().strip()
    # 互相包含即为相关
    return s in a or a in s


# ========== 按名称搜索 ==========

def search_apple_by_name(name, limit=3):
    """Apple iTunes Search API - 按名称搜索"""
    url = f"https://itunes.apple.com/search?term={urllib.parse.quote(name)}&country=cn&entity=software&limit={limit}"
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return []
        data = resp.json()
        results = []
        for app_info in data.get("results", []):
            bundle_id = app_info.get("bundleId", "")
            if not bundle_id:
                continue
            raw_name = app_info.get("trackName", "未知")
            app_name = clean_app_name(raw_name)
            raw_url = app_info.get("trackViewUrl", "")
            download_url = clean_ios_url(raw_url)
            icon_url = app_info.get("artworkUrl100", "") or app_info.get("artworkUrl60", "")
            genres = app_info.get("genres", [])
            category = genres[0] if genres else ""
            results.append({
                "package_name": bundle_id,
                "platform": "iOS",
                "app_name": app_name,
                "download_url": download_url,
                "icon_url": icon_url,
                "category": category,
            })
        return results
    except Exception:
        return []


def search_xiaomi_by_name(name):
    """小米应用商店 - 按名称搜索，提取包名列表"""
    url = f"http://app.mi.com/search?keywords={urllib.parse.quote(name)}"
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        seen = set()
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            match = re.search(r'details\?id=([a-zA-Z0-9._\-]+)', href)
            if match:
                pkg = match.group(1)
                if pkg not in seen:
                    seen.add(pkg)
                    results.append(pkg)
                    if len(results) >= 3:
                        break
        return results
    except Exception:
        return []


def search_tencent_by_name(name):
    """腾讯应用宝 - 按名称搜索，提取包名列表"""
    url = f"https://sj.qq.com/myapp/search.htm?kw={urllib.parse.quote(name)}"
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        seen = set()
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            match = re.search(r'appdetail/([a-zA-Z0-9._\-]+)', href)
            if match:
                pkg = match.group(1)
                if pkg not in seen:
                    seen.add(pkg)
                    results.append(pkg)
                    if len(results) >= 3:
                        break
        return results
    except Exception:
        return []


def _wandoujia_headers():
    return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }


def _parse_wandoujia_detail(detail_url, headers):
    """解析豌豆荚详情页，提取包名、App名、图标、分类"""
    try:
        dr = requests.get(detail_url, headers=headers, timeout=10)
        if dr.status_code != 200:
            return None
        ds = BeautifulSoup(dr.text, "html.parser")

        # 包名：body data-pn 或 data-app-pname
        body = ds.find("body")
        pkg = body.get("data-pn", "") if body else ""
        if not pkg:
            el = ds.find(attrs={"data-app-pname": True})
            pkg = el.get("data-app-pname", "") if el else ""
        if not is_package_name(pkg):
            return None

        # App名称：标题格式 "微信下载2026安卓最新版_..."
        title_tag = ds.find("title")
        app_name = pkg
        if title_tag:
            t = title_tag.text.strip()
            m = re.match(r'^(.+?)下载', t)
            app_name = m.group(1).strip() if m else t.split("_")[0].strip()
            app_name = clean_app_name(app_name)

        # 图标：优先 25pp.com（豌豆荚App素材CDN）
        icon_url = ""
        for img in ds.find_all("img", src=True):
            if "25pp.com" in img["src"]:
                icon_url = img["src"]
                break

        # 分类：最细一级
        category = ""
        cat_links = ds.find_all("a", href=re.compile(r'/category/'))
        if cat_links:
            category = cat_links[-1].text.strip()

        return {
            "package_name": pkg,
            "platform": "Android",
            "app_name": app_name,
            "download_url": detail_url,
            "icon_url": icon_url,
            "category": category,
        }
    except Exception:
        return None


def search_wandoujia_by_name(name, limit=3):
    """豌豆荚两步搜索：名称→搜索页（含App名过滤）→详情页→包名+App信息"""
    headers = _wandoujia_headers()
    try:
        search_url = f"https://www.wandoujia.com/search?key={urllib.parse.quote(name)}"
        resp = requests.get(search_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")

        # 提取 (app_id, app_name) 对，同一 ID 只取一次
        candidates = []  # [(app_id, link_text)]
        seen_ids = set()
        for a in soup.find_all("a", href=True):
            m = re.search(r'/apps/(\d+)', a["href"])
            if m:
                aid = m.group(1)
                link_text = a.get_text(strip=True)
                if aid not in seen_ids and link_text:
                    seen_ids.add(aid)
                    candidates.append((aid, link_text))

        if not candidates:
            return []

        # 优先取名称相关的结果
        relevant = [(aid, t) for aid, t in candidates if is_name_relevant(name, t)]
        if not relevant:
            relevant = candidates  # 无精确匹配时全取
        app_ids = [aid for aid, _ in relevant[:limit]]

        # 并发请求详情页
        detail_urls = [f"https://www.wandoujia.com/apps/{aid}" for aid in app_ids]
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(detail_urls)) as exe:
            for r in exe.map(lambda u: _parse_wandoujia_detail(u, headers), detail_urls):
                if r:
                    results.append(r)
        return results
    except Exception:
        return []


def search_wandoujia(package_name):
    """豌豆荚 - 按包名查询（搜索+精确匹配）"""
    headers = _wandoujia_headers()
    try:
        search_url = f"https://www.wandoujia.com/search?key={urllib.parse.quote(package_name)}"
        resp = requests.get(search_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")

        app_ids = []
        seen = set()
        for a in soup.find_all("a", href=True):
            m = re.search(r'/apps/(\d+)', a["href"])
            if m:
                aid = m.group(1)
                if aid not in seen:
                    seen.add(aid)
                    app_ids.append(aid)
                    if len(app_ids) >= 5:
                        break

        for aid in app_ids:
            r = _parse_wandoujia_detail(f"https://www.wandoujia.com/apps/{aid}", headers)
            if r and r["package_name"] == package_name:
                r["source"] = "豌豆荚"
                return r
    except Exception:
        pass
    return None


def search_appchina_by_name(name, limit=3):
    """应用汇 - 按名称搜索，返回包名列表"""
    url = f"http://www.appchina.com/search/?keywords={urllib.parse.quote(name)}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        seen = set()
        # 应用汇搜索结果页：每个app有个链接如 /app/com.xxx.xxx
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            m = re.search(r'/app/([a-zA-Z0-9._\-]+)', href)
            if m:
                pkg = m.group(1)
                if is_package_name(pkg) and pkg not in seen:
                    seen.add(pkg)
                    results.append(pkg)
                    if len(results) >= limit:
                        break
        return results
    except Exception:
        return []


def search_xiaomi_by_name_full(name, limit=3):
    """小米应用商店 - 按名称搜索，返回完整结果（含App信息）"""
    pkg_list = search_xiaomi_by_name(name)
    results = []
    for pkg in pkg_list[:limit]:
        r = search_xiaomi(pkg)
        if r and is_name_relevant(name, r.get("app_name", "")):
            r["package_name"] = pkg
            r["platform"] = "Android"
            results.append(r)
    return results


def search_tencent_by_name_full(name, limit=3):
    """腾讯应用宝 - 按名称搜索，返回完整结果"""
    pkg_list = search_tencent_by_name(name)
    results = []
    for pkg in pkg_list[:limit]:
        r = search_tencent(pkg)
        if r and is_name_relevant(name, r.get("app_name", "")):
            r["package_name"] = pkg
            r["platform"] = "Android"
            results.append(r)
    return results


def search_appchina_by_name_full(name, limit=3):
    """应用汇 - 按名称搜索，返回完整结果"""
    pkg_list = search_appchina_by_name(name, limit)
    results = []
    for pkg in pkg_list:
        r = search_appchina(pkg)
        if r and is_name_relevant(name, r.get("app_name", "")):
            r["package_name"] = pkg
            r["platform"] = "Android"
            results.append(r)
    return results


def search_pp(package_name):
    """PP助手 - 按包名查询"""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    # 尝试通过搜索找到对应应用
    try:
        search_url = f"https://www.pp.cn/soft/search.html?q={urllib.parse.quote(package_name)}"
        resp = requests.get(search_url, headers=headers, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        # 在搜索结果中找包含包名的应用链接
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            if package_name in href or package_name in resp.text:
                break
        # 尝试从页面文本中提取包名匹配的应用
        if package_name not in resp.text:
            return None
        # 提取App名称（页面标题或第一个结果标题）
        title_tag = soup.find("title")
        app_name_tag = soup.find("h2") or soup.find("h3") or soup.find("strong")
        app_name = app_name_tag.get_text(strip=True) if app_name_tag else ""
        app_name = clean_app_name(app_name) if app_name else ""
        if not app_name:
            return None
        # 找应用详情链接
        detail_url = ""
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if re.search(r'/soft/\d+/', href) or re.search(r'/app/\d+', href):
                detail_url = href if href.startswith("http") else "https://www.pp.cn" + href
                break
        if not detail_url:
            detail_url = search_url
        return {
            "source": "PP助手",
            "app_name": app_name,
            "download_url": detail_url,
            "icon_url": "",
            "category": "",
        }
    except Exception:
        pass
    return None


def search_appchina(package_name):
    """应用汇 - 按包名查询"""
    url = f"http://www.appchina.com/app/{package_name}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        resp = requests.get(url, headers=headers, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        name_tag = soup.find("h1", class_="app-name")
        if not name_tag:
            return None
        app_name = name_tag.get_text(strip=True)
        if not app_name or "404" in app_name:
            return None
        icon_tag = soup.find("img", class_="Content_Icon")
        icon_url = icon_tag.get("src", "") if icon_tag else ""
        m = re.search(r'McDonald[/\w]*?/(\d{6,8})/', resp.text)
        apk_direct_url = (
            f"http://mobile.d.appchina.com/McDonald/r/{m.group(1)}/{package_name}.vapk"
            if m else ""
        )
        return {
            "source": "应用汇",
            "app_name": app_name,
            "download_url": url,
            "icon_url": icon_url,
            "category": "",
            "apk_direct_url": apk_direct_url,
        }
    except Exception:
        pass
    return None


def _get_wandoujia_apk_url(package_name):
    """从豌豆荚获取 APK 直链（仅用于多来源模式）"""
    wdj_headers = _wandoujia_headers()
    req_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        search_url = f"https://www.wandoujia.com/search?key={urllib.parse.quote(package_name)}"
        resp = requests.get(search_url, headers=wdj_headers, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return ""
        soup = BeautifulSoup(resp.text, "html.parser")
        for a in soup.find_all("a", href=True):
            m = re.search(r'/apps/(\d+)', a["href"])
            if m:
                wdj_id = m.group(1)
                r = _parse_wandoujia_detail(
                    f"https://www.wandoujia.com/apps/{wdj_id}", wdj_headers
                )
                if r and r.get("package_name") == package_name:
                    dl_url = (
                        f"https://www.wandoujia.com/apps/{wdj_id}/download/dot"
                        f"?ch=detail_qr_dl&pos=detail-ndownload-{package_name}"
                    )
                    dl_r = requests.get(
                        dl_url, headers=req_headers,
                        allow_redirects=True, timeout=HTTP_TIMEOUT * 2
                    )
                    if ".apk" in dl_r.url:
                        return dl_r.url
                    break
    except Exception:
        pass
    return ""


def _extract_sha1_from_apk_url(apk_url):
    """通过 Range 请求只下载 APK 证书部分，计算 SHA1 指纹。
    优先尝试 APK v2/v3 签名块（现代 APK），回退到 v1 META-INF/*.RSA。"""
    if not HAS_CRYPTOGRAPHY:
        return ""
    from cryptography import x509 as crypto_x509
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        # 1. 获取文件大小
        r = requests.head(apk_url, headers=headers, timeout=10, allow_redirects=True)
        fsize = int(r.headers.get("Content-Length", 0))
        if not fsize:
            return ""

        # 2. 下载末尾 64KB，找 ZIP EOCD 和 Central Directory 位置
        tail_size = min(65536, fsize)
        r = requests.get(
            apk_url,
            headers={**headers, "Range": f"bytes={fsize - tail_size}-{fsize - 1}"},
            timeout=15, allow_redirects=True
        )
        tail = r.content
        eocd_pos = tail.rfind(b'PK\x05\x06')
        if eocd_pos < 0:
            return ""
        eocd = tail[eocd_pos:]
        cd_size   = struct.unpack_from('<L', eocd, 12)[0]
        cd_offset = struct.unpack_from('<L', eocd, 16)[0]

        # ── 尝试 APK v2/v3 签名块（位于 Central Directory 之前）─────────
        APK_SIG_MAGIC = b'APK Sig Block 42'
        APK_V2_ID = 0x7109871a
        APK_V3_ID = 0xf05368c0
        if cd_offset > 32:
            r2 = requests.get(
                apk_url,
                headers={**headers, "Range": f"bytes={cd_offset - 32}-{cd_offset - 1}"},
                timeout=10, allow_redirects=True
            )
            footer = r2.content
            if len(footer) >= 24 and footer[-16:] == APK_SIG_MAGIC:
                block_size = struct.unpack_from('<Q', footer, len(footer) - 24)[0]
                block_start = cd_offset - block_size - 8
                if block_start >= 0:
                    r3 = requests.get(
                        apk_url,
                        headers={**headers, "Range": f"bytes={block_start}-{cd_offset - 1}"},
                        timeout=20, allow_redirects=True
                    )
                    block = r3.content
                    bp = 8
                    end_pairs = len(block) - 24
                    while bp < end_pairs:
                        pl = struct.unpack_from('<Q', block, bp)[0]
                        pid = struct.unpack_from('<I', block, bp + 8)[0]
                        if pid in (APK_V2_ID, APK_V3_ID):
                            val = block[bp + 12: bp + 8 + pl]
                            try:
                                sp = 4
                                slen = struct.unpack_from('<I', val, sp)[0]
                                sd = val[sp + 4: sp + 4 + slen]
                                sdlen = struct.unpack_from('<I', sd, 0)[0]
                                signed = sd[4: 4 + sdlen]
                                dlen = struct.unpack_from('<I', signed, 0)[0]
                                cs = 4 + dlen
                                cp = cs + 4
                                clen = struct.unpack_from('<I', signed, cp)[0]
                                cert_der = signed[cp + 4: cp + 4 + clen]
                                cert = crypto_x509.load_der_x509_certificate(cert_der)
                                sha1_bytes = cert.fingerprint(crypto_hashes.SHA1())
                                return ":".join(f"{b:02X}" for b in sha1_bytes)
                            except Exception:
                                pass
                        bp += 8 + pl

        # ── 回退到 v1 签名：META-INF/*.RSA / *.DSA / *.EC ────────────────
        r = requests.get(
            apk_url,
            headers={**headers, "Range": f"bytes={cd_offset}-{cd_offset + cd_size - 1}"},
            timeout=15, allow_redirects=True
        )
        cd = r.content

        pos = 0
        cert_info = None
        while pos < len(cd) - 4:
            if cd[pos:pos + 4] != b'PK\x01\x02':
                break
            fn_len  = struct.unpack_from('<H', cd, pos + 28)[0]
            ex_len  = struct.unpack_from('<H', cd, pos + 30)[0]
            cm_len  = struct.unpack_from('<H', cd, pos + 32)[0]
            lh_off  = struct.unpack_from('<L', cd, pos + 42)[0]
            comp_sz = struct.unpack_from('<L', cd, pos + 20)[0]
            method  = struct.unpack_from('<H', cd, pos + 10)[0]
            fname   = cd[pos + 46:pos + 46 + fn_len].decode('utf-8', errors='replace')
            if re.match(r'META-INF/[^/]+\.(RSA|DSA|EC)$', fname, re.I):
                cert_info = (lh_off, comp_sz, method)
                break
            pos += 46 + fn_len + ex_len + cm_len

        if not cert_info:
            return ""
        lh_off, comp_sz, method = cert_info

        end = lh_off + 30 + 512 + comp_sz
        r = requests.get(
            apk_url,
            headers={**headers, "Range": f"bytes={lh_off}-{end}"},
            timeout=15, allow_redirects=True
        )
        local = r.content
        fn_l = struct.unpack_from('<H', local, 26)[0]
        ex_l = struct.unpack_from('<H', local, 28)[0]
        data = local[30 + fn_l + ex_l: 30 + fn_l + ex_l + comp_sz]
        if method == 8:
            data = zlib.decompress(data, -15)

        certs = crypto_pkcs7.load_der_pkcs7_certificates(data)
        if not certs:
            return ""
        sha1_bytes = certs[0].fingerprint(crypto_hashes.SHA1())
        return ":".join(f"{b:02X}" for b in sha1_bytes)
    except Exception:
        return ""


def _has_android_match(ios_name, android_results):
    """判断 iOS app 是否已有对应的安卓版本（严格匹配，防止"抖音"误匹配"抖音极速版"）"""
    for ar in android_results:
        an = ar["app_name"].strip()
        ios = ios_name.strip()
        if ios == an:
            return True
        # 长短比例超过 60% 才算相关（避免子集误判）
        shorter, longer = sorted([ios, an], key=len)
        if shorter and shorter in longer and len(shorter) >= len(longer) * 0.6:
            return True
    return False


def query_by_name(name, android_store_order=None, exact_search=False):
    """按App名称搜索，iOS + Android 互补：
    1. 并发：Apple API（iOS）+ Android 各商店（多商店回退）
    2. 对没有安卓对应的 iOS app，补搜安卓商店
    3. 对安卓结果，用优先商店丰富下载链接/分类/图标
    exact_search=True 时只返回与搜索词完全一致的 App
    """
    if android_store_order is None:
        android_store_order = DEFAULT_ANDROID_STORES

    # === 第一轮：并发 iOS + Android 多商店搜索 ===
    # 按 android_store_order 的顺序依次尝试，直到找到结果为止
    def _search_android_by_name(name, store_order):
        """按商店优先级搜索，找到结果即停，返回结果列表"""
        for store_id in store_order:
            func = STORE_NAME_SEARCH_FUNCS.get(store_id)
            if not func:
                continue
            try:
                results = func(name)
                if results:
                    # wandoujia 返回的是包含完整字段的列表，其他返回的也是
                    return results
            except Exception:
                continue
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_ios = executor.submit(search_apple_by_name, name, 5)
        future_android = executor.submit(_search_android_by_name, name, android_store_order)
        apple_results = future_ios.result()
        android_results_raw = future_android.result()

    # iOS 相关结果（最多3个）
    if exact_search:
        relevant_ios = [r for r in apple_results if r["app_name"].strip().lower() == name.strip().lower()]
    else:
        relevant_ios = [r for r in apple_results if is_name_relevant(name, r["app_name"])]
    if not relevant_ios and apple_results and not exact_search:
        relevant_ios = apple_results[:1]
    relevant_ios = relevant_ios[:3]

    # === 第二轮：为没有安卓对应的 iOS app 补搜安卓商店 ===
    ios_without_android = [
        r for r in relevant_ios
        if not _has_android_match(r["app_name"], android_results_raw)
    ]
    extra_android = []
    if ios_without_android:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(2, len(ios_without_android))) as exe:
            futures = {
                exe.submit(_search_android_by_name, r["app_name"], android_store_order): r
                for r in ios_without_android[:2]
            }
            for f, ios_r in futures.items():
                for ar in (f.result() or []):
                    # 严格匹配：安卓名和 iOS 名须高度相似
                    if _has_android_match(ios_r["app_name"], [ar]):
                        extra_android.append(ar)
                        break

    all_android = android_results_raw + extra_android

    # === 第三轮：按用户商店优先级丰富安卓结果（下载链接、分类、图标）===
    # 规则：遍历 android_store_order，遇到 wandoujia 时说明豌豆荚就是优先商店，
    # 保留已有的豌豆荚数据；遇到其他商店时尝试获取并替换。
    def enrich_android(ar):
        """按用户配置优先级替换/补全安卓信息"""
        pkg = ar["package_name"]
        for store_id in android_store_order:
            if store_id == "wandoujia":
                # 豌豆荚是这个优先级，数据已有，直接使用
                return ar
            func = STORE_SEARCH_FUNCS.get(store_id)
            if not func:
                continue
            try:
                r = func(pkg)
                if r:
                    enriched = dict(ar)
                    enriched["download_url"] = r["download_url"]
                    if r.get("category") and not enriched.get("category"):
                        enriched["category"] = r["category"]
                    if r.get("icon_url") and not enriched.get("icon_url"):
                        enriched["icon_url"] = r["icon_url"]
                    return enriched
            except Exception:
                continue
        return ar

    # 精确搜索时：安卓结果也过滤
    if exact_search:
        all_android = [r for r in all_android if r["app_name"].strip().lower() == name.strip().lower()]

    enriched_map = {}
    if all_android:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(all_android))) as exe:
            for ar, enriched in zip(all_android, exe.map(enrich_android, all_android)):
                enriched_map[ar["package_name"]] = enriched

    def get_android(ar):
        return enriched_map.get(ar["package_name"], ar)

    # === 组装结果：iOS + 配对安卓，成对排列 ===
    # 用 (package_name, platform) 做唯一键，防止 iOS/Android 包名相同时互相覆盖
    rows = []
    seen_keys = set()   # (pkg, platform)
    used_android = set()  # 已配对的安卓包名

    for ios_r in relevant_ios:
        ios_key = (ios_r["package_name"], "iOS")
        if ios_key in seen_keys:
            continue
        seen_keys.add(ios_key)
        rows.append({
            "package_name": ios_r["package_name"],
            "platform": "iOS",
            "app_name": ios_r["app_name"],
            "download_url": ios_r["download_url"],
            "icon_url": ios_r.get("icon_url", ""),
            "category": ios_r.get("category", ""),
        })
        # 找配对安卓（严格名称匹配）
        for ar in all_android:
            a_key = (ar["package_name"], "Android")
            if a_key not in seen_keys and _has_android_match(ios_r["app_name"], [ar]):
                seen_keys.add(a_key)
                used_android.add(ar["package_name"])
                rows.append(get_android(ar))
                break

    # 未配对的安卓单独追加
    for ar in all_android:
        a_key = (ar["package_name"], "Android")
        if a_key not in seen_keys:
            seen_keys.add(a_key)
            rows.append(get_android(ar))

    if not rows:
        return [{
            "package_name": name,
            "platform": "未知",
            "app_name": "未找到",
            "download_url": "",
            "icon_url": "",
            "category": "",
        }]
    return rows


# ========== 查询逻辑 ==========

HTTP_TIMEOUT = 5  # 统一超时时间（秒），批量查询时减少等待


def search_xiaomi(package_name):
    """小米应用商店"""
    url = f"https://app.mi.com/details?id={package_name}"
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        title_tag = soup.find("title")
        if not title_tag:
            return None
        title_text = title_tag.text
        if "404" in title_text or "错误" in title_text:
            return None
        app_name = title_text.split("-")[0].strip()
        skip_keywords = ["应用商店", "软件商店", "游戏商店", "手机游戏"]
        if app_name and not any(kw in app_name for kw in skip_keywords):
            icon_url = ""
            icon_tag = soup.find("img", class_="yellow-flower") or soup.find("img", attrs={"alt": app_name})
            if icon_tag and icon_tag.get("src"):
                icon_url = icon_tag["src"]
                if icon_url.startswith("//"):
                    icon_url = "https:" + icon_url

            # 提取分类（面包屑导航：首页 > 分类 > App名）
            category = ""
            breadcrumbs = soup.find_all("a", href=re.compile(r'/category/'))
            if breadcrumbs:
                category = breadcrumbs[0].get_text(strip=True)

            return {
                "source": "小米应用商店",
                "app_name": app_name,
                "download_url": url,
                "icon_url": icon_url,
                "category": category,
            }
    except Exception:
        pass
    return None


def search_tencent(package_name):
    """腾讯应用宝"""
    url = f"https://sj.qq.com/appdetail/{package_name}"
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = requests.get(url, headers=headers, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        title_tag = soup.find("title")
        if not title_tag:
            return None
        title_text = title_tag.text.strip()
        app_name = title_text.split("-")[0].strip()
        for suffix in ["下载安装", "下载", "安装"]:
            if app_name.endswith(suffix):
                app_name = app_name[:-len(suffix)].strip()
                break
        if app_name and app_name != "应用宝" and "404" not in app_name:
            icon_url = ""
            icon_tag = soup.find("img", class_="det-icon") or soup.find("img", attrs={"alt": app_name})
            if icon_tag and icon_tag.get("src"):
                icon_url = icon_tag["src"]
                if icon_url.startswith("//"):
                    icon_url = "https:" + icon_url

            # 提取分类
            category = ""
            # 应用宝页面中查找分类信息
            cat_tag = soup.find("a", href=re.compile(r'/category/'))
            if cat_tag:
                category = cat_tag.get_text(strip=True)

            return {
                "source": "腾讯应用宝",
                "app_name": app_name,
                "download_url": url,
                "icon_url": icon_url,
                "category": category,
            }
    except Exception:
        pass
    return None


def search_apple(bundle_id):
    """Apple App Store (iTunes API) - 按 bundle ID 查询"""
    url = f"https://itunes.apple.com/lookup?bundleId={bundle_id}&country=cn"
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            app_info = data["results"][0]
            raw_name = app_info.get("trackName", "未知")
            app_name = clean_app_name(raw_name)
            raw_url = app_info.get("trackViewUrl", "")
            download_url = clean_ios_url(raw_url)
            icon_url = app_info.get("artworkUrl100", "") or app_info.get("artworkUrl60", "")
            # iTunes API 直接提供分类
            genres = app_info.get("genres", [])
            category = genres[0] if genres else ""
            return {
                "source": "Apple App Store",
                "app_name": app_name,
                "download_url": download_url,
                "icon_url": icon_url,
                "category": category,
            }
    except Exception:
        pass
    return None


def search_apple_by_numid(app_id):
    """Apple App Store (iTunes API) - 按数字 App ID 查询（如 414478124）"""
    url = f"https://itunes.apple.com/lookup?id={app_id}&country=cn"
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            app_info = data["results"][0]
            raw_name = app_info.get("trackName", "未知")
            app_name = clean_app_name(raw_name)
            raw_url = app_info.get("trackViewUrl", "")
            download_url = clean_ios_url(raw_url)
            icon_url = app_info.get("artworkUrl100", "") or app_info.get("artworkUrl60", "")
            genres = app_info.get("genres", [])
            category = genres[0] if genres else ""
            bundle_id = app_info.get("bundleId", app_id)
            return {
                "package_name": bundle_id,
                "platform": "iOS",
                "app_name": app_name,
                "download_url": download_url,
                "icon_url": icon_url,
                "category": category,
            }
    except Exception:
        pass
    return None


# 默认安卓商店优先级
DEFAULT_ANDROID_STORES = ["xiaomi", "tencent", "wandoujia", "appchina", "pp"]

STORE_SEARCH_FUNCS = {
    "xiaomi":    search_xiaomi,
    "tencent":   search_tencent,
    "wandoujia": search_wandoujia,
    "appchina":  search_appchina,
    "pp":        search_pp,
}

STORE_NAMES = {
    "xiaomi":    "小米应用商店",
    "tencent":   "腾讯应用宝",
    "wandoujia": "豌豆荚",
    "appchina":  "应用汇",
    "pp":        "PP助手",
}

# 名称搜索函数：用于 query_by_name 的多商店回退
STORE_NAME_SEARCH_FUNCS = {
    "wandoujia": search_wandoujia_by_name,
    "xiaomi":    lambda name: search_xiaomi_by_name_full(name, 3),
    "tencent":   lambda name: search_tencent_by_name_full(name, 3),
    "appchina":  lambda name: search_appchina_by_name_full(name, 3),
}


def query_single(package_name, android_store_order=None):
    """查询单个包名，返回结果列表"""
    package_name = clean_package_name(package_name)
    if not package_name:
        return []

    if android_store_order is None:
        android_store_order = DEFAULT_ANDROID_STORES

    # 并发查询所有源
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        android_futures = {}
        for store_id in android_store_order:
            func = STORE_SEARCH_FUNCS.get(store_id)
            if func:
                android_futures[store_id] = executor.submit(func, package_name)
        future_apple = executor.submit(search_apple, package_name)

    # 按用户指定优先级选取安卓结果
    android_result = None
    for store_id in android_store_order:
        if store_id in android_futures:
            result = android_futures[store_id].result()
            if result:
                android_result = result
                break

    ios_result = future_apple.result()

    rows = []

    if android_result:
        rows.append({
            "package_name": package_name,
            "platform": "Android",
            "app_name": android_result["app_name"],
            "download_url": android_result["download_url"],
            "icon_url": android_result.get("icon_url", ""),
            "category": android_result.get("category", ""),
        })

    if ios_result:
        rows.append({
            "package_name": package_name,
            "platform": "iOS",
            "app_name": ios_result["app_name"],
            "download_url": ios_result["download_url"],
            "icon_url": ios_result.get("icon_url", ""),
            "category": ios_result.get("category", ""),
        })

    if not rows:
        rows.append({
            "package_name": package_name,
            "platform": "未知",
            "app_name": "未找到",
            "download_url": f"https://www.qimai.cn/search/android/search/{package_name}",
            "icon_url": "",
            "category": "",
        })

    return rows


def _enrich_rows(rows, get_apk_url, apk_url_mode, get_sha1):
    """为结果列表中的每个 Android 行补充 APK 直链 和/或 SHA1"""
    need_appchina = get_apk_url or get_sha1
    for r in rows:
        if r.get("platform") != "Android":
            continue
        pkg = r.get("package_name", "")
        if not pkg:
            continue

        apk_url_from_appchina = ""

        # 调用应用汇（一次请求，供 APK 直链 和 SHA1 共用）
        if need_appchina:
            ac = search_appchina(pkg)
            if ac:
                apk_url_from_appchina = ac.get("apk_direct_url", "")

        # APK 直链
        if get_apk_url:
            apk_urls = []
            if apk_url_from_appchina:
                apk_urls.append(apk_url_from_appchina)
            if apk_url_mode == "multiple":
                wdj_url = _get_wandoujia_apk_url(pkg)
                if wdj_url and wdj_url not in apk_urls:
                    apk_urls.append(wdj_url)
            r["apk_direct_urls"] = apk_urls

        # SHA1
        if get_sha1:
            sha1_src = apk_url_from_appchina
            if not sha1_src and get_apk_url:
                sha1_src = r.get("apk_direct_urls", [""])[0] if r.get("apk_direct_urls") else ""
            r["sha1"] = _extract_sha1_from_apk_url(sha1_src) if sha1_src else ""

    return rows


def query_single_extended(package_name, android_store_order,
                          get_apk_url, apk_url_mode, get_sha1):
    """查询单个包名，含可选的 APK 直链 和 SHA1"""
    rows = query_single(package_name, android_store_order)
    return _enrich_rows(rows, get_apk_url, apk_url_mode, get_sha1)


def query_by_name_extended(name, android_store_order, exact_search,
                           get_apk_url, apk_url_mode, get_sha1):
    """按名称查询，含可选的 APK 直链 和 SHA1"""
    rows = query_by_name(name, android_store_order, exact_search)
    return _enrich_rows(rows, get_apk_url, apk_url_mode, get_sha1)


# ========== 路由 ==========

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/shutdown", methods=["POST"])
def api_shutdown():
    """关闭服务"""
    import threading
    def _stop():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=_stop, daemon=True).start()
    return jsonify({"ok": True})


@app.route("/api/startup/status", methods=["GET"])
def api_startup_status():
    """查询开机自启状态"""
    enabled = _check_startup_enabled()
    return jsonify({"enabled": enabled})


@app.route("/api/startup", methods=["POST"])
def api_startup():
    """设置或取消开机自启"""
    data = request.get_json()
    enable = bool(data.get("enable", False))
    ok, msg = _set_startup(enable)
    enabled = _check_startup_enabled()
    return jsonify({"ok": ok, "enabled": enabled, "message": msg})


def _get_startup_plist_path():
    home = os.path.expanduser("~")
    return os.path.join(home, "Library", "LaunchAgents", "com.appfinder.launch.plist")


def _check_startup_enabled():
    if sys.platform == "darwin":
        return os.path.exists(_get_startup_plist_path())
    return False


def _set_startup(enable):
    if sys.platform != "darwin":
        return False, "开机自启仅支持 Mac，Windows 版暂不支持"
    plist_path = _get_startup_plist_path()
    if enable:
        # 找到当前可执行文件或 python 脚本
        if getattr(sys, 'frozen', False):
            program = sys.executable
        else:
            program = sys.executable
            script = os.path.abspath(__file__)
            plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.appfinder.launch</string>
    <key>ProgramArguments</key>
    <array>
        <string>{program}</string>
        <string>{script}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/appfinder.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/appfinder.err</string>
</dict>
</plist>"""
        try:
            os.makedirs(os.path.dirname(plist_path), exist_ok=True)
            with open(plist_path, "w") as f:
                f.write(plist_content)
            import subprocess
            subprocess.run(["launchctl", "load", plist_path], capture_output=True)
            return True, "已添加开机启动"
        except Exception as e:
            return False, f"添加失败: {e}"
    else:
        try:
            if os.path.exists(plist_path):
                import subprocess
                subprocess.run(["launchctl", "unload", plist_path], capture_output=True)
                os.remove(plist_path)
            return True, "已取消开机启动"
        except Exception as e:
            return False, f"取消失败: {e}"


@app.route("/api/query", methods=["POST"])
def api_query():
    """查询接口：SSE 流式响应，实时推送进度"""
    req_data = request.get_json()
    raw_inputs = req_data.get("package_names", [])
    android_store_order = req_data.get("android_store_order", DEFAULT_ANDROID_STORES)
    exact_search = bool(req_data.get("exact_search", False))
    get_apk_url  = bool(req_data.get("get_apk_url", False))
    apk_url_mode = req_data.get("apk_url_mode", "single")   # "single" | "multiple"
    get_sha1     = bool(req_data.get("get_sha1", False))
    platform_filter = req_data.get("platform_filter", "all")  # "all"|"ios"|"android"
    query_interval_ms = max(0, int(req_data.get("query_interval_ms", 0)))

    # ── 输入解析（同步，generator 外完成）──────────────────────────
    MAX_ITEMS = 10000
    pkg_list, ios_id_list, name_list = [], [], []
    invalid_count = 0

    all_valid = [x.strip() for x in raw_inputs if x.strip()]
    total_raw = len(all_valid)
    skipped_over_limit = max(0, total_raw - MAX_ITEMS)

    for item in all_valid[:MAX_ITEMS]:
        if re.match(r'^\d{6,12}$', item):
            ios_id_list.append(item)
        else:
            cleaned = clean_package_name(item)
            if cleaned and is_package_name(cleaned):
                pkg_list.append(cleaned)
            elif re.search(r'[a-zA-Z\u4e00-\u9fff]', item):
                name_list.append(item)
            else:
                invalid_count += 1

    def dedup(lst):
        seen, out = set(), []
        for x in lst:
            if x not in seen:
                seen.add(x); out.append(x)
        return out

    cleaned_pkgs    = dedup(pkg_list)
    cleaned_ios_ids = dedup(ios_id_list)
    cleaned_names   = dedup(name_list)

    total_valid = len(cleaned_pkgs) + len(cleaned_ios_ids) + len(cleaned_names)
    deduplicated = max(0, (total_raw - skipped_over_limit) - total_valid - invalid_count)

    meta = {
        "over_limit":          skipped_over_limit,
        "total_input":         total_raw,
        "invalid_count":       invalid_count,
        "deduplicated":        deduplicated,
        "name_search_ios_only": False,  # 已支持安卓，废弃此字段
    }

    # 全部任务列表（保持输入顺序：包名 → iOS数字ID → 名称）
    tasks = (
        [("pkg",    p) for p in cleaned_pkgs]    +
        [("ios_id", a) for a in cleaned_ios_ids] +
        [("name",   n) for n in cleaned_names]
    )
    total_tasks = len(tasks)

    # ── 批量 / 并发参数 ──────────────────────────────────────────────
    # 用户设置的查询间隔（随机范围 0.8x ~ 1.2x）
    user_interval_s = query_interval_ms / 1000.0 if query_interval_ms > 0 else 0.0

    if total_tasks <= 500:
        BATCH_SIZE  = total_tasks or 1
        WORKERS     = min(50, max(10, total_tasks // 4))
        BATCH_DELAY = user_interval_s  # 使用用户设置
        est_seconds = int(math.ceil(total_tasks / WORKERS) * 4 + total_tasks * user_interval_s)
    else:
        BATCH_SIZE  = 20
        WORKERS     = 10
        BATCH_DELAY = max(1.0, user_interval_s)  # 大量查询至少1s间隔
        batches     = math.ceil(total_tasks / BATCH_SIZE)
        est_seconds = int(batches * (7 + BATCH_DELAY))

    # ── SSE Generator ────────────────────────────────────────────────
    def generate():
        if total_tasks == 0:
            yield f"data: {json.dumps({'type': 'complete', 'results': [], **meta})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'start', 'total': total_tasks, 'estimated_seconds': est_seconds, **meta})}\n\n"

        all_results = []
        seen_keys   = set()
        done_count  = 0

        for batch_start in range(0, len(tasks), BATCH_SIZE):
            batch = tasks[batch_start: batch_start + BATCH_SIZE]

            with concurrent.futures.ThreadPoolExecutor(
                    max_workers=min(WORKERS, len(batch))) as exe:
                future_map = {}
                for task_type, value in batch:
                    if task_type == "pkg":
                        if get_apk_url or get_sha1:
                            f = exe.submit(query_single_extended, value,
                                           android_store_order, get_apk_url,
                                           apk_url_mode, get_sha1)
                        else:
                            f = exe.submit(query_single, value, android_store_order)
                    elif task_type == "ios_id":
                        f = exe.submit(search_apple_by_numid, value)
                    else:
                        if get_apk_url or get_sha1:
                            f = exe.submit(query_by_name_extended, value,
                                           android_store_order, exact_search,
                                           get_apk_url, apk_url_mode, get_sha1)
                        else:
                            f = exe.submit(query_by_name, value, android_store_order, exact_search)
                    future_map[f] = (task_type, value)

                for f in concurrent.futures.as_completed(future_map):
                    task_type, value = future_map[f]
                    try:
                        result = f.result()
                    except Exception:
                        result = None

                    # 整理本条结果
                    rows = []
                    if task_type == "pkg":
                        rows = result or []
                    elif task_type == "ios_id":
                        rows = [result] if result else [{
                            "package_name": value, "platform": "iOS",
                            "app_name": "未找到",
                            "download_url": f"https://apps.apple.com/cn/app/id{value}",
                            "icon_url": "", "category": "",
                        }]
                    else:
                        rows = result or []

                    for r in rows:
                        # 平台筛选
                        plat = r.get("platform", "")
                        if platform_filter == "ios" and plat != "iOS":
                            continue
                        if platform_filter == "android" and plat != "Android":
                            continue
                        k = (r.get("package_name", ""), plat)
                        if k not in seen_keys:
                            seen_keys.add(k)
                            all_results.append(r)

                    done_count += 1
                    yield f"data: {json.dumps({'type': 'progress', 'done': done_count, 'total': total_tasks})}\n\n"

            # 批次间限速延迟（加随机抖动 ±20%）
            if BATCH_DELAY > 0 and batch_start + BATCH_SIZE < len(tasks):
                import random
                jitter = BATCH_DELAY * random.uniform(0.8, 1.2)
                time.sleep(jitter)

        yield f"data: {json.dumps({'type': 'complete', 'results': all_results, **meta})}\n\n"

    resp = Response(stream_with_context(generate()), mimetype="text/event-stream")
    resp.headers["Cache-Control"]     = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


@app.route("/api/download", methods=["POST"])
def api_download():
    """下载结果为xlsx或csv"""
    data = request.get_json()
    results = data.get("results", [])
    file_format = data.get("format", "xlsx")
    include_icon = data.get("include_icon", False)
    include_icon_image = data.get("include_icon_image", False) and file_format == "xlsx" and HAS_PILLOW

    if not results:
        return jsonify({"error": "没有数据可下载"}), 400

    has_apk_urls = any(r.get("apk_direct_urls") for r in results)
    has_sha1     = any(r.get("sha1") for r in results)

    headers_list = ["App名称", "包名", "平台", "分类", "商店地址"]
    if has_apk_urls:
        headers_list.append("下载地址")
    if has_sha1:
        headers_list.append("SHA1")

    def apk_urls_str(r):
        urls = r.get("apk_direct_urls", [])
        return "\n".join(urls) if urls else ""

    if file_format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        if include_icon:
            writer.writerow(headers_list + ["图标链接"])
        else:
            writer.writerow(headers_list)
        for r in results:
            row = [r["app_name"], r["package_name"], r["platform"], r.get("category", ""), r["download_url"]]
            if has_apk_urls:
                row.append(apk_urls_str(r))
            if has_sha1:
                row.append(r.get("sha1", ""))
            if include_icon:
                row.append(r.get("icon_url", ""))
            writer.writerow(row)
        mem = io.BytesIO(output.getvalue().encode("utf-8-sig"))
        return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="app_results.csv")
    else:
        wb = Workbook()
        ws = wb.active
        ws.title = "App查询结果"

        header_font = Font(bold=True, color="FFFFFF", size=12)
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )

        # 列定义：含图标图片时第一列为图标列
        col_offset = 0
        if include_icon_image:
            col_offset = 1
            img_header_cell = ws.cell(row=1, column=1, value="图标")
            img_header_cell.font = header_font
            img_header_cell.fill = header_fill
            img_header_cell.alignment = header_alignment
            img_header_cell.border = thin_border
            ws.column_dimensions["A"].width = 6

        cols = headers_list[:]
        if include_icon:
            cols.append("图标链接")

        from openpyxl.utils import get_column_letter
        for col_i, header in enumerate(cols, 1 + col_offset):
            cell = ws.cell(row=1, column=col_i, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        for row_idx, r in enumerate(results, 2):
            values = [r["app_name"], r["package_name"], r["platform"], r.get("category", ""), r["download_url"]]
            if has_apk_urls:
                values.append(apk_urls_str(r))
            if has_sha1:
                values.append(r.get("sha1", ""))
            if include_icon:
                values.append(r.get("icon_url", ""))
            for col_i, val in enumerate(values, 1 + col_offset):
                cell = ws.cell(row=row_idx, column=col_i, value=val)
                cell.border = thin_border
                cell.alignment = Alignment(vertical="center", wrap_text=bool(has_apk_urls and "\n" in str(val)))

        # 下载并嵌入图标图片
        if include_icon_image:
            def fetch_icon(args):
                row_i, url = args
                if not url:
                    return row_i, None
                try:
                    resp = requests.get(url, timeout=(3, 5), headers={"User-Agent": "Mozilla/5.0"})
                    if resp.status_code == 200:
                        img = PILImage.open(io.BytesIO(resp.content)).convert("RGBA")
                        img.thumbnail((36, 36), PILImage.LANCZOS)
                        buf = io.BytesIO()
                        img.save(buf, format="PNG")
                        buf.seek(0)
                        return row_i, buf
                except Exception:
                    pass
                return row_i, None

            tasks = [(i, results[i - 2].get("icon_url", "")) for i in range(2, len(results) + 2)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as exe:
                for row_i, buf in exe.map(fetch_icon, tasks):
                    if buf:
                        try:
                            xl_img = XLImage(buf)
                            xl_img.width = 36
                            xl_img.height = 36
                            ws.add_image(xl_img, f"A{row_i}")
                            ws.row_dimensions[row_i].height = 28
                        except Exception:
                            pass

        base_widths = [20, 35, 12, 15, 55]
        extra_widths = []
        if has_apk_urls:
            extra_widths.append(70)
        if has_sha1:
            extra_widths.append(55)
        if include_icon:
            extra_widths.append(50)
        all_widths = base_widths + extra_widths

        start_col = (2 if include_icon_image else 1)
        for idx, w in enumerate(all_widths):
            letter = get_column_letter(start_col + idx)
            ws.column_dimensions[letter].width = w

        mem = io.BytesIO()
        wb.save(mem)
        mem.seek(0)
        return send_file(mem, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         as_attachment=True, download_name="app_results.xlsx")


if __name__ == "__main__":
    import webbrowser
    import threading

    port = 9527

    try:
        url = f"http://127.0.0.1:{port}"
        # 仅当未被 launcher 启动时自己打开浏览器（避免重复打开）
        if not os.environ.get("APPFINDER_NO_BROWSER"):
            threading.Timer(1.5, lambda: webbrowser.open(url)).start()

        print(f"\n  App Query Tool Started!")
        print(f"  Open in browser: {url}")
        print(f"  Close this window to exit.\n")

        app.run(host='127.0.0.1', port=port, debug=False)
    except Exception as e:
        print(f"\n  ERROR: {e}")
        input("\n  Press Enter to exit...")
