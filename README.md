# App Finder · 包名查 App 信息

> 输入**安卓包名、iOS Bundle ID 或 App 中文/英文名称**，**一键**从小米、应用宝、豌豆荚、应用汇、PP 助手、魅族 Flyme 等国内安卓商店以及 Apple App Store 同时抓取应用名、图标、分类和下载地址。**双端全覆盖**。

本机（Mac / Windows）跑一个轻量 Flask 服务，局域网内的手机、平板、其他电脑都可以打开浏览器共用——查询全部在本机执行，其他设备只是显示端。

---

## ✨ 核心功能

| 功能 | 说明 |
|---|---|
| 🔍 多商店并发查询 | 小米、应用宝、豌豆荚、应用汇、PP 助手、魅族 Flyme 同时跑 + Apple iTunes |
| 🔁 智能兜底 | 主商店全漏时自动走头条 / 搜狗 / 360 / 必应搜索引擎反查应用名 |
| 📦 APK 直链 + 哈希 | 可选抓取 APK 直链 + SHA1 / SHA256 指纹（签名校验场景）|
| 📊 批量查询 | 最多一次 10000 条，实时 SSE 流式进度，不完整结果自动补齐重查 |
| 📱 LAN 共享 | 一键开启，手机扫二维码访问。含连接设备统计、备注、屏蔽 |
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
# 1. 克隆
git clone https://github.com/RickXiong/app-finder.git
cd app-finder

# 2. 装依赖
pip install flask requests beautifulsoup4 lxml openpyxl Pillow cryptography 'qrcode[pil]'

# 3. 启动
python3 app.py

# 4. 浏览器访问
# http://127.0.0.1:9527
```

启动后：
- 终端会显示两个地址（`http://127.0.0.1:9527` 和局域网 IP 地址）
- 局域网内其他设备访问 LAN IP 需要在「📱 手机/其他设备访问」面板手动开启共享

---

## 📂 项目结构

```
app_finder_web/
├── app.py                    # Flask 后端，所有业务逻辑
├── static/
│   ├── main.js              # 前端逻辑（查询 / 历史 / 设置 / LAN）
│   ├── style.css            # 样式（浅色 + 深色）
│   └── tips.js              # 等待提示
├── templates/
│   └── index.html           # 单页 HTML
├── icon_src/
│   ├── make_icon.py         # 图标生成脚本（PIL）
│   └── app_icon.icns/.ico   # Mac/Windows 图标
├── windows_pkg_src/         # Windows 源码包的启动脚本
│   ├── Start.bat / Stop.bat
│   ├── setup.ps1            # Python 检测 + 依赖安装
│   └── launch.py            # 启动 + 打开浏览器
└── lookup_appinfo_mac.spec  # PyInstaller Mac 打包配置
```

---

## 🛠 打包成独立 .app / 分发包

### Mac（PyInstaller，需分别在 arm64 和 x86_64 构建）
```bash
# arm64（M 系列）
python3 -m PyInstaller lookup_appinfo_mac.spec --noconfirm --clean

# x86_64（Intel）需要在 x86_64 Python venv 里跑
```

### Windows
Windows 是源码分发：`windows_pkg_src/` 里的启动脚本会在用户机器上自动装 Python + pip 依赖。

---

## 📐 设计亮点

- **绑 `0.0.0.0:9527`**：本机 + LAN 都能访问；默认用 `ipconfig getifaddr` 探测真实 LAN IP，绕开 VPN/Warp 干扰
- **默认禁止 LAN 访问**：管理员主动开启才允许（`.lan_settings.json` 持久化）
- **管理员白名单**：来自非本机的 API 调用不能切换共享开关、不能关闭服务、不能管自启动
- **剪贴板兼容**：HTTPS/localhost 用现代 Clipboard API，LAN HTTP 场景自动回退 execCommand
- **Tk 隐身主循环**：Flask 打包成 Mac .app 时主线程跑 tkinter 空窗口，让 macOS 识别为"图形应用"，Dock 图标保持常驻

---

## 📮 交流

用着顺手或有 bug / 建议，欢迎加微信聊聊：**`rickaruike`**

---

## 📄 License

[MIT](LICENSE) © 2026 Rick Xiong
