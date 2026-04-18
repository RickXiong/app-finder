#!/usr/bin/env python3
"""
App 查询工具 - 图标生成脚本

设计理念：
- 渐变背景（紫→青）：现代感，辨识度高
- 放大镜 + 内部 App 网格：明确表达"查找 App"的工具定位
- Mac 标准圆角矩形（squircle）基座

输出：
- icon_1024.png     (用于 Win .ico 和 Mac iconset 源图)
- app_icon.icns     (Mac)
- app_icon.ico      (Win，暂不接入 spec，留备用)
"""

import math
import os
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def make_gradient_bg():
    """对角渐变 RGBA：左上深紫 → 右下青色。
    做法：画一个 2x2 的色块（四角颜色对应），Pillow 双线性插值放大到 1024。
    比逐像素快百倍，效果完全一样流畅。"""
    # 深紫 #6A4FE5 → 青色 #3FC8DF
    R0, G0, B0 = 106, 79, 229
    R1, G1, B1 = 63, 200, 223
    # 中间过渡色（左下/右上）
    Rm = (R0 + R1) // 2
    Gm = (G0 + G1) // 2
    Bm = (B0 + B1) // 2
    # 2x2 种子图：左上=深紫、右下=青色、左下/右上=过渡色
    seed = Image.new("RGBA", (2, 2))
    seed.putpixel((0, 0), (R0, G0, B0, 255))  # 左上
    seed.putpixel((1, 0), (Rm, Gm, Bm, 255))  # 右上
    seed.putpixel((0, 1), (Rm, Gm, Bm, 255))  # 左下
    seed.putpixel((1, 1), (R1, G1, B1, 255))  # 右下
    return seed.resize((SIZE, SIZE), Image.BILINEAR)


def apply_squircle_mask(img):
    """Mac 标准的圆角矩形遮罩（约 22.5% 圆角）"""
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE, SIZE], radius=int(SIZE * 0.225), fill=255
    )
    result = img.copy()
    result.putalpha(mask)
    return result


def draw_magnifier_with_grid():
    """放大镜 + 内部 2x2 App 网格"""
    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fg)

    # 放大镜位于偏左上位置，留出右下给手柄
    cx, cy = int(SIZE * 0.445), int(SIZE * 0.445)
    radius = int(SIZE * 0.265)
    stroke = int(SIZE * 0.055)

    # 放大镜外圆圈（白色实心边）
    fd.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=(255, 255, 255, 255),
        width=stroke,
    )

    # 放大镜内部：2x2 小方块（模拟"App 图标网格"）
    # 小方块填充略小于镜片直径，留出边距
    inner_r = radius - stroke
    grid_total = int(inner_r * 1.28)  # 2 格 + 间隙 占用的总宽
    gap = int(inner_r * 0.12)
    square_size = (grid_total - gap) // 2

    # 四个小方块的颜色（柔和，和背景紫/青有对比但不刺眼）
    colors = [
        (255, 180, 95, 255),   # 橙（温暖）
        (255, 105, 140, 255),  # 粉红
        (120, 230, 170, 255),  # 薄荷绿
        (130, 180, 255, 255),  # 淡蓝
    ]

    grid_left = cx - grid_total // 2
    grid_top = cy - grid_total // 2
    positions = [
        (grid_left, grid_top),
        (grid_left + square_size + gap, grid_top),
        (grid_left, grid_top + square_size + gap),
        (grid_left + square_size + gap, grid_top + square_size + gap),
    ]
    for (px, py), color in zip(positions, colors):
        fd.rounded_rectangle(
            [px, py, px + square_size, py + square_size],
            radius=int(square_size * 0.22),
            fill=color,
        )

    # 放大镜手柄：从圆右下 45° 向外
    angle = math.pi / 4
    # 手柄起点：恰好在外圈边
    h_start_x = cx + (radius + stroke * 0.3) * math.cos(angle)
    h_start_y = cy + (radius + stroke * 0.3) * math.sin(angle)
    h_len = int(SIZE * 0.25)
    h_end_x = h_start_x + h_len * math.cos(angle)
    h_end_y = h_start_y + h_len * math.sin(angle)
    # 手柄用圆角粗线（先画端点圆再画线，近似圆角胶囊）
    handle_width = int(stroke * 1.6)
    # 端点圆
    for (px, py) in [(h_start_x, h_start_y), (h_end_x, h_end_y)]:
        fd.ellipse(
            [px - handle_width / 2, py - handle_width / 2,
             px + handle_width / 2, py + handle_width / 2],
            fill=(255, 255, 255, 255),
        )
    fd.line(
        [(h_start_x, h_start_y), (h_end_x, h_end_y)],
        fill=(255, 255, 255, 255),
        width=handle_width,
    )

    return fg


def make_shadow(layer, offset=(0, 16), blur=24, opacity=120):
    """给传入图层生成模糊投影"""
    # 从 alpha 通道取轮廓
    alpha = layer.split()[-1]
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # 以黑色填充阴影（透明度受 alpha 调制）
    black = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, opacity))
    shadow.paste(black, (0, 0), alpha)
    # 偏移 + 模糊
    shadow = shadow.transform(
        (SIZE, SIZE),
        Image.AFFINE,
        (1, 0, -offset[0], 0, 1, -offset[1]),
        resample=Image.BILINEAR,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))
    return shadow


def main():
    # 1) 背景（带圆角）
    bg = apply_squircle_mask(make_gradient_bg())

    # 2) 放大镜图层
    fg = draw_magnifier_with_grid()

    # 3) 给放大镜加一层轻微投影
    shadow = make_shadow(fg, offset=(0, 12), blur=22, opacity=90)

    # 4) 合成顺序：背景 → 阴影 → 前景
    final = Image.alpha_composite(bg, shadow)
    final = Image.alpha_composite(final, fg)

    # 再次应用圆角遮罩，确保阴影不溢出圆角
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE, SIZE], radius=int(SIZE * 0.225), fill=255
    )
    final.putalpha(mask)

    png_1024 = os.path.join(OUT_DIR, "icon_1024.png")
    final.save(png_1024, "PNG")
    print(f"✅ {png_1024}")

    # ── 生成 Mac iconset + icns ──────────────────
    iconset_dir = os.path.join(OUT_DIR, "app_icon.iconset")
    os.makedirs(iconset_dir, exist_ok=True)
    mac_sizes = [
        (16, "16x16"),
        (32, "16x16@2x"),
        (32, "32x32"),
        (64, "32x32@2x"),
        (128, "128x128"),
        (256, "128x128@2x"),
        (256, "256x256"),
        (512, "256x256@2x"),
        (512, "512x512"),
        (1024, "512x512@2x"),
    ]
    for size, label in mac_sizes:
        resized = final.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(iconset_dir, f"icon_{label}.png"), "PNG")

    icns_out = os.path.join(OUT_DIR, "app_icon.icns")
    # iconutil 只在 Mac 上可用
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", iconset_dir, "-o", icns_out],
            check=True, capture_output=True,
        )
        print(f"✅ {icns_out}")
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"⚠️  iconutil 失败（只在 Mac 上支持）: {e}")

    # ── 生成 Win .ico（多尺寸单文件）─────────────
    ico_out = os.path.join(OUT_DIR, "app_icon.ico")
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    final.save(ico_out, format="ICO", sizes=ico_sizes)
    print(f"✅ {ico_out}")


if __name__ == "__main__":
    main()
