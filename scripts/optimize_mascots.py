"""一次性脚本：翻转 ok/point + 重新生成所有 mascot 图片资源
- 对原始 2048x2048 PNG 缩放到合理尺寸
- 翻转 ok 和 point 水平方向
- 输出 1x 和 2x WebP + 1x PNG 兜底
- 用法：python scripts/optimize_mascots.py
"""
from PIL import Image, ImageOps
import os
import sys

SRC_DIR = r"e:\trae_projects\PapaCheck\PapaCheck.Site\public\imgs\mascot"

# (文件名, 1x 展示尺寸, 2x 展示尺寸)
IMAGES = [
    ("mascot-wave.png",   480, 960),  # Hero (LCP)
    ("mascot-bye.png",    320, 640),  # CtaFinal
    ("mascot-thumbs.png", 192, 384),  # Story
    ("mascot-ok.png",     192, 384),  # Story (需水平翻转)
    ("mascot-point.png",  192, 384),  # Story (需水平翻转)
]

# 水平翻转的图
TO_FLIP = {"mascot-ok.png", "mascot-point.png"}

# WebP 质量
WEBP_QUALITY = 82


def fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.2f} MB"


def main() -> int:
    if not os.path.isdir(SRC_DIR):
        print(f"[ERR] 目录不存在: {SRC_DIR}", file=sys.stderr)
        return 1

    total_before = 0
    total_after = 0

    for filename, size_1x, size_2x in IMAGES:
        src_path = os.path.join(SRC_DIR, filename)
        if not os.path.isfile(src_path):
            print(f"[WARN] 跳过（文件不存在）: {filename}")
            continue

        total_before += os.path.getsize(src_path)
        img = Image.open(src_path).convert("RGBA")

        if filename in TO_FLIP:
            img = ImageOps.mirror(img)
            print(f"[flip] {filename} 水平翻转")

        base = filename[:-4]  # 去掉 .png

        # 2x WebP
        img_2x = img.resize((size_2x, size_2x), Image.LANCZOS)
        out_2x_webp = os.path.join(SRC_DIR, f"{base}@2x.webp")
        img_2x.save(out_2x_webp, "WEBP", quality=WEBP_QUALITY, method=6)
        sz = os.path.getsize(out_2x_webp)
        total_after += sz
        print(f"  [webp] {base}@2x.webp  {size_2x}x{size_2x}  {fmt_size(sz)}")

        # 1x WebP
        img_1x = img.resize((size_1x, size_1x), Image.LANCZOS)
        out_1x_webp = os.path.join(SRC_DIR, f"{base}.webp")
        img_1x.save(out_1x_webp, "WEBP", quality=WEBP_QUALITY, method=6)
        sz = os.path.getsize(out_1x_webp)
        total_after += sz
        print(f"  [webp] {base}.webp     {size_1x}x{size_1x}  {fmt_size(sz)}")

        # 1x PNG 兜底（覆盖原文件，体积更小）
        out_png = src_path
        img_1x.save(out_png, "PNG", optimize=True)
        sz = os.path.getsize(out_png)
        total_after += sz
        print(f"  [png ] {filename:<22} {size_1x}x{size_1x}  {fmt_size(sz)}")

    print()
    print(f"原始 PNG 总大小:  {fmt_size(total_before)}")
    print(f"新资源总大小:    {fmt_size(total_after)}")
    if total_before:
        ratio = (1 - total_after / total_before) * 100
        print(f"缩减:           {ratio:.1f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
