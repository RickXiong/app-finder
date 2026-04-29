# AppLookup — AI / Agent 集成指南

> 给 LLM / agent / 自动化脚本看的文档。如果你是人，看 [README](./README.md) 即可。

## 一句话

按**包名**、**app 名**、或 **iOS App Store ID** 查应用信息（iOS + Android 双端）。
后端自动识别输入类型，混合输入开箱即用。

## 三种调用方式

### A. CLI（任何能 shell-out 的 AI / 脚本）

```bash
# 单个
applookup com.tencent.mm

# 混合输入（包名 / app 名 / iOS id 任意搭配）
applookup com.tencent.mm 微信 414478124 https://apps.apple.com/cn/app/id387682726

# 流式 JSONL（适合长查询，每条结果立刻可读）
applookup --jsonl com.tencent.mm com.taobao.taobao

# Markdown（给人类看）
applookup --markdown 微信

# 从 stdin
echo "com.tencent.mm" | applookup -

# 输出 JSON schema 给 LLM 做 function-calling
applookup --schema
```

退出码：`0` 成功；`1` 全部输入无效；`2` 参数错误；`3` 运行时错误；`130` Ctrl+C。

### B. MCP server（Claude Desktop / Claude Code 直接挂）

`~/.claude/claude_desktop_config.json` 或 `mcp.json` 加：

```json
{
  "mcpServers": {
    "applookup": {
      "command": "/Users/xrick/app_finder_web/.venv-dev/bin/python3",
      "args": ["-m", "cli.mcp_server"],
      "cwd": "/Users/xrick/app_finder_web"
    }
  }
}
```

挂载后 Claude 自动看到工具 `lookup_app(queries=[...], ...)`，对话里直接喊
"查一下 com.tencent.mm" / "微信的 Bundle ID 是什么" / "TikTok 是 iOS 还是 Android-only" 即可。

### C. Python 嵌入（agent 框架 / 自定义脚本）

```python
import sys
sys.path.insert(0, "/Users/xrick/app_finder_web")
from cli.core import query, query_stream

# 同步
result = query(["com.tencent.mm", "微信", "414478124"], extended=True)
for row in result["results"]:
    print(row["platform"], row["app_name"], row["package_name"])

# 流式
for ev in query_stream(["com.tencent.mm"]):
    if ev["type"] == "progress":
        ...
```

## 输入格式

**单个字符串可以是**：

| 形态 | 例子 | 后端识别为 |
|---|---|---|
| Android 包名 | `com.tencent.mm` | `pkg` |
| iOS Bundle ID | `com.tencent.xin` | `pkg` |
| 中文 app 名 | `微信` / `抖音` | `name` |
| 英文 app 名 | `WeChat` / `TikTok` | `name` |
| iOS 数字 ID | `414478124` | `ios_id` |
| 带前缀 iOS ID | `id414478124` | `ios_id` |
| 完整 Apple URL | `https://apps.apple.com/cn/app/id414478124` | `ios_id` |

**混合输入完全 OK**。一次调用可以同时含多种类型。

**前缀容错**：`om.tencent.mm` / `co.tencent.mm` / `cm.tencent.mm` 这种用户漏字母的会被自动修正成 `com.tencent.mm`，结果里 `_corrected: true` 标记。

## 输出 schema

### 顶层

```jsonc
{
  "results": [ /* row 数组，见下 */ ],
  "total_input": 3,      // 去重前入参数
  "deduplicated": 0,     // 重复项数
  "invalid_count": 0,    // 完全无法识别为 pkg/name/id 的输入数
  "over_limit": 0        // 超过 10000 上限被截断的数
}
```

### Row（每条结果）

```jsonc
{
  "package_name":    "com.tencent.mm",      // Android 包名 / iOS Bundle ID
  "platform":        "Android",              // "iOS" 或 "Android"
  "app_name":        "微信",                 // 未找到时 = "未找到"
  "icon_url":        "https://...",          // 图标 URL，可能 null
  "category":        "聊天社交",             // 商店分类，可能 null
  "download_url":    "https://app.mi.com/details?id=com.tencent.mm",
  "source":          "小米应用商店",         // 商店名（多渠道并发，先到先用）
  "apk_direct_urls": [],                     // APK 直链，仅 apk=true 且 Android 时填充
  "sha1":            null,                   // 仅 sha1=true 时填充
  "sha256":          null,                   // 仅 sha256=true 时填充
  "description":     "微信是一款...",        // iOS 默认有；Android 仅 description=true
  "_orig_task_type": "pkg",                  // "pkg" / "ios_id" / "name"
  "_orig_value":     "com.tencent.mm",       // 用户原输入
  "_corrected":      false,                  // 包名是否被前缀修正过
  "extended_fill":   false                   // 是否由跨端补齐而来（不是直接命中）
}
```

