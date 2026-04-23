# App Finder · 包名查 App 信息

> 输入**安卓包名、iOS Bundle ID 或 App 中文/英文名称**，**一键**从小米、应用宝、豌豆荚、应用汇、PP 助手、魅族 Flyme 等国内安卓商店以及 Apple App Store 同时抓取应用名、图标、分类和下载地址。**双端全覆盖**。

本机（Mac / Windows）跑一个轻量服务，局域网内的手机、平板、其他电脑都可以打开浏览器共用——查询全部在本机执行，其他设备只是显示端。

---

## ✨ 核心功能

| 功能 | 说明 |
|---|---|
| 🔍 多商店并发查询 | 小米、应用宝、豌豆荚、应用汇、PP 助手、魅族 Flyme 同时跑 + Apple App Store |
| 🔁 智能兜底 | 主商店全漏时自动走搜索引擎反查应用名 |
| 📝 App 介绍抓取 | 可选开启，一键取回应用介绍文字（iOS + 安卓双端） |
| 📦 APK 直链 + 哈希 | 可选抓取 APK 直链 + SHA1 / SHA256 指纹（签名校验场景） |
| 📊 批量查询 | 最多一次 10000 条，实时流式进度，不完整结果自动补齐重查 |
| 📱 局域网共享 | 一键开启，手机扫二维码访问。含连接设备统计、备注、屏蔽 |
| 📜 跨设备历史 | 可选的共享查询历史，云朵图标标识哪些来自其他设备 |
| 🌓 深色模式 | 跟随系统 / 手动切换 |
| 📥 多格式导出 | XLSX（支持嵌入图标）/ CSV / 剪贴板 |
| 🖥 跨平台 | Mac（arm64 / x86_64 双架构）+ Windows 源码包 |

---

## 🚀 快速开始

### 方式 1：直接下载打包好的程序（推荐非开发者）

去 **[Releases 页](https://github.com/RickXiong/app-finder/releases/latest)** 下载对应平台的包：

| 平台 | 文件 | 说明 |
|---|---|---|
| 🍎 macOS (Apple Silicon) | `lookup_appinfo_mac_arm64.zip` | M1 / M2 / M3 / M4 |
| 🍎 macOS (Intel) | `lookup_appinfo_mac_x86_64.zip` | 2020 年前的 Intel Mac |
| 🪟 Windows | `lookup_appinfo_win.zip` | 源码包，首次运行自动装 Python 依赖 |

**Mac**：解压 → 双击 `.app`。首次打不开双击包内的 `fix_quarantine.command` 即可。
**Windows**：解压 → 双击 `Start.bat`，首次会自动装依赖。

### 方式 2：源码运行

```bash
git clone https://github.com/RickXiong/app-finder.git
cd app-finder
pip install flask requests beautifulsoup4 lxml openpyxl Pillow cryptography 'qrcode[pil]'
python3 app.py
```

启动后浏览器访问终端显示的地址即可。局域网内其他设备访问需要在「📱 手机/其他设备访问」面板手动开启共享。

---

## 📮 交流

用着顺手或有 bug / 建议，欢迎加微信聊聊：**`rickaruike`**

---

## 📄 License

[MIT](LICENSE) © 2026 Rick Xiong
