from PIL import Image, ImageDraw

SIZE = 256


def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size // 10
    bg_radius = size // 5

    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=bg_radius,
        fill=(15, 23, 42, 255)
    )

    bar_x1 = margin * 2
    bar_x2 = size - margin * 2
    bar_y = margin * 2
    bar_h = size // 5
    draw.rounded_rectangle(
        [bar_x1, bar_y, bar_x2, bar_y + bar_h],
        radius=size // 25,
        fill=(51, 65, 85, 255)
    )

    dot_r = size // 42
    dot_y = bar_y + bar_h // 2
    for dx in [bar_x1 + bar_h // 2, bar_x1 + bar_h * 3 // 2, bar_x1 + bar_h * 5 // 2]:
        draw.ellipse([dx - dot_r, dot_y - dot_r, dx + dot_r, dot_y + dot_r], fill=(56, 189, 248, 255))

    mid_y = bar_y + bar_h + margin
    mid_h = size // 12
    draw.rounded_rectangle(
        [bar_x1, mid_y, bar_x2, mid_y + mid_h],
        radius=size // 40,
        fill=(56, 189, 248, 220)
    )

    line1_y = mid_y + mid_h + margin // 2
    line1_x2 = bar_x1 + (bar_x2 - bar_x1) * 3 // 4
    draw.rounded_rectangle(
        [bar_x1, line1_y, line1_x2, line1_y + size // 40],
        radius=size // 80,
        fill=(56, 189, 248, 100)
    )

    line2_y = line1_y + margin // 2
    line2_x2 = bar_x1 + (bar_x2 - bar_x1) // 2
    draw.rounded_rectangle(
        [bar_x1, line2_y, line2_x2, line2_y + size // 40],
        radius=size // 80,
        fill=(56, 189, 248, 80)
    )

    btn_y = size - margin * 3
    btn_h = size // 9
    draw.rounded_rectangle(
        [bar_x1, btn_y, bar_x2, btn_y + btn_h],
        radius=size // 28,
        fill=(74, 222, 128, 255)
    )

    return img


img_256 = draw_icon(SIZE)

img_256.save(r'e:\trae_projects\PapaCheck\PapaCheck.Windows\icon.png', 'PNG')

icon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
icons = [draw_icon(s) for s, _ in icon_sizes]
icons[0].save(
    r'e:\trae_projects\PapaCheck\PapaCheck.Windows\icon.ico',
    format='ICO',
    sizes=[(s, s) for s, _ in icon_sizes],
    append_images=icons[1:]
)

print('icon.ico + icon.png generated successfully')