### 一对多关系

- 一个**包名**输入 → 通常返回 1~2 行（命中本端 + 跨端补齐另一端）
- 一个 **app 名** → 可能返回 多条（同名变体：抖音、抖音极速版、抖音精选）
- 一个 **iOS id** → 通常 2 行（iOS + 跨端补的 Android）
- **未找到** → 返回 1 行 `app_name="未找到"` `package_name=原输入`

## 关键开关

| 开关 | 默认 | 何时开 | 代价 |
|---|---|---|---|
| `extended` | true | 一般保持开（更全） | 单端命中后还要查另一端，慢 ~1.5x |
| `exact` | false | 按 app 名查时希望精确（不要"微信轻享版" / "微信极速版"） | — |
| `apk` | false | 需要 Android APK 下载链接 | 慢，要解析多个商店页 |
| `sha1` / `sha256` | false | 需要 APK 哈希校验值 | 慢（需先下载 APK），需 `apk=true` 配合 |
| `description` | false | Android 也要应用介绍 | 慢，需要再抓商店页 |
| `interval_ms` | 0 | 大批量查询防限流时设 200~500 | 整体变慢 |
| `platform` | all | 只关心其中一端时填 `ios` 或 `android` | 没代价；`extended=false` 时严格筛 |

## 典型 AI 场景 → 怎么调

| 场景 | 调用 |
|---|---|
| "这个包名是什么 App" | `lookup_app(queries=["com.x.y"])` |
| "微信的 iOS Bundle ID 是什么" | `lookup_app(queries=["微信"], platform="ios")` |
| "找一下抖音 / 微博 / 淘宝的商店链接" | `lookup_app(queries=["抖音","微博","淘宝"])` |
| "TikTok 是 iOS 还是 Android-only" | `lookup_app(queries=["TikTok"], extended=true)` 看返回平台 |
| "整理这 50 个包名的应用名 + 商店链接" | `lookup_app(queries=[...50 items...])` 流式更友好 → CLI `--jsonl` |
| "判断这一串是不是包名" | `applookup --schema` 看输入格式；后端自动分类，不用预判 |
| "对应 Apple URL 的 Android 包是什么" | `lookup_app(queries=["https://apps.apple.com/cn/app/id414478124"])` 跨端补齐返回 Android 行 |

## 性能 / 边界

- **单条查询** ~1-3 秒（首次商店冷启动会更长）
- **批量** 后端并发，10 条 ~5 秒，100 条 ~30 秒（视商店响应）
- **上限** 10000 条 / 单次调用，超出截断
- **超时** 单条最长 ~30 秒（后端商店超时）；CLI 整体不强超时，依赖底层
- **失败行为** 商店超时 / 解析失败 → 该条返回 `app_name="未找到"`，不抛异常
- **不需要预启动 9527 web 服务**（嵌入式）

## 不做的事（明确边界）

- ❌ 不做"按公司名 / 开发者名"查询（只能按 app 名 / 包名 / id）
- ❌ 不返回价格 / 评分 / 评论数（后端只抓基础元数据）
- ❌ 不下载 APK 文件本体（只给 URL）
- ❌ 不查 Google Play（国内不可达，已在数据源黑名单）
- ❌ iOS 端只走 App Store 中国区（其他地区数据需改后端）

## 数据来源（透明）

- **iOS**：Apple iTunes Search API（公开）
- **Android**：腾讯应用宝、小米应用商店、华为应用市场、OPPO 软件商店、vivo 应用商店、搜狗应用、360 手机助手、Coolapk、酷传等多渠道并发；先到先用
- iOS / Android 跨端补齐基于 **App 名相关性匹配** + **bundle id ↔ package id 启发式映射**
