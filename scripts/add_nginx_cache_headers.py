#!/usr/bin/env python3
"""在 nginx default 中追加 cache header（幂等：可重复跑）"""
import sys

PATH = "/etc/nginx/sites-available/default"

with open(PATH) as f:
    c = f.read()

# 幂等检查：已存在则跳过
if 'Cache-Control "no-cache, must-revalidate"' in c and '/assets/' in c and 'max-age=31536000' in c:
    print("ALREADY APPLIED - skipping")
    sys.exit(0)

# 1) 在第一个 "    location / {" 之前插入 /assets/ 块
# 注意：不能用 expires 指令，它会自己生成 Cache-Control 头并抑制 add_header
assets_block = (
    '    location ^~ /assets/ {\n'
    '        add_header Cache-Control "public, max-age=31536000, immutable";\n'
    '    }\n'
    '\n'
)

if assets_block not in c:
    marker = "    location / {"
    assert c.count(marker) >= 1, "marker not found"
    c = c.replace(marker, assets_block + marker, 1)

# 1.5) 清理之前误加的 expires 1y;（在 /assets/ 块内）
# 避免 expires 抑制 add_header
import re
c = re.sub(
    r"(    location \^~ /assets/ \{\n)"
    r"(        expires 1y;\n)?",
    r"\1",
    c,
)

# 2) 在 location / 块内第一行 try_files 之前插入 no-cache 头
if 'Cache-Control "no-cache, must-revalidate"' not in c:
    target = "    location / {\n        try_files"
    inject = (
        "    location / {\n"
        '        add_header Cache-Control "no-cache, must-revalidate";\n'
        "        try_files"
    )
    assert target in c, "location / try_files pattern not found"
    c = c.replace(target, inject, 1)

with open(PATH, "w") as f:
    f.write(c)

print("OK")
